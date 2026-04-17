import asyncio
import json
import os
import random
import string
import uuid
from datetime import datetime, timedelta
from http import HTTPStatus
from pathlib import Path
from typing import Dict, List, Optional

import aiofiles
import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

# Load environment variables
load_dotenv()

# Configuration from environment
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8123"))
ALLOWED_ORIGINS_RAW = os.getenv("ALLOWED_ORIGINS", "*")
ALLOWED_ORIGINS = [origin.strip() for origin in ALLOWED_ORIGINS_RAW.split(",") if origin.strip()]
# allow_credentials cannot be combined with the "*" wildcard per the CORS spec —
# browsers will reject the response. Only enable credentials when an explicit allowlist is set.
ALLOW_CREDENTIALS = ALLOWED_ORIGINS != ["*"]
MAX_FILE_SIZE_GIB = float(os.getenv("MAX_UPLOAD_SIZE_GIB", "1"))
SESSION_TIMEOUT_SECONDS = int(os.getenv("SESSION_TIMEOUT_SECONDS", "3600"))
CONNECTION_ID_LENGTH = int(os.getenv("CONNECTION_ID_LENGTH", "6"))
# Grace period before a disconnected user is removed from the session, allowing
# brief network blips and page refreshes to reconnect without churn.
DISCONNECT_GRACE_SECONDS = int(os.getenv("DISCONNECT_GRACE_SECONDS", "10"))

