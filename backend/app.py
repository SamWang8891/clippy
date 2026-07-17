import asyncio
import base64
import hashlib
import json
import logging
import os
import random
import secrets
import shutil
import string
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from http import HTTPStatus
from pathlib import Path
from typing import Literal

import aiofiles
import uvicorn
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

# Load environment variables
load_dotenv()

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("clippy")

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
# Per-session caps to prevent a single user from filling memory or disk.
MAX_BLOCKS_PER_SESSION = int(os.getenv("MAX_BLOCKS_PER_SESSION", "200"))
MAX_TEXT_BLOCK_LENGTH = int(os.getenv("MAX_TEXT_BLOCK_LENGTH", "1048576"))  # 1 MiB ciphertext
MAX_SESSION_BYTES_GIB = float(os.getenv("MAX_SESSION_BYTES_GIB", "5"))
MAX_SESSION_BYTES = int(MAX_SESSION_BYTES_GIB * 1024 * 1024 * 1024)
RAW_LINK_CODE_LENGTH = 4
RAW_LINK_TTL_SECONDS = int(os.getenv("RAW_LINK_TTL_SECONDS", "600"))

KDF_PREFIX = b"clippy-session-v1:"
ENCRYPTION_IV_LENGTH = 12


def server_encrypt(connection_id: str, plaintext: bytes) -> str:
    """Encrypt using the same AES-256-GCM scheme as the frontend, returning base64."""
    key = hashlib.sha256(KDF_PREFIX + connection_id.encode()).digest()
    iv = os.urandom(ENCRYPTION_IV_LENGTH)
    ciphertext_with_tag = AESGCM(key).encrypt(iv, plaintext, None)
    return base64.b64encode(iv + ciphertext_with_tag).decode("ascii")

