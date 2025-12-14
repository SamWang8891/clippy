import asyncio
import json
import os
import random
import string
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional

import aiofiles
import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

# Load environment variables
load_dotenv()

# Configuration from environment
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8123"))
ALLOWED_ORIGINS_RAW = os.getenv("ALLOWED_ORIGINS", "*")
ALLOWED_ORIGINS = [origin.strip() for origin in ALLOWED_ORIGINS_RAW.split(",")]
ENCRYPTION_PASSPHRASE = os.getenv("ENCRYPTION_PASSPHRASE", "default-passphrase-please-change")
ENCRYPTION_SALT = os.getenv("ENCRYPTION_SALT", "default-salt-please-change")
MAX_FILE_SIZE_GIB = float(os.getenv("MAX_UPLOAD_SIZE_GIB", "1"))
SESSION_TIMEOUT_SECONDS = int(os.getenv("SESSION_TIMEOUT_SECONDS", "3600"))
SESSION_ID_LENGTH = int(os.getenv("SESSION_ID_LENGTH", "6"))

# Initialize FastAPI app
app = FastAPI(
    title="Clippy API",
    description="Secure collaborative clipboard with real-time file and text sharing",
    version="1.0.0",
    openapi_url="/api/v1/openapi.json",
    docs_url="/api/v1/docs",
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
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
    filename: Optional[str] = None
    created_by: str
    created_at: str


class SessionInfo(BaseModel):
    session_id: str
    users: List[User]
    blocks: List[Block]
    allow_join: bool
    host_id: str


class CreateSessionRequest(BaseModel):
    user_name: Optional[str] = None


class JoinSessionRequest(BaseModel):
    session_id: str
    user_name: Optional[str] = None


class CreateBlockRequest(BaseModel):
    session_id: str
    user_id: str
    type: str
    content: Optional[str] = None


class DeleteBlockRequest(BaseModel):
    session_id: str
    user_id: str
    block_id: str


class TransferHostRequest(BaseModel):
    session_id: str
    current_host_id: str
    new_host_id: str


class ToggleJoinRequest(BaseModel):
    session_id: str
    user_id: str
    allow_join: bool


# Session storage
class Session:
    """
    Represents a collaborative session with users, blocks, and WebSocket connections.

    Attributes:
        session_id: Unique 6-character session identifier
        users: Dictionary of user_id -> User objects
        blocks: Dictionary of block_id -> Block objects (text and files)
        allow_join: Whether new users can join this session
        last_activity: Timestamp of last activity for timeout tracking
        websockets: Dictionary of user_id -> WebSocket connections
        session_dir: Directory path for storing session files
    """

    def __init__(self, session_id: str, host_id: str, host_name: str):
        """Initialize a new session with a host user."""
        self.session_id = session_id
        self.users: Dict[str, User] = {
            host_id: User(id=host_id, name=host_name, is_host=True)
        }
        self.blocks: Dict[str, Block] = {}
        self.allow_join = True
        self.last_activity = datetime.now()
        self.websockets: Dict[str, WebSocket] = {}
        self.session_dir = UPLOAD_DIR / session_id
        self.session_dir.mkdir(exist_ok=True)

    def update_activity(self):
        """Update the last activity timestamp to prevent session timeout."""
        self.last_activity = datetime.now()

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
            except:
                pass


# Global session storage - Maps session_id to Session objects
sessions: Dict[str, Session] = {}


def generate_session_id() -> str:
    """
    Generate a unique 6-character session ID using lowercase letters and digits.

    Returns a session ID that doesn't exist in the current sessions dictionary.
    """
    chars = string.ascii_lowercase + string.digits
    while True:
        session_id = ''.join(random.choices(chars, k=SESSION_ID_LENGTH))
        if session_id not in sessions:
            return session_id


def generate_random_name() -> str:
    """
    Generate a random user name by combining an adjective and animal.

    Examples: "HappyPanda", "CleverFox", "SwiftEagle"
    """
    adjectives = ["Happy", "Clever", "Swift", "Bright", "Cool", "Smart", "Quick", "Calm", "Bold", "Wise"]
    nouns = ["Panda", "Tiger", "Eagle", "Dolphin", "Fox", "Wolf", "Bear", "Hawk", "Lion", "Owl"]
    return f"{random.choice(adjectives)}{random.choice(nouns)}"


async def cleanup_expired_sessions():
    """
    Background task that periodically checks for and removes expired sessions.

    Runs every 60 seconds, checking for sessions that haven't had activity
    in the configured timeout period (default 1 hour). Notifies users,
    closes WebSockets, deletes files, and removes sessions from memory.
    """
    while True:
        await asyncio.sleep(60)  # Check every minute
        expired = [sid for sid, session in sessions.items() if session.is_expired()]
        for sid in expired:
            session = sessions[sid]
            # Notify users before cleanup
            await session.broadcast({
                "type": "session_destroyed",
                "reason": "timeout"
            })
            # Close all websockets
            for ws in session.websockets.values():
                try:
                    await ws.close()
                except:
                    pass
            # Clean up files
            if session.session_dir.exists():
                import shutil
                shutil.rmtree(session.session_dir)
            del sessions[sid]


# API Endpoints
@app.on_event("startup")
async def startup_event():
    # Clean up all files in uploads directory on startup
    import shutil
    if UPLOAD_DIR.exists():
        for item in UPLOAD_DIR.iterdir():
            if item.is_dir():
                shutil.rmtree(item)
            elif item.name != '.gitkeep':
                item.unlink()
        print(f"Cleaned up uploads directory: {UPLOAD_DIR}")

    # Start background cleanup task
    asyncio.create_task(cleanup_expired_sessions())


@app.get(
    "/api/v1/config",
    summary="Get Configuration",
    description="Retrieve encryption configuration and file size limits for the client"
)
async def get_config():
    """
    Get client configuration including encryption keys and file upload limits.

    Returns encryption passphrase, salt, and maximum file size in bytes.
    These values are used by the client for end-to-end encryption.
    """
    return {
        "encryption_passphrase": ENCRYPTION_PASSPHRASE,
        "encryption_salt": ENCRYPTION_SALT,
        "max_file_size_bytes": MAX_FILE_SIZE,
    }


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
    user_id = str(uuid.uuid4())
    user_name = request.user_name or generate_random_name()
    session_id = generate_session_id()

    session = Session(session_id, user_id, user_name)
    sessions[session_id] = session

    return {
        "session_id": session_id,
        "user_id": user_id,
        "user_name": user_name,
        "is_host": True
    }


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
    session_id = request.session_id.lower()

    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    session = sessions[session_id]

    if not session.allow_join:
        raise HTTPException(status_code=403, detail="Session is not accepting new members")

    user_id = str(uuid.uuid4())
    user_name = request.user_name or generate_random_name()

    user = session.add_user(user_id, user_name)

    # Broadcast user joined
    await session.broadcast({
        "type": "user_joined",
        "user": user.model_dump()
    })

    return {
        "session_id": session_id,
        "user_id": user_id,
        "user_name": user.name,
        "is_host": False
    }


@app.get(
    "/api/v1/session/{session_id}",
    summary="Get Session Details",
    description="Retrieve complete session information including users and blocks"
)
async def get_session(session_id: str):
    """
    Get detailed information about a session.

    Returns all users in the session, all blocks (text and files),
    join permission status, and the current host ID.
    """
    session_id = session_id.lower()

    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    session = sessions[session_id]

    return SessionInfo(
        session_id=session_id,
        users=list(session.users.values()),
        blocks=list(session.blocks.values()),
        allow_join=session.allow_join,
        host_id=next((u.id for u in session.users.values() if u.is_host), "")
    )


@app.post(
    "/api/v1/session/destroy",
    summary="Destroy Session",
    description="Permanently delete a session and all its data (host only)"
)
async def destroy_session(session_id: str, user_id: str):
    """
    Destroy a session and clean up all associated data.

    Only the session host can destroy a session. This will:
    - Notify all connected users
    - Close all WebSocket connections
    - Delete all uploaded files and text blocks
    - Remove the session from memory
    """
    session_id = session_id.lower()

    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    session = sessions[session_id]

    # Verify user is host
    if user_id not in session.users or not session.users[user_id].is_host:
        raise HTTPException(status_code=403, detail="Only host can destroy session")

    # Notify all users
    await session.broadcast({
        "type": "session_destroyed",
        "reason": "host_action"
    })

    # Close all websockets
    for ws in session.websockets.values():
        try:
            await ws.close()
        except:
            pass

    # Clean up files
    if session.session_dir.exists():
        import shutil
        shutil.rmtree(session.session_dir)

    del sessions[session_id]

    return {"success": True}


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
    session_id = request.session_id.lower()

    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    session = sessions[session_id]

    # Verify current user is host
    if request.current_host_id not in session.users or not session.users[request.current_host_id].is_host:
        raise HTTPException(status_code=403, detail="Only host can transfer host rights")

    if request.new_host_id not in session.users:
        raise HTTPException(status_code=404, detail="New host user not found")

    session.transfer_host(request.new_host_id)

    # Broadcast host transfer
    await session.broadcast({
        "type": "host_transferred",
        "new_host_id": request.new_host_id
    })

    return {"success": True}


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
    session_id = request.session_id.lower()

    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    session = sessions[session_id]

    # Verify user is host
    if request.user_id not in session.users or not session.users[request.user_id].is_host:
        raise HTTPException(status_code=403, detail="Only host can toggle join permission")

    session.allow_join = request.allow_join
    session.update_activity()

    # Broadcast setting change
    await session.broadcast({
        "type": "join_permission_changed",
        "allow_join": request.allow_join
    })

    return {"success": True}


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
    session_id = request.session_id.lower()

    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    session = sessions[session_id]

    if request.user_id not in session.users:
        raise HTTPException(status_code=403, detail="User not in session")

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
        async with aiofiles.open(text_file, "w") as f:
            await f.write(request.content)

    session.add_block(block)

    # Broadcast new block
    await session.broadcast({
        "type": "block_created",
        "block": block.model_dump()
    })

    return {"block_id": block_id, "block": block}


@app.post(
    "/api/v1/block/upload",
    summary="Upload File Block",
    description="Upload a file to the session (encrypted)"
)
async def upload_file_block(
        session_id: str = Form(...),
        user_id: str = Form(...),
        file: UploadFile = File(...)
):
    """
    Upload a file to the session.

    Files should be encrypted client-side before upload. The file is
    saved to the session directory and broadcasted to all users.
    Maximum file size is configurable (default 1 GiB).
    """
    session_id = session_id.lower()

    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    session = sessions[session_id]

    if user_id not in session.users:
        raise HTTPException(status_code=403, detail="User not in session")

    # Check file size
    file.file.seek(0, 2)
    file_size = file.file.tell()
    file.file.seek(0)

    if file_size > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail=f"File too large. Max size: {MAX_FILE_SIZE} bytes")

    block_id = str(uuid.uuid4())

    # Save file
    file_extension = Path(file.filename).suffix
    safe_filename = f"file_{block_id}{file_extension}"
    file_path = session.session_dir / safe_filename

    async with aiofiles.open(file_path, "wb") as f:
        content = await file.read()
        await f.write(content)

    # Create block
    block = Block(
        id=block_id,
        type="file",
        filename=safe_filename,
        created_by=user_id,
        created_at=datetime.now().isoformat()
    )

    session.add_block(block)

    # Broadcast new block
    await session.broadcast({
        "type": "block_created",
        "block": block.model_dump()
    })

    return {"block_id": block_id, "block": block}


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
    session_id = request.session_id.lower()

    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    session = sessions[session_id]

    if request.user_id not in session.users:
        raise HTTPException(status_code=403, detail="User not in session")

    if request.block_id not in session.blocks:
        raise HTTPException(status_code=404, detail="Block not found")

    session.delete_block(request.block_id)

    # Broadcast block deletion
    await session.broadcast({
        "type": "block_deleted",
        "block_id": request.block_id
    })

    return {"success": True}