# Initialize FastAPI app
app = FastAPI(
    title="Clippy API",
    description="Secure collaborative clipboard with real-time file and text sharing",
    version="1.2.3",
    openapi_url="/api/v1/openapi.json",
    docs_url="/api/v1/docs",
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=ALLOW_CREDENTIALS,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Constants
UPLOAD_DIR = Path("uploads")
MAX_FILE_SIZE = int(MAX_FILE_SIZE_GIB * 1024 * 1024 * 1024)  # Convert GiB to bytes
SESSION_TIMEOUT = timedelta(seconds=SESSION_TIMEOUT_SECONDS)

# Ensure upload directory exists
UPLOAD_DIR.mkdir(exist_ok=True)


# Pydantic models
class User(BaseModel):
    id: str
    name: str
    is_host: bool


class Block(BaseModel):
    id: str
    type: str  # "text" or "file"
    content: Optional[str] = None
    filename: Optional[str] = None  # Server filename
    original_filename: Optional[str] = None  # Original uploaded filename
    created_by: str
    created_at: str


class SessionInfo(BaseModel):
    connection_id: str
    users: List[User]
    blocks: List[Block]
    allow_join: bool
    host_id: str


class CreateSessionRequest(BaseModel):
    user_name: Optional[str] = None


class JoinSessionRequest(BaseModel):
    connection_id: str
    user_name: Optional[str] = None


class CreateBlockRequest(BaseModel):
    connection_id: str
    user_id: str
    type: str
    content: Optional[str] = None


class DeleteBlockRequest(BaseModel):
    connection_id: str
    user_id: str
    block_id: str


class TransferHostRequest(BaseModel):
    connection_id: str
    current_host_id: str
    new_host_id: str


class ToggleJoinRequest(BaseModel):
    connection_id: str
    user_id: str
    allow_join: bool


# Session storage
class Session:
    """
    Represents a collaborative session with users, blocks, and WebSocket connections.

    Attributes:
        connection_id: Unique 6-character session identifier
        users: Dictionary of user_id -> User objects
        blocks: Dictionary of block_id -> Block objects (text and files)
        allow_join: Whether new users can join this session
        last_activity: Timestamp of last activity for timeout tracking
        websockets: Dictionary of user_id -> WebSocket connections
        session_dir: Directory path for storing session files
    """

    def __init__(self, connection_id: str, host_id: str, host_name: str):
        """Initialize a new session with a host user."""
        self.connection_id = connection_id
        self.users: Dict[str, User] = {
            host_id: User(id=host_id, name=host_name, is_host=True)
        }
        self.blocks: Dict[str, Block] = {}
        self.allow_join = True
        self.last_activity = datetime.now()
        self.websockets: Dict[str, WebSocket] = {}
        # Pending eviction tasks keyed by user_id so reconnects can cancel them.
        self.pending_disconnects: Dict[str, asyncio.Task] = {}
        self.session_dir = UPLOAD_DIR / connection_id
        self.session_dir.mkdir(exist_ok=True)

    def update_activity(self):
        """Update the last activity timestamp to prevent session timeout."""
        self.last_activity = datetime.now()
        mark_sessions_dirty()

    def is_expired(self) -> bool:
        """Check if session has exceeded the timeout period."""
        return datetime.now() - self.last_activity > SESSION_TIMEOUT

    def get_unique_name(self, base_name: str) -> str:
        """
        Generate a unique user name by appending numbers if duplicates exist.

        Examples: "Sam" -> "Sam", "Sam(2)", "Sam(3)", etc.
        """
        existing_names = {user.name for user in self.users.values()}
        if base_name not in existing_names:
            return base_name

        counter = 2
        while f"{base_name}({counter})" in existing_names:
            counter += 1
        return f"{base_name}({counter})"

    def add_user(self, user_id: str, name: str) -> User:
        """Add a new user to the session with a unique name."""
        unique_name = self.get_unique_name(name)
        user = User(id=user_id, name=unique_name, is_host=False)
        self.users[user_id] = user
        self.update_activity()
        return user

    def remove_user(self, user_id: str):
        """Remove a user and their WebSocket connection from the session."""
        if user_id in self.users:
            del self.users[user_id]
        if user_id in self.websockets:
            del self.websockets[user_id]
        pending = self.pending_disconnects.pop(user_id, None)
        if pending is not None and not pending.done():
            pending.cancel()
        self.update_activity()

    def transfer_host(self, new_host_id: str):
        """Transfer host privileges to another user in the session."""
        for user in self.users.values():
            user.is_host = (user.id == new_host_id)
        self.update_activity()

    def add_block(self, block: Block):
        """Add a new text or file block to the session."""
        self.blocks[block.id] = block
        self.update_activity()

    def delete_block(self, block_id: str):
        """Delete a block and its associated files from the session."""
        if block_id in self.blocks:
            block = self.blocks[block_id]
            # Delete associated file
            if block.type == "file" and block.filename:
                file_path = self.session_dir / block.filename
                if file_path.exists():
                    file_path.unlink()
            elif block.type == "text":
                text_file = self.session_dir / f"text_block_{block_id}.txt"
                if text_file.exists():
                    text_file.unlink()
            del self.blocks[block_id]
        self.update_activity()

    async def broadcast(self, message: dict, exclude_user: Optional[str] = None):
        """
        Broadcast a message to all connected WebSocket clients.

        Args:
            message: Dictionary to send as JSON
            exclude_user: Optional user_id to exclude from broadcast
        """
        for user_id, ws in list(self.websockets.items()):
            if exclude_user and user_id == exclude_user:
                continue
            try:
                await ws.send_json(message)
            except Exception:
                pass

    def to_dict(self) -> dict:
        """Serialize persistable session state. Sockets and tasks are runtime-only."""
        return {
            "connection_id": self.connection_id,
            "users": {uid: u.model_dump() for uid, u in self.users.items()},
            "blocks": {bid: b.model_dump() for bid, b in self.blocks.items()},
            "allow_join": self.allow_join,
            "last_activity": self.last_activity.isoformat(),
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Session":
        instance = cls.__new__(cls)
        instance.connection_id = data["connection_id"]
        instance.users = {uid: User(**u) for uid, u in data.get("users", {}).items()}
        instance.blocks = {bid: Block(**b) for bid, b in data.get("blocks", {}).items()}
        instance.allow_join = data.get("allow_join", True)
        instance.last_activity = datetime.fromisoformat(data["last_activity"])
        instance.websockets = {}
        instance.pending_disconnects = {}
        instance.session_dir = UPLOAD_DIR / instance.connection_id
        instance.session_dir.mkdir(exist_ok=True)
        return instance


# Global session storage - Maps connection_id to Session objects
sessions: Dict[str, Session] = {}

# Persistence: snapshot session metadata to disk so a restart doesn't wipe state.
# A dirty flag + periodic flush avoids touching the disk on every mutation.
SESSIONS_FILE = UPLOAD_DIR / ".sessions.json"
PERSIST_INTERVAL_SECONDS = 2
_sessions_dirty = False


def mark_sessions_dirty() -> None:
    global _sessions_dirty
    _sessions_dirty = True


async def save_sessions() -> None:
    """Atomically snapshot the sessions dict to JSON."""
    payload = json.dumps({sid: s.to_dict() for sid, s in sessions.items()})
    tmp_path = SESSIONS_FILE.with_suffix(".tmp")
    async with aiofiles.open(tmp_path, "w", encoding="utf-8") as f:
        await f.write(payload)
    os.replace(tmp_path, SESSIONS_FILE)


def load_sessions_sync() -> None:
    """Load persisted sessions on startup. Sync because called outside the loop."""
    if not SESSIONS_FILE.exists():
        return
    try:
        with open(SESSIONS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        print(f"Failed to load sessions snapshot: {e}")
        return

    for sid, sdata in data.items():
        try:
            sessions[sid] = Session.from_dict(sdata)
        except Exception as e:
            print(f"Skipping malformed session {sid}: {e}")


async def persistence_loop() -> None:
    """Background task that flushes the dirty flag at a fixed interval."""
    global _sessions_dirty
    while True:
        await asyncio.sleep(PERSIST_INTERVAL_SECONDS)
        if not _sessions_dirty:
            continue
        _sessions_dirty = False
        try:
            await save_sessions()
        except Exception as e:
            # Re-arm the dirty flag so we retry on the next tick.
            _sessions_dirty = True
            print(f"Failed to persist sessions: {e}")


def api_response(status: HTTPStatus, message: str, data: Optional[dict] = None) -> JSONResponse:
    """
    Create a standardized API response with HTTP status code.

    Args:
        status: HTTP status code
        message: Human-readable message
        data: Optional dictionary of response data

    Returns:
        JSONResponse with consistent structure
    """
    content = {
        "status": status.value,
        "message": message,
    }
    if data is not None:
        content["data"] = data
    return JSONResponse(status_code=status.value, content=content)


def generate_connection_id() -> str | None:
    """
    Generate a unique 6-character session ID using lowercase letters and digits.

    Returns a session ID that doesn't exist in the current sessions dictionary,
    or None if all possible IDs are exhausted.
    """
    chars = string.ascii_lowercase + string.digits
    max_possible = len(chars) ** CONNECTION_ID_LENGTH
    max_attempts = min(max_possible, 1000)  # Limit attempts to avoid infinite loops

    for _ in range(max_attempts):
        connection_id = ''.join(random.choices(chars, k=CONNECTION_ID_LENGTH))
        if connection_id not in sessions:
            return connection_id

    # If random generation failed, check if we're actually at capacity
    if len(sessions) >= max_possible:
        return None

    # Fallback: try a few more times
    for _ in range(100):
        connection_id = ''.join(random.choices(chars, k=CONNECTION_ID_LENGTH))
        if connection_id not in sessions:
            return connection_id

    return None


def generate_random_name() -> str:
    """
    Generate a random user name by combining an adjective and animal.

    Examples: "HappyPanda", "CleverFox", "SwiftEagle"
    """
    adjectives = [
        "Happy", "Clever", "Swift", "Bright", "Cool", "Smart", "Quick", "Calm", "Bold", "Wise",
        "Brave", "Gentle", "Lively", "Witty", "Agile", "Keen", "Noble", "Proud", "Merry", "Jolly",
        "Fierce", "Loyal", "Mighty", "Lucky", "Sunny", "Silent", "Golden", "Silver", "Crystal", "Cosmic",
        "Mystic", "Shadow", "Radiant", "Wild", "Chill", "Vivid", "Daring", "Curious", "Sneaky", "Fluffy"
    ]
    nouns = [
        "Panda", "Tiger", "Eagle", "Dolphin", "Fox", "Wolf", "Bear", "Hawk", "Lion", "Owl",
        "Falcon", "Otter", "Raven", "Phoenix", "Dragon", "Panther", "Koala", "Penguin", "Rabbit", "Deer",
        "Lynx", "Jaguar", "Cheetah", "Whale", "Shark", "Cobra", "Turtle", "Crane", "Swan", "Parrot",
        "Husky", "Corgi", "Gecko", "Lemur", "Badger", "Beaver", "Moose", "Elk", "Bison", "Raccoon"
    ]
    return f"{random.choice(adjectives)}{random.choice(nouns)}"


async def _teardown_session(connection_id: str, reason: str):
    """Notify users, close sockets, cancel pending tasks, and delete a session."""
    session = sessions.pop(connection_id, None)
    if session is None:
        return

    for task in list(session.pending_disconnects.values()):
        if not task.done():
            task.cancel()
    session.pending_disconnects.clear()

    await session.broadcast({"type": "session_destroyed", "reason": reason})

    for ws in list(session.websockets.values()):
        try:
            await ws.close()
        except Exception:
            pass
    session.websockets.clear()

    if session.session_dir.exists():
        import shutil
        shutil.rmtree(session.session_dir, ignore_errors=True)

    mark_sessions_dirty()


async def cleanup_expired_sessions():
    """
    Background task that periodically checks for and removes expired sessions.

    Runs every 60 seconds, checking for sessions that haven't had activity
    in the configured timeout period (default 1 hour). Notifies users,
    closes WebSockets, deletes files, and removes sessions from memory.
    """
    while True:
        await asyncio.sleep(60)
        expired = [sid for sid, session in sessions.items() if session.is_expired()]
        for sid in expired:
            await _teardown_session(sid, "timeout")


# API Endpoints
@app.on_event("startup")
async def startup_event():
    # Restore sessions from the previous process (if any) before pruning state.
    load_sessions_sync()

    import shutil
    if UPLOAD_DIR.exists():
        valid_session_ids = set(sessions.keys())
        preserved = {SESSIONS_FILE.name, SESSIONS_FILE.with_suffix(".tmp").name, ".gitkeep"}
        for item in UPLOAD_DIR.iterdir():
            if item.is_dir():
                if item.name not in valid_session_ids:
                    shutil.rmtree(item, ignore_errors=True)
            elif item.name not in preserved:
                try:
                    item.unlink()
                except OSError:
                    pass
        print(
            f"Startup: restored {len(sessions)} session(s); pruned orphan entries in {UPLOAD_DIR}"
        )

    asyncio.create_task(cleanup_expired_sessions())
    asyncio.create_task(persistence_loop())


@app.on_event("shutdown")
async def shutdown_event():
    """Flush any pending session changes so a clean restart restores everything."""
    try:
        await save_sessions()
    except Exception as e:
        print(f"Failed to flush sessions on shutdown: {e}")


@app.get(
    "/api/v1/config",
    summary="Get Configuration",
    description="Retrieve client configuration (file size limits)."
)
async def get_config():
    """
    Get client configuration. Encryption keys are generated client-side and
    transported via the URL fragment, so the server never sees them.
    """
    return api_response(
        HTTPStatus.OK,
        "Configuration retrieved",
        {
            "max_file_size_bytes": MAX_FILE_SIZE,
        }
    )


@app.get(
    "/api/v1/session/id-length",
    summary="Get Connection ID Length",
    description="Retrieve the configured connection ID length"
)
async def get_connection_id_length():
    """
    Get the configured connection ID length.

    Returns the length of connection IDs generated by the server.
    Used by the client to validate session ID input.
    """
    return api_response(
        HTTPStatus.OK,
        "Connection ID length retrieved",
        {
            "connection_id_length": CONNECTION_ID_LENGTH,
        }
    )


@app.post(
    "/api/v1/session/create",
    summary="Create New Session",
    description="Create a new collaborative session and become the host"
)
async def create_session(request: CreateSessionRequest):
    """
    Create a new collaborative session.

    Generates a unique 6-character session ID and creates the first user as the host.
    If no user name is provided, a random name will be generated.

    Returns session ID, user ID, user name, and host status.
    """
    connection_id = generate_connection_id()

    if connection_id is None:
        return api_response(
            HTTPStatus.SERVICE_UNAVAILABLE,
            "Unable to create session: all connection IDs are currently in use. Please try again later."
        )

    user_id = str(uuid.uuid4())
    user_name = request.user_name or generate_random_name()

    session = Session(connection_id, user_id, user_name)
    sessions[connection_id] = session
    mark_sessions_dirty()

    return api_response(
        HTTPStatus.OK,
        "Session created",
        {
            "connection_id": connection_id,
            "user_id": user_id,
            "user_name": user_name,
            "is_host": True
        }
    )


@app.post(
    "/api/v1/session/join",
    summary="Join Existing Session",
    description="Join an existing session using a session ID"
)
async def join_session(request: JoinSessionRequest):
    """
    Join an existing collaborative session.

    Requires a valid session ID. If the session doesn't allow joining,
    the request will be rejected. User names are automatically made unique
    by appending numbers if duplicates exist (e.g., Sam, Sam(2)).

    Returns session ID, user ID, unique user name, and host status.
    """
    connection_id = request.connection_id.lower()

    if connection_id not in sessions:
        return api_response(
            HTTPStatus.NOT_FOUND,
            "Session not found"
        )

    session = sessions[connection_id]

    if not session.allow_join:
        return api_response(
            HTTPStatus.FORBIDDEN,
            "Session is not accepting new members"
        )

    user_id = str(uuid.uuid4())
    user_name = request.user_name or generate_random_name()

    user = session.add_user(user_id, user_name)

    # Broadcast user joined
    await session.broadcast({
        "type": "user_joined",
        "user": user.model_dump()
    })

    return api_response(
        HTTPStatus.OK,
        "Connection created",
        {
            "connection_id": connection_id,
            "user_id": user_id,
            "user_name": user.name,
            "is_host": False
        }
    )


@app.get(
    "/api/v1/session/{connection_id}",
    summary="Get Session Details",
    description="Retrieve complete session information including users and blocks"
)
async def get_session(connection_id: str):
    """
    Get detailed information about a session.

    Returns all users in the session, all blocks (text and files),
    join permission status, and the current host ID.
    """
    connection_id = connection_id.lower()

    if connection_id not in sessions:
        return api_response(
            HTTPStatus.NOT_FOUND,
            "Session not found"
        )

    session = sessions[connection_id]

    session_info = SessionInfo(
        connection_id=connection_id,
        users=list(session.users.values()),
        blocks=list(session.blocks.values()),
        allow_join=session.allow_join,
        host_id=next((u.id for u in session.users.values() if u.is_host), "")
    )

    return api_response(
        HTTPStatus.OK,
        "Session retrieved",
        session_info.model_dump()
    )


@app.post(
    "/api/v1/session/destroy",
    summary="Destroy Session",
    description="Permanently delete a session and all its data (host only)"
)
async def destroy_session(connection_id: str, user_id: str):
    """
    Destroy a session and clean up all associated data.

    Only the session host can destroy a session. This will:
    - Notify all connected users
    - Close all WebSocket connections
    - Delete all uploaded files and text blocks
    - Remove the session from memory
    """
    connection_id = connection_id.lower()

    if connection_id not in sessions:
        return api_response(
            HTTPStatus.NOT_FOUND,
            "Session not found"
        )

    session = sessions[connection_id]

    # Verify user is host
    if user_id not in session.users or not session.users[user_id].is_host:
        return api_response(
            HTTPStatus.FORBIDDEN,
            "Only host can destroy session"
        )

    await _teardown_session(connection_id, "host_action")

    return api_response(
        HTTPStatus.OK,
        "Session destroyed",
        {"success": True}
    )


@app.post(
    "/api/v1/session/transfer_host",
    summary="Transfer Host Rights",
    description="Transfer host privileges to another user in the session"
)
async def transfer_host(request: TransferHostRequest):
    """
    Transfer host rights to another user.

    Only the current host can transfer host rights. The new host will
    gain all host privileges including the ability to destroy the session,
    transfer host rights, and control join permissions.
    """
    connection_id = request.connection_id.lower()

    if connection_id not in sessions:
        return api_response(
            HTTPStatus.NOT_FOUND,
            "Session not found"
        )

    session = sessions[connection_id]

    # Verify current user is host
    if request.current_host_id not in session.users or not session.users[request.current_host_id].is_host:
        return api_response(
            HTTPStatus.FORBIDDEN,
            "Only host can transfer host rights"
        )

    if request.new_host_id not in session.users:
        return api_response(
            HTTPStatus.NOT_FOUND,
            "New host user not found"
        )

    session.transfer_host(request.new_host_id)

    # Broadcast host transfer
    await session.broadcast({
        "type": "host_transferred",
        "new_host_id": request.new_host_id
    })

    return api_response(
        HTTPStatus.OK,
        "Host transferred",
        {"success": True}
    )


@app.post(
    "/api/v1/session/toggle_join",
    summary="Toggle Join Permission",
    description="Enable or disable new users from joining the session (host only)"
)
async def toggle_join(request: ToggleJoinRequest):
    """
    Toggle whether new users can join the session.

    Only the host can change this setting. When disabled, new join
    requests will be rejected. Existing users remain connected.
    """
    connection_id = request.connection_id.lower()

    if connection_id not in sessions:
        return api_response(
            HTTPStatus.NOT_FOUND,
            "Session not found"
        )

    session = sessions[connection_id]

    # Verify user is host
    if request.user_id not in session.users or not session.users[request.user_id].is_host:
        return api_response(
            HTTPStatus.FORBIDDEN,
            "Only host can toggle join permission"
        )

    session.allow_join = request.allow_join
    session.update_activity()

    # Broadcast setting change
    await session.broadcast({
        "type": "join_permission_changed",
        "allow_join": request.allow_join
    })

    return api_response(
        HTTPStatus.OK,
        "Join permission updated",
        {"success": True}
    )


@app.post(
    "/api/v1/block/create",
    summary="Create Text Block",
    description="Create a new text block in the session"
)
async def create_text_block(request: CreateBlockRequest):
    """
    Create a new text or file block.

    Text blocks are saved to the uploads directory and broadcasted to
    all connected users in real-time. Content should be encrypted
    client-side before sending.
    """
    connection_id = request.connection_id.lower()

    if connection_id not in sessions:
        return api_response(
            HTTPStatus.NOT_FOUND,
            "Session not found"
        )

    session = sessions[connection_id]

    if request.user_id not in session.users:
        return api_response(
            HTTPStatus.FORBIDDEN,
            "User not in session"
        )

    block_id = str(uuid.uuid4())

    # Create block
    block = Block(
        id=block_id,
        type=request.type,
        content=request.content,
        created_by=request.user_id,
        created_at=datetime.now().isoformat()
    )

    # Save text to file if it's a text block
    if request.type == "text" and request.content:
        text_file = session.session_dir / f"text_block_{block_id}.txt"
        async with aiofiles.open(text_file, "w", encoding="utf-8") as f:
            await f.write(request.content)

    session.add_block(block)

    # Broadcast new block
    await session.broadcast({
        "type": "block_created",
        "block": block.model_dump()
    })

    return api_response(
        HTTPStatus.OK,
        "Block created",
        {"block_id": block_id, "block": block.model_dump()}
    )


@app.post(
    "/api/v1/block/upload",
    summary="Upload File Block",
    description="Upload a file to the session (encrypted)"
)
async def upload_file_block(
        connection_id: str = Form(...),
        user_id: str = Form(...),
        file: UploadFile = File(...)
):
    """
    Upload a file to the session.

    Files should be encrypted client-side before upload. The file is
    saved to the session directory and broadcasted to all users.
    Maximum file size is configurable (default 1 GiB).
    """
    connection_id = connection_id.lower()

    if connection_id not in sessions:
        return api_response(
            HTTPStatus.NOT_FOUND,
            "Session not found"
        )

    session = sessions[connection_id]

    if user_id not in session.users:
        return api_response(
            HTTPStatus.FORBIDDEN,
            "User not in session"
        )

    block_id = str(uuid.uuid4())

    # Only keep the suffix from the user-supplied name and strip directory characters
    # so a malicious filename like "../../etc/passwd" can't escape the session dir.
    raw_suffix = Path(file.filename or "").suffix
    safe_suffix = "".join(c for c in raw_suffix if c.isalnum() or c in "._-")[:32]
    safe_filename = f"file_{block_id}{safe_suffix}"
    file_path = session.session_dir / safe_filename

    # Stream the upload to disk in chunks so a 1 GiB file doesn't sit in memory.
    chunk_size = 1024 * 1024
    bytes_written = 0
    try:
        async with aiofiles.open(file_path, "wb") as f:
            while True:
                chunk = await file.read(chunk_size)
                if not chunk:
                    break
                bytes_written += len(chunk)
                if bytes_written > MAX_FILE_SIZE:
                    break
                await f.write(chunk)
    except Exception:
        if file_path.exists():
            file_path.unlink()
        raise

    if bytes_written > MAX_FILE_SIZE:
        if file_path.exists():
            file_path.unlink()
        return api_response(
            HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
            f"File too large. Max size: {MAX_FILE_SIZE} bytes"
        )

    # Create block with both server filename and original filename
    block = Block(
        id=block_id,
        type="file",
        filename=safe_filename,
        original_filename=file.filename,  # Store original name
        created_by=user_id,
        created_at=datetime.now().isoformat()
    )

    session.add_block(block)

    # Broadcast new block
    await session.broadcast({
        "type": "block_created",
        "block": block.model_dump()
    })

    return api_response(
        HTTPStatus.OK,
        "File uploaded",
        {"block_id": block_id, "block": block.model_dump()}
    )


@app.delete(
    "/api/v1/block/delete",
    summary="Delete Block",
    description="Delete a text or file block from the session"
)
async def delete_block(request: DeleteBlockRequest):
    """
    Delete a block from the session.

    Removes the block from memory and deletes associated files from
    the uploads directory. All users are notified via WebSocket.
    """
    connection_id = request.connection_id.lower()

    if connection_id not in sessions:
        return api_response(
            HTTPStatus.NOT_FOUND,
            "Session not found"
        )

    session = sessions[connection_id]

    if request.user_id not in session.users:
        return api_response(
            HTTPStatus.FORBIDDEN,
            "User not in session"
        )

    if request.block_id not in session.blocks:
        return api_response(
            HTTPStatus.NOT_FOUND,
            "Block not found"
        )

    session.delete_block(request.block_id)

    # Broadcast block deletion
    await session.broadcast({
        "type": "block_deleted",
        "block_id": request.block_id
    })

    return api_response(
        HTTPStatus.OK,
        "Block deleted",
        {"success": True}
    )


@app.get(
    "/api/v1/block/download/{connection_id}/{block_id}",
    summary="Download Block",
    description="Download a text or file block (encrypted)"
)
async def download_block(connection_id: str, block_id: str):
    """
    Download a block's content.

    Returns the encrypted file or text content. Client is responsible
    for decryption using the shared encryption keys.
    """
    connection_id = connection_id.lower()

    if connection_id not in sessions:
        return api_response(
            HTTPStatus.NOT_FOUND,
            "Session not found"
        )

    session = sessions[connection_id]

    if block_id not in session.blocks:
        return api_response(
            HTTPStatus.NOT_FOUND,
            "Block not found"
        )

    block = session.blocks[block_id]

    if block.type == "file":
        file_path = session.session_dir / block.filename
        if not file_path.exists():
            return api_response(
                HTTPStatus.NOT_FOUND,
                "File not found"
            )
        # Use original filename for download if available, otherwise use server filename
        download_filename = block.original_filename if block.original_filename else block.filename
        return FileResponse(file_path, filename=download_filename)
    elif block.type == "text":
        text_file = session.session_dir / f"text_block_{block_id}.txt"
        if not text_file.exists():
            return api_response(
                HTTPStatus.NOT_FOUND,
                "Text file not found"
            )
        return FileResponse(text_file, filename=f"text_{block_id}.txt")

    return api_response(
        HTTPStatus.BAD_REQUEST,
        "Invalid block type"
    )


async def _remove_user_after_grace(connection_id: str, user_id: str):
    """
    Wait for the grace period, then evict the user if they haven't reconnected.

    If the host leaves and other users remain, host privileges are auto-transferred
    so the session keeps a host and the remaining users can still manage it.
    """
    try:
        await asyncio.sleep(DISCONNECT_GRACE_SECONDS)
    except asyncio.CancelledError:
        return

    session = sessions.get(connection_id)
    if session is None:
        return
    user = session.users.get(user_id)
    if user is None or user_id in session.websockets:
        return

    was_host = user.is_host
    session.remove_user(user_id)

    await session.broadcast({"type": "user_left", "user_id": user_id})

    if was_host and session.users:
        new_host_id = next(iter(session.users))
        session.transfer_host(new_host_id)
        await session.broadcast({
            "type": "host_transferred",
            "new_host_id": new_host_id,
        })


@app.websocket("/ws/{connection_id}/{user_id}")
async def websocket_endpoint(websocket: WebSocket, connection_id: str, user_id: str):
    connection_id = connection_id.lower()

    if connection_id not in sessions:
        await websocket.close(code=1008, reason="Session not found")
        return

    session = sessions[connection_id]

    if user_id not in session.users:
        await websocket.close(code=1008, reason="User not in session")
        return

    await websocket.accept()

    # Cancel any pending eviction from a previous disconnect — the user is back.
    pending = session.pending_disconnects.pop(user_id, None)
    if pending is not None:
        pending.cancel()

    session.websockets[user_id] = websocket
    session.update_activity()

    try:
        while True:
            data = await websocket.receive_text()
            try:
                message = json.loads(data)
            except json.JSONDecodeError:
                continue
            if message.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
                session.update_activity()
    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"WebSocket error: {e}")
    finally:
        # Only drop the websocket reference if it still points at this connection.
        # A reconnect may have already replaced it during the disconnect handling.
        if session.websockets.get(user_id) is websocket:
            del session.websockets[user_id]
        if connection_id in sessions and user_id in session.users:
            session.pending_disconnects[user_id] = asyncio.create_task(
                _remove_user_after_grace(connection_id, user_id)
            )


if __name__ == "__main__":
    print(f"Starting server on {HOST}:{PORT}")
    uvicorn.run(
        app,
        host=HOST,
        port=PORT
    )