# Initialize FastAPI app
@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Startup: restore persisted state, prune orphans, launch background tasks.

    Shutdown: flush state so the next process starts where we left off.
    """
    load_sessions_sync()
    load_raw_links_sync()

    if UPLOAD_DIR.exists():
        valid_session_ids = set(sessions.keys())
        for item in UPLOAD_DIR.iterdir():
            if item.is_dir():
                if item.name not in valid_session_ids:
                    shutil.rmtree(item, ignore_errors=True)
            elif item.name != ".gitkeep":
                try:
                    item.unlink()
                except OSError:
                    pass

    if RAW_DIR.exists():
        valid_raw_ids = set(raw_links.keys())
        for item in RAW_DIR.iterdir():
            if item.is_dir() and item.name not in valid_raw_ids:
                shutil.rmtree(item, ignore_errors=True)

    logger.info(
        "Startup: restored %d session(s), %d raw-link group(s)",
        len(sessions), len(raw_links),
    )

    cleanup_task = asyncio.create_task(cleanup_expired_sessions())
    persistence_task = asyncio.create_task(persistence_loop())

    try:
        yield
    finally:
        cleanup_task.cancel()
        persistence_task.cancel()
        for task in (cleanup_task, persistence_task):
            try:
                await task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
        try:
            await save_sessions()
        except Exception as e:  # noqa: BLE001
            logger.error("Failed to flush sessions on shutdown: %s", e)
        try:
            await save_raw_links()
        except Exception as e:  # noqa: BLE001
            logger.error("Failed to flush raw links on shutdown: %s", e)


app = FastAPI(
    title="Clippy API",
    description="Secure collaborative clipboard with real-time file and text sharing",
    version="1.5.0",
    openapi_url="/api/v1/openapi.json",
    docs_url="/api/v1/docs",
    lifespan=lifespan,
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=ALLOW_CREDENTIALS,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Storage layout: keep persistent state separate from per-session uploads so the
# state file can never collide with a session id and so it's easy to back up.
DATA_DIR = Path(os.getenv("DATA_DIR", "data"))
DATA_DIR.mkdir(exist_ok=True)
UPLOAD_DIR = DATA_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)
RAW_DIR = DATA_DIR / "raw"
RAW_DIR.mkdir(exist_ok=True)
SESSIONS_FILE = DATA_DIR / "sessions.json"
RAW_LINKS_FILE = DATA_DIR / "raw_links.json"
MAX_FILE_SIZE = int(MAX_FILE_SIZE_GIB * 1024 * 1024 * 1024)
SESSION_TIMEOUT = timedelta(seconds=SESSION_TIMEOUT_SECONDS)


# Pydantic models
class User(BaseModel):
    id: str
    name: str
    is_host: bool


BlockType = Literal["text", "file"]


class Block(BaseModel):
    id: str
    type: BlockType
    content: str | None = None
    filename: str | None = None
    original_filename: str | None = None
    created_by: str
    created_at: str


class SessionInfo(BaseModel):
    connection_id: str
    users: list[User]
    blocks: list[Block]
    allow_join: bool
    allow_curl_upload: bool
    host_id: str


class CreateSessionRequest(BaseModel):
    user_name: str | None = Field(default=None, max_length=64)


class JoinSessionRequest(BaseModel):
    connection_id: str = Field(min_length=1, max_length=64)
    user_name: str | None = Field(default=None, max_length=64)


class CreateBlockRequest(BaseModel):
    connection_id: str = Field(min_length=1, max_length=64)
    user_id: str = Field(min_length=1, max_length=64)
    type: BlockType
    content: str | None = Field(default=None, max_length=MAX_TEXT_BLOCK_LENGTH)


class DeleteBlockRequest(BaseModel):
    connection_id: str = Field(min_length=1, max_length=64)
    user_id: str = Field(min_length=1, max_length=64)
    block_id: str = Field(min_length=1, max_length=64)


class UpdateTextBlockRequest(BaseModel):
    connection_id: str = Field(min_length=1, max_length=64)
    user_id: str = Field(min_length=1, max_length=64)
    block_id: str = Field(min_length=1, max_length=64)
    content: str = Field(max_length=MAX_TEXT_BLOCK_LENGTH)


class TransferHostRequest(BaseModel):
    connection_id: str = Field(min_length=1, max_length=64)
    current_host_id: str = Field(min_length=1, max_length=64)
    new_host_id: str = Field(min_length=1, max_length=64)


class ToggleJoinRequest(BaseModel):
    connection_id: str = Field(min_length=1, max_length=64)
    user_id: str = Field(min_length=1, max_length=64)
    allow_join: bool


class ToggleCurlRequest(BaseModel):
    connection_id: str = Field(min_length=1, max_length=64)
    user_id: str = Field(min_length=1, max_length=64)
    allow_curl_upload: bool


class RawLink(BaseModel):
    code: str
    connection_id: str
    block_id: str
    content_type: Literal["text", "file"]
    filename: str
    original_filename: str | None = None
    created_at: str


class CreateRawTextRequest(BaseModel):
    connection_id: str = Field(min_length=1, max_length=64)
    user_id: str = Field(min_length=1, max_length=64)
    block_id: str = Field(min_length=1, max_length=64)
    content: str = Field(max_length=MAX_TEXT_BLOCK_LENGTH)


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
        self.users: dict[str, User] = {
            host_id: User(id=host_id, name=host_name, is_host=True)
        }
        self.blocks: dict[str, Block] = {}
        self.block_bytes: dict[str, int] = {}  # block_id -> byte size on disk
        self.total_bytes = 0
        self.allow_join = True
        self.allow_curl_upload = False
        self.last_activity = datetime.now()
        self.websockets: dict[str, WebSocket] = {}
        # Pending eviction tasks keyed by user_id so reconnects can cancel them.
        self.pending_disconnects: dict[str, asyncio.Task] = {}
        self.session_dir = UPLOAD_DIR / connection_id
        self.session_dir.mkdir(exist_ok=True)

    def has_member(self, user_id: str) -> bool:
        return user_id in self.users

    def quota_check(self, additional_bytes: int = 0) -> str | None:
        """Return None if quota is OK, else a human-readable error reason."""
        if len(self.blocks) >= MAX_BLOCKS_PER_SESSION:
            return f"Block limit reached ({MAX_BLOCKS_PER_SESSION})"
        if self.total_bytes + additional_bytes > MAX_SESSION_BYTES:
            return f"Session storage quota exceeded ({MAX_SESSION_BYTES} bytes)"
        return None

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

    def add_block(self, block: Block, byte_size: int = 0):
        """Add a new text or file block to the session and account for its size."""
        self.blocks[block.id] = block
        self.block_bytes[block.id] = byte_size
        self.total_bytes += byte_size
        self.update_activity()

    def delete_block(self, block_id: str):
        """Delete a block and its associated files from the session."""
        if block_id in self.blocks:
            block = self.blocks[block_id]
            if block.type == "file" and block.filename:
                file_path = self.session_dir / block.filename
                if file_path.exists():
                    file_path.unlink()
            elif block.type == "text":
                text_file = self.session_dir / f"text_block_{block_id}.txt"
                if text_file.exists():
                    text_file.unlink()
            del self.blocks[block_id]
            self.total_bytes -= self.block_bytes.pop(block_id, 0)
        self.update_activity()

    async def broadcast(self, message: dict, exclude_user: str | None = None):
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
            except Exception:  # noqa: BLE001 — broadcasts must keep going if one socket dies.
                pass

    def to_dict(self) -> dict:
        """Serialize persistable session state. Sockets and tasks are runtime-only."""
        return {
            "connection_id": self.connection_id,
            "users": {uid: u.model_dump() for uid, u in self.users.items()},
            "blocks": {bid: b.model_dump() for bid, b in self.blocks.items()},
            "block_bytes": self.block_bytes,
            "allow_join": self.allow_join,
            "allow_curl_upload": self.allow_curl_upload,
            "last_activity": self.last_activity.isoformat(),
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Session":
        instance = cls.__new__(cls)
        instance.connection_id = data["connection_id"]
        instance.users = {uid: User(**u) for uid, u in data.get("users", {}).items()}
        instance.blocks = {bid: Block(**b) for bid, b in data.get("blocks", {}).items()}
        instance.block_bytes = dict(data.get("block_bytes", {}))
        instance.total_bytes = sum(instance.block_bytes.values())
        instance.allow_join = data.get("allow_join", True)
        instance.allow_curl_upload = data.get("allow_curl_upload", False)
        instance.last_activity = datetime.fromisoformat(data["last_activity"])
        instance.websockets = {}
        instance.pending_disconnects = {}
        instance.session_dir = UPLOAD_DIR / instance.connection_id
        instance.session_dir.mkdir(exist_ok=True)
        return instance


# Global session storage - Maps connection_id to Session objects
sessions: dict[str, Session] = {}

# Persistence: snapshot session metadata to disk so a restart doesn't wipe state.
# A dirty flag + periodic flush avoids touching the disk on every mutation.
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
        with open(SESSIONS_FILE, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        logger.error("Failed to load sessions snapshot: %s", e)
        return

    for sid, sdata in data.items():
        try:
            sessions[sid] = Session.from_dict(sdata)
        except Exception as e:  # noqa: BLE001
            logger.warning("Skipping malformed session %s: %s", sid, e)


async def persistence_loop() -> None:
    """Background task that flushes dirty flags at a fixed interval."""
    global _sessions_dirty, _raw_links_dirty
    while True:
        try:
            await asyncio.sleep(PERSIST_INTERVAL_SECONDS)
        except asyncio.CancelledError:
            return
        if _sessions_dirty:
            _sessions_dirty = False
            try:
                await save_sessions()
            except Exception as e:  # noqa: BLE001
                _sessions_dirty = True
                logger.error("Failed to persist sessions: %s", e)
        if _raw_links_dirty:
            _raw_links_dirty = False
            try:
                await save_raw_links()
            except Exception as e:  # noqa: BLE001
                _raw_links_dirty = True
                logger.error("Failed to persist raw links: %s", e)


# Raw-link storage — decoupled from sessions so links survive session teardown.
raw_links: dict[str, dict[str, RawLink]] = {}  # connection_id -> {code -> RawLink}
raw_link_expiry: dict[str, datetime] = {}  # connection_id -> when to delete
_raw_links_dirty = False


def mark_raw_links_dirty() -> None:
    global _raw_links_dirty
    _raw_links_dirty = True


async def save_raw_links() -> None:
    payload = json.dumps({
        "links": {
            cid: {code: rl.model_dump() for code, rl in links.items()}
            for cid, links in raw_links.items()
        },
        "expiry": {cid: dt.isoformat() for cid, dt in raw_link_expiry.items()},
    })
    tmp_path = RAW_LINKS_FILE.with_suffix(".tmp")
    async with aiofiles.open(tmp_path, "w", encoding="utf-8") as f:
        await f.write(payload)
    os.replace(tmp_path, RAW_LINKS_FILE)


def load_raw_links_sync() -> None:
    if not RAW_LINKS_FILE.exists():
        return
    try:
        with open(RAW_LINKS_FILE, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        logger.error("Failed to load raw links snapshot: %s", e)
        return
    for cid, links in data.get("links", {}).items():
        try:
            raw_links[cid] = {code: RawLink(**rl) for code, rl in links.items()}
        except Exception as e:  # noqa: BLE001
            logger.warning("Skipping malformed raw links for %s: %s", cid, e)
    for cid, dt_str in data.get("expiry", {}).items():
        try:
            raw_link_expiry[cid] = datetime.fromisoformat(dt_str)
        except (ValueError, TypeError) as e:
            logger.warning("Skipping malformed raw link expiry for %s: %s", cid, e)


def api_response(status: HTTPStatus, message: str, data: dict | None = None) -> JSONResponse:
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
    Generate a unique connection ID using lowercase letters and digits.

    Returns None only when the keyspace is genuinely exhausted; otherwise the
    capped attempt loop will find a free ID with overwhelming probability long
    before the cap is hit.
    """
    chars = string.ascii_lowercase + string.digits
    max_possible = len(chars) ** CONNECTION_ID_LENGTH

    if len(sessions) >= max_possible:
        return None

    for _ in range(min(max_possible, 1000)):
        candidate = "".join(random.choices(chars, k=CONNECTION_ID_LENGTH))
        if candidate not in sessions:
            return candidate

    return None