@app.get(
    "/api/v1/block/download/{session_id}/{block_id}",
    summary="Download Block",
    description="Download a text or file block (encrypted)"
)
async def download_block(session_id: str, block_id: str):
    """
    Download a block's content.

    Returns the encrypted file or text content. Client is responsible
    for decryption using the shared encryption keys.
    """
    session_id = session_id.lower()

    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    session = sessions[session_id]

    if block_id not in session.blocks:
        raise HTTPException(status_code=404, detail="Block not found")

    block = session.blocks[block_id]

    if block.type == "file":
        file_path = session.session_dir / block.filename
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="File not found")
        return FileResponse(file_path, filename=block.filename)
    elif block.type == "text":
        text_file = session.session_dir / f"text_block_{block_id}.txt"
        if not text_file.exists():
            raise HTTPException(status_code=404, detail="Text file not found")
        return FileResponse(text_file, filename=f"text_{block_id}.txt")

    raise HTTPException(status_code=400, detail="Invalid block type")


@app.websocket("/ws/{session_id}/{user_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str, user_id: str):
    session_id = session_id.lower()

    if session_id not in sessions:
        await websocket.close(code=1008, reason="Session not found")
        return

    session = sessions[session_id]

    if user_id not in session.users:
        await websocket.close(code=1008, reason="User not in session")
        return

    await websocket.accept()
    session.websockets[user_id] = websocket
    session.update_activity()

    try:
        while True:
            data = await websocket.receive_text()
            # Keep connection alive / handle ping-pong
            message = json.loads(data)
            if message.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
                session.update_activity()
    except WebSocketDisconnect:
        # Don't remove user on disconnect - they might reconnect
        # Just remove the websocket connection
        pass
    except Exception as e:
        print(f"WebSocket error: {e}")
    finally:
        # Only remove the websocket connection, not the user
        if user_id in session.websockets:
            del session.websockets[user_id]


if __name__ == "__main__":
    print(f"Starting server on {HOST}:{PORT}")
    uvicorn.run(
        app,
        host=HOST,
        port=PORT
    )