def generate_raw_code(connection_id: str) -> str | None:
    existing = raw_links.get(connection_id, {})
    chars = string.ascii_lowercase + string.digits
    for _ in range(1000):
        code = "".join(secrets.choice(chars) for _ in range(RAW_LINK_CODE_LENGTH))
        if code not in existing:
            return code
    return None


_NAME_ADJECTIVES = (
    "Happy", "Clever", "Swift", "Bright", "Cool", "Smart", "Quick", "Calm", "Bold", "Wise",
    "Brave", "Gentle", "Lively", "Witty", "Agile", "Keen", "Noble", "Proud", "Merry", "Jolly",
    "Fierce", "Loyal", "Mighty", "Lucky", "Sunny", "Silent", "Golden", "Silver", "Crystal", "Cosmic",
    "Mystic", "Shadow", "Radiant", "Wild", "Chill", "Vivid", "Daring", "Curious", "Sneaky", "Fluffy",
)
_NAME_NOUNS = (
    "Panda", "Tiger", "Eagle", "Dolphin", "Fox", "Wolf", "Bear", "Hawk", "Lion", "Owl",
    "Falcon", "Otter", "Raven", "Phoenix", "Dragon", "Panther", "Koala", "Penguin", "Rabbit", "Deer",
    "Lynx", "Jaguar", "Cheetah", "Whale", "Shark", "Cobra", "Turtle", "Crane", "Swan", "Parrot",
    "Husky", "Corgi", "Gecko", "Lemur", "Badger", "Beaver", "Moose", "Elk", "Bison", "Raccoon",
)


def generate_random_name() -> str:
    """Generate a random user name like ``HappyPanda`` or ``CleverFox``."""
    return f"{random.choice(_NAME_ADJECTIVES)}{random.choice(_NAME_NOUNS)}"


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
        except Exception:  # noqa: BLE001 — WebSocket may already be closed; nothing actionable.
            pass
    session.websockets.clear()

    if session.session_dir.exists():
        shutil.rmtree(session.session_dir, ignore_errors=True)

    if connection_id in raw_links:
        raw_link_expiry[connection_id] = datetime.now() + timedelta(seconds=RAW_LINK_TTL_SECONDS)
        mark_raw_links_dirty()

    mark_sessions_dirty()


async def cleanup_expired_sessions():
    """Periodically reap sessions and stale raw links."""
    while True:
        try:
            await asyncio.sleep(60)
        except asyncio.CancelledError:
            return
        expired = [sid for sid, session in sessions.items() if session.is_expired()]
        for sid in expired:
            await _teardown_session(sid, "timeout")

        now = datetime.now()
        stale = [cid for cid, exp in raw_link_expiry.items() if now > exp]
        for cid in stale:
            raw_links.pop(cid, None)
            raw_link_expiry.pop(cid, None)
            raw_dir = RAW_DIR / cid
            if raw_dir.exists():
                shutil.rmtree(raw_dir, ignore_errors=True)
        if stale:
            mark_raw_links_dirty()


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
async def get_session(connection_id: str, user_id: str):
    """
    Get detailed information about a session. The caller must be a member.
    """
    connection_id = connection_id.lower()

    if connection_id not in sessions:
        return api_response(HTTPStatus.NOT_FOUND, "Session not found")

    session = sessions[connection_id]
    if not session.has_member(user_id):
        return api_response(HTTPStatus.FORBIDDEN, "User not in session")

    session_info = SessionInfo(
        connection_id=connection_id,
        users=list(session.users.values()),
        blocks=list(session.blocks.values()),
        allow_join=session.allow_join,
        allow_curl_upload=session.allow_curl_upload,
        host_id=next((u.id for u in session.users.values() if u.is_host), ""),
    )

    return api_response(
        HTTPStatus.OK,
        "Session retrieved",
        session_info.model_dump(),
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
    "/api/v1/session/toggle_curl",
    summary="Toggle Curl Upload",
    description="Enable or disable curl-based uploads to the session (host only)"
)
async def toggle_curl(request: ToggleCurlRequest):
    connection_id = request.connection_id.lower()

    if connection_id not in sessions:
        return api_response(HTTPStatus.NOT_FOUND, "Session not found")

    session = sessions[connection_id]

    if request.user_id not in session.users or not session.users[request.user_id].is_host:
        return api_response(HTTPStatus.FORBIDDEN, "Only host can toggle curl upload")

    session.allow_curl_upload = request.allow_curl_upload
    session.update_activity()

    await session.broadcast({
        "type": "curl_permission_changed",
        "allow_curl_upload": request.allow_curl_upload,
    })

    return api_response(HTTPStatus.OK, "Curl upload permission updated", {"success": True})


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
        return api_response(HTTPStatus.NOT_FOUND, "Session not found")

    session = sessions[connection_id]

    if not session.has_member(request.user_id):
        return api_response(HTTPStatus.FORBIDDEN, "User not in session")

    content_bytes = len(request.content.encode("utf-8")) if request.content else 0
    quota_error = session.quota_check(content_bytes)
    if quota_error is not None:
        return api_response(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, quota_error)

    block_id = str(uuid.uuid4())
    block = Block(
        id=block_id,
        type=request.type,
        content=request.content,
        created_by=request.user_id,
        created_at=datetime.now().isoformat(),
    )

    if request.type == "text" and request.content:
        text_file = session.session_dir / f"text_block_{block_id}.txt"
        async with aiofiles.open(text_file, "w", encoding="utf-8") as f:
            await f.write(request.content)

    session.add_block(block, byte_size=content_bytes)

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
        connection_id: str = Form(...),  # noqa: B008 — FastAPI dependency markers.
        user_id: str = Form(...),  # noqa: B008
        file: UploadFile = File(...),  # noqa: B008
):
    """
    Upload a file to the session.

    Files should be encrypted client-side before upload. The file is
    saved to the session directory and broadcasted to all users.
    Maximum file size is configurable (default 1 GiB).
    """
    connection_id = connection_id.lower()

    if connection_id not in sessions:
        return api_response(HTTPStatus.NOT_FOUND, "Session not found")

    session = sessions[connection_id]

    if not session.has_member(user_id):
        return api_response(HTTPStatus.FORBIDDEN, "User not in session")

    quota_error = session.quota_check(0)
    if quota_error is not None:
        return api_response(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, quota_error)

    block_id = str(uuid.uuid4())

    # Only keep the suffix from the user-supplied name and strip directory characters
    # so a malicious filename like "../../etc/passwd" can't escape the session dir.
    raw_suffix = Path(file.filename or "").suffix
    safe_suffix = "".join(c for c in raw_suffix if c.isalnum() or c in "._-")[:32]
    safe_filename = f"file_{block_id}{safe_suffix}"
    file_path = session.session_dir / safe_filename

    # Per-request hard cap; also re-check the per-session quota mid-stream so a
    # single huge upload can't exceed the session bytes budget.
    per_session_remaining = MAX_SESSION_BYTES - session.total_bytes
    effective_cap = min(MAX_FILE_SIZE, per_session_remaining)
    chunk_size = 1024 * 1024
    bytes_written = 0
    overflow = False
    try:
        async with aiofiles.open(file_path, "wb") as f:
            while True:
                chunk = await file.read(chunk_size)
                if not chunk:
                    break
                bytes_written += len(chunk)
                if bytes_written > effective_cap:
                    overflow = True
                    break
                await f.write(chunk)
    except Exception:
        if file_path.exists():
            file_path.unlink()
        raise

    if overflow:
        if file_path.exists():
            file_path.unlink()
        message = (
            f"File too large. Max size: {MAX_FILE_SIZE} bytes"
            if bytes_written > MAX_FILE_SIZE
            else "Session storage quota exceeded"
        )
        return api_response(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, message)

    block = Block(
        id=block_id,
        type="file",
        filename=safe_filename,
        original_filename=file.filename,
        created_by=user_id,
        created_at=datetime.now().isoformat(),
    )

    session.add_block(block, byte_size=bytes_written)

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


@app.patch(
    "/api/v1/block/update",
    summary="Update Text Block",
    description="Replace the content of an existing text block"
)
async def update_text_block(request: UpdateTextBlockRequest):
    """
    Update an existing text block's content in place.

    Keeps the block's id and created_at, so the ledger order is preserved.
    Content should be encrypted client-side before sending.
    """
    connection_id = request.connection_id.lower()

    if connection_id not in sessions:
        return api_response(HTTPStatus.NOT_FOUND, "Session not found")

    session = sessions[connection_id]

    if not session.has_member(request.user_id):
        return api_response(HTTPStatus.FORBIDDEN, "User not in session")

    block = session.blocks.get(request.block_id)
    if block is None:
        return api_response(HTTPStatus.NOT_FOUND, "Block not found")

    if block.type != "text":
        return api_response(HTTPStatus.BAD_REQUEST, "Block is not a text block")

    new_bytes = len(request.content.encode("utf-8")) if request.content else 0
    old_bytes = session.block_bytes.get(request.block_id, 0)
    delta = new_bytes - old_bytes
    if delta > 0:
        quota_error = session.quota_check(delta)
        if quota_error is not None:
            return api_response(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, quota_error)

    block.content = request.content
    session.block_bytes[request.block_id] = new_bytes
    session.total_bytes += delta

    text_file = session.session_dir / f"text_block_{request.block_id}.txt"
    async with aiofiles.open(text_file, "w", encoding="utf-8") as f:
        await f.write(request.content)

    session.update_activity()

    await session.broadcast({
        "type": "block_updated",
        "block": block.model_dump(),
    })

    return api_response(
        HTTPStatus.OK,
        "Block updated",
        {"block": block.model_dump()},
    )


@app.post(
    "/api/v1/block/replace",
    summary="Replace File Block",
    description="Upload a new file to replace the contents of an existing file block"
)
async def replace_file_block(
        connection_id: str = Form(...),  # noqa: B008
        user_id: str = Form(...),  # noqa: B008
        block_id: str = Form(...),  # noqa: B008
        file: UploadFile = File(...),  # noqa: B008
):
    """
    Replace the file backing an existing file block.

    Keeps the block's id and created_at so ledger order stays stable. The
    incoming file is streamed with the same size-cap and session-quota
    checks as the initial upload.
    """
    connection_id = connection_id.lower()

    if connection_id not in sessions:
        return api_response(HTTPStatus.NOT_FOUND, "Session not found")

    session = sessions[connection_id]

    if not session.has_member(user_id):
        return api_response(HTTPStatus.FORBIDDEN, "User not in session")

    block = session.blocks.get(block_id)
    if block is None:
        return api_response(HTTPStatus.NOT_FOUND, "Block not found")

    if block.type != "file":
        return api_response(HTTPStatus.BAD_REQUEST, "Block is not a file block")

    old_bytes = session.block_bytes.get(block_id, 0)
    old_filename = block.filename

    # Remaining quota excludes the old file's contribution, since we're replacing it.
    per_session_remaining = MAX_SESSION_BYTES - (session.total_bytes - old_bytes)
    effective_cap = min(MAX_FILE_SIZE, per_session_remaining)

    raw_suffix = Path(file.filename or "").suffix
    safe_suffix = "".join(c for c in raw_suffix if c.isalnum() or c in "._-")[:32]
    safe_filename = f"file_{block_id}{safe_suffix}"
    file_path = session.session_dir / safe_filename

    # Write new file to a temp name first so a failure doesn't nuke the existing upload.
    tmp_path = session.session_dir / f"{safe_filename}.new"
    chunk_size = 1024 * 1024
    bytes_written = 0
    overflow = False
    try:
        async with aiofiles.open(tmp_path, "wb") as f:
            while True:
                chunk = await file.read(chunk_size)
                if not chunk:
                    break
                bytes_written += len(chunk)
                if bytes_written > effective_cap:
                    overflow = True
                    break
                await f.write(chunk)
    except Exception:
        if tmp_path.exists():
            tmp_path.unlink()
        raise

    if overflow:
        if tmp_path.exists():
            tmp_path.unlink()
        message = (
            f"File too large. Max size: {MAX_FILE_SIZE} bytes"
            if bytes_written > MAX_FILE_SIZE
            else "Session storage quota exceeded"
        )
        return api_response(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, message)

    if old_filename and old_filename != safe_filename:
        old_path = session.session_dir / old_filename
        if old_path.exists():
            old_path.unlink()

    os.replace(tmp_path, file_path)

    block.filename = safe_filename
    block.original_filename = file.filename
    session.block_bytes[block_id] = bytes_written
    session.total_bytes = session.total_bytes - old_bytes + bytes_written
    session.update_activity()

    await session.broadcast({
        "type": "block_updated",
        "block": block.model_dump(),
    })

    return api_response(
        HTTPStatus.OK,
        "File replaced",
        {"block": block.model_dump()},
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
async def download_block(connection_id: str, block_id: str, user_id: str):
    """
    Stream a block's encrypted content. The caller must be a session member.

    The response uses ``application/octet-stream`` so browsers don't try to
    sniff or render what is actually opaque ciphertext.
    """
    connection_id = connection_id.lower()

    if connection_id not in sessions:
        return api_response(HTTPStatus.NOT_FOUND, "Session not found")

    session = sessions[connection_id]

    if not session.has_member(user_id):
        return api_response(HTTPStatus.FORBIDDEN, "User not in session")

    block = session.blocks.get(block_id)
    if block is None:
        return api_response(HTTPStatus.NOT_FOUND, "Block not found")

    headers = {"Cache-Control": "no-store"}

    if block.type == "file" and block.filename:
        file_path = session.session_dir / block.filename
        if not file_path.exists():
            return api_response(HTTPStatus.NOT_FOUND, "File not found")
        download_filename = block.original_filename or block.filename
        return FileResponse(
            file_path,
            filename=download_filename,
            media_type="application/octet-stream",
            headers=headers,
        )
    if block.type == "text":
        text_file = session.session_dir / f"text_block_{block_id}.txt"
        if not text_file.exists():
            return api_response(HTTPStatus.NOT_FOUND, "Text file not found")
        return FileResponse(
            text_file,
            filename=f"text_{block_id}.txt",
            media_type="application/octet-stream",
            headers=headers,
        )

    return api_response(HTTPStatus.BAD_REQUEST, "Invalid block type")


# --- Raw link endpoints ---


@app.post(
    "/api/v1/raw/text",
    summary="Create Raw Text Link",
    description="Generate a public short link that serves the decrypted text"
)
async def create_raw_text_link(request: CreateRawTextRequest):
    connection_id = request.connection_id.lower()

    if connection_id not in sessions:
        return api_response(HTTPStatus.NOT_FOUND, "Session not found")

    session = sessions[connection_id]
    if not session.has_member(request.user_id):
        return api_response(HTTPStatus.FORBIDDEN, "User not in session")
    if request.block_id not in session.blocks:
        return api_response(HTTPStatus.NOT_FOUND, "Block not found")

    code = generate_raw_code(connection_id)
    if code is None:
        return api_response(HTTPStatus.SERVICE_UNAVAILABLE, "Unable to generate raw link")

    raw_dir = RAW_DIR / connection_id
    raw_dir.mkdir(exist_ok=True)
    filename = f"{code}.txt"
    async with aiofiles.open(raw_dir / filename, "w", encoding="utf-8") as f:
        await f.write(request.content)

    link = RawLink(
        code=code,
        connection_id=connection_id,
        block_id=request.block_id,
        content_type="text",
        filename=filename,
        created_at=datetime.now().isoformat(),
    )
    raw_links.setdefault(connection_id, {})[code] = link
    mark_raw_links_dirty()

    return api_response(HTTPStatus.OK, "Raw link created", {"code": code})


@app.post(
    "/api/v1/raw/file",
    summary="Create Raw File Link",
    description="Generate a public short link that serves the decrypted file"
)
async def create_raw_file_link(
        connection_id: str = Form(...),  # noqa: B008
        user_id: str = Form(...),  # noqa: B008
        block_id: str = Form(...),  # noqa: B008
        original_filename: str = Form(""),  # noqa: B008
        file: UploadFile = File(...),  # noqa: B008
):
    connection_id = connection_id.lower()

    if connection_id not in sessions:
        return api_response(HTTPStatus.NOT_FOUND, "Session not found")

    session = sessions[connection_id]
    if not session.has_member(user_id):
        return api_response(HTTPStatus.FORBIDDEN, "User not in session")
    if block_id not in session.blocks:
        return api_response(HTTPStatus.NOT_FOUND, "Block not found")

    code = generate_raw_code(connection_id)
    if code is None:
        return api_response(HTTPStatus.SERVICE_UNAVAILABLE, "Unable to generate raw link")

    raw_suffix = Path(original_filename or file.filename or "").suffix
    safe_suffix = "".join(c for c in raw_suffix if c.isalnum() or c in "._-")[:32]
    filename = f"{code}{safe_suffix}"

    raw_dir = RAW_DIR / connection_id
    raw_dir.mkdir(exist_ok=True)
    file_path = raw_dir / filename

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
        file_path.unlink(missing_ok=True)
        raise

    if bytes_written > MAX_FILE_SIZE:
        file_path.unlink(missing_ok=True)
        return api_response(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "File too large")

    link = RawLink(
        code=code,
        connection_id=connection_id,
        block_id=block_id,
        content_type="file",
        filename=filename,
        original_filename=original_filename or file.filename or "download",
        created_at=datetime.now().isoformat(),
    )
    raw_links.setdefault(connection_id, {})[code] = link
    mark_raw_links_dirty()

    return api_response(HTTPStatus.OK, "Raw link created", {"code": code})


@app.get("/r/{connection_id}/{code}")
async def serve_raw_link(connection_id: str, code: str):
    connection_id = connection_id.lower()
    code = code.lower()

    session_links = raw_links.get(connection_id)
    if not session_links:
        return api_response(HTTPStatus.NOT_FOUND, "Link not found")

    link = session_links.get(code)
    if not link:
        return api_response(HTTPStatus.NOT_FOUND, "Link not found")

    expiry = raw_link_expiry.get(connection_id)
    if expiry and datetime.now() > expiry:
        return api_response(HTTPStatus.GONE, "Link expired")

    raw_file = RAW_DIR / connection_id / link.filename
    if not raw_file.exists():
        return api_response(HTTPStatus.NOT_FOUND, "Content not found")

    if link.content_type == "text":
        return FileResponse(
            raw_file,
            media_type="text/plain; charset=utf-8",
            headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
        )

    return FileResponse(
        raw_file,
        filename=link.original_filename or "download",
        media_type="application/octet-stream",
        headers={"Cache-Control": "no-store"},
    )


@app.post("/u/{connection_id}")
async def curl_upload(connection_id: str, request: Request):
    """Accept text or file uploads via curl.

    Text: ``curl -d 'hello' https://host/u/SESSION_ID``
    File: ``curl -F f=@file.txt https://host/u/SESSION_ID``
    """
    connection_id = connection_id.lower()

    if connection_id not in sessions:
        return JSONResponse(status_code=404, content={"ok": False, "error": "Session not found"})

    session = sessions[connection_id]

    if not session.allow_curl_upload:
        return JSONResponse(status_code=403, content={"ok": False, "error": "Curl upload is not enabled"})

    content_type = request.headers.get("content-type", "")

    if content_type.startswith("multipart/form-data"):
        form = await request.form()
        try:
            upload = form.get("f")
            if upload is None or not hasattr(upload, "read"):
                return JSONResponse(status_code=400, content={"ok": False, "error": "Missing file field 'f'"})

            file_bytes = await upload.read()

            if len(file_bytes) > MAX_FILE_SIZE:
                return JSONResponse(status_code=413, content={"ok": False, "error": "File too large"})

            encrypted_b64 = server_encrypt(connection_id, file_bytes)
            encrypted_payload = encrypted_b64.encode("utf-8")

            quota_error = session.quota_check(len(encrypted_payload))
            if quota_error:
                return JSONResponse(status_code=413, content={"ok": False, "error": quota_error})

            block_id = str(uuid.uuid4())
            raw_suffix = Path(upload.filename or "").suffix
            safe_suffix = "".join(c for c in raw_suffix if c.isalnum() or c in "._-")[:32]
            safe_filename = f"file_{block_id}{safe_suffix}"
            file_path = session.session_dir / safe_filename

            async with aiofiles.open(file_path, "wb") as f:
                await f.write(encrypted_payload)

            block = Block(
                id=block_id,
                type="file",
                filename=safe_filename,
                original_filename=upload.filename or "upload",
                created_by="__curl__",
                created_at=datetime.now().isoformat(),
            )
            session.add_block(block, byte_size=len(encrypted_payload))

            await session.broadcast({"type": "block_created", "block": block.model_dump()})
            return JSONResponse(status_code=200, content={"ok": True, "id": block_id})
        finally:
            await form.close()
    else:
        body = await request.body()
        if not body or not body.strip():
            return JSONResponse(status_code=400, content={"ok": False, "error": "Empty body"})

        text = body.decode("utf-8", errors="replace")
        encrypted_b64 = server_encrypt(connection_id, text.encode("utf-8"))

        content_bytes = len(encrypted_b64.encode("utf-8"))
        if content_bytes > MAX_TEXT_BLOCK_LENGTH:
            return JSONResponse(status_code=413, content={"ok": False, "error": "Text too large"})

        quota_error = session.quota_check(content_bytes)
        if quota_error:
            return JSONResponse(status_code=413, content={"ok": False, "error": quota_error})

        block_id = str(uuid.uuid4())
        block = Block(
            id=block_id,
            type="text",
            content=encrypted_b64,
            created_by="__curl__",
            created_at=datetime.now().isoformat(),
        )

        text_file = session.session_dir / f"text_block_{block_id}.txt"
        async with aiofiles.open(text_file, "w", encoding="utf-8") as f:
            await f.write(encrypted_b64)

        session.add_block(block, byte_size=content_bytes)

        await session.broadcast({"type": "block_created", "block": block.model_dump()})
        return JSONResponse(status_code=200, content={"ok": True, "id": block_id})


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
    except Exception as e:  # noqa: BLE001 — log and clean up regardless of cause.
        logger.warning("WebSocket error: %s", e)
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
