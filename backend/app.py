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
from fastapi import APIRouter, FastAPI, File, Form, Request, UploadFile, WebSocket, WebSocketDisconnect
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
# Everything an id may contain. It becomes a directory name under UPLOAD_DIR,
# so this set is a filesystem guard as much as a format rule.
CONNECTION_ID_ALPHABET = string.ascii_lowercase + string.digits
# i/o/e/0/1 are dropped from *generated* ids on purpose: they are the characters
# people confuse on screen (i vs 1, o vs 0) or mishear when an id is read aloud
# across Mandarin and English (e). A caller naming its own id has chosen to own
# that risk, so the restriction stops at the generator.
CONNECTION_ID_EXCLUDED = "ioe01"
CONNECTION_ID_GENERATED_ALPHABET = "".join(
    c for c in CONNECTION_ID_ALPHABET if c not in CONNECTION_ID_EXCLUDED
)
# Grace period before a disconnected user is removed from the session, allowing
# brief network blips and page refreshes to reconnect without churn.
DISCONNECT_GRACE_SECONDS = int(os.getenv("DISCONNECT_GRACE_SECONDS", "10"))
# Per-session caps to prevent a single user from filling memory or disk.
MAX_BLOCKS_PER_SESSION = int(os.getenv("MAX_BLOCKS_PER_SESSION", "200"))
MAX_TEXT_BLOCK_LENGTH = int(os.getenv("MAX_TEXT_BLOCK_LENGTH", "1048576"))  # 1 MiB ciphertext
MAX_SESSION_BYTES_GIB = float(os.getenv("MAX_SESSION_BYTES_GIB", "5"))
MAX_SESSION_BYTES = int(MAX_SESSION_BYTES_GIB * 1024 * 1024 * 1024)
RAW_LINK_CODE_LENGTH = 6
RAW_LINK_TTL_SECONDS = int(os.getenv("RAW_LINK_TTL_SECONDS", "600"))
MAX_RAW_LINKS_PER_SESSION = int(os.getenv("MAX_RAW_LINKS_PER_SESSION", "50"))
# The curl path has to hold the whole body, its ciphertext and the base64 of that
# in memory at once (AES-GCM is single-shot and the browser decrypts one blob),
# so peak RSS is ~2.7x this value. Keep it well under the box's RAM — it is a
# separate, much smaller cap than MAX_FILE_SIZE for exactly that reason.
MAX_CURL_UPLOAD_BYTES = int(os.getenv("MAX_CURL_UPLOAD_MIB", "64")) * 1024 * 1024
# Serve interactive API docs only when explicitly enabled.
ENABLE_DOCS = os.getenv("ENABLE_DOCS", "").lower() in ("1", "true", "yes")

# Wire-format constant, NOT an API version: it is baked into the key derivation
# and must byte-match KDF_PREFIX in frontend/src/utils/encryption.js. Changing it
# makes every previously stored block undecryptable. Do not sweep it with an
# api-version find/replace — tests/test_crypto_interop.py pins the derived key.
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
    version="2.1.0",
    openapi_url="/api/v2/openapi.json" if ENABLE_DOCS else None,
    docs_url="/api/v2/docs" if ENABLE_DOCS else None,
    redoc_url=None,
    lifespan=lifespan,
)

router = APIRouter(
    prefix="/api/v2",
    tags=["newest-endpoints"],
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
    """Public view of a member. Safe to broadcast — holds no credential.

    ``id`` identifies a member to everyone else (so hosts can target a
    transfer); the member's *secret* token lives in ``Session.tokens`` and is
    never serialized. Conflating the two let any member read the host's
    credential out of the user list and seize the session.
    """

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
    size: int = 0
    created_by: str
    created_at: str


class SessionInfo(BaseModel):
    connection_id: str
    users: list[User]
    blocks: list[Block]
    allow_join: bool
    allow_curl_upload: bool
    is_public: bool
    host_id: str


class CreateSessionRequest(BaseModel):
    user_name: str | None = Field(default=None, max_length=64)
    # Optional vanity id. Validated against CONNECTION_ID_ALPHABET before use —
    # it ends up as a directory name under UPLOAD_DIR, so nothing outside
    # [a-z0-9] may ever reach the filesystem.
    connection_id: str | None = Field(default=None, max_length=64)


class JoinSessionRequest(BaseModel):
    connection_id: str = Field(min_length=1, max_length=64)
    user_name: str | None = Field(default=None, max_length=64)


class CreateBlockRequest(BaseModel):
    connection_id: str = Field(min_length=1, max_length=64)
    user_id: str = Field(min_length=1, max_length=64)
    # Only text blocks are creatable here — a "file" block created without an
    # upload has no filename and can never be downloaded.
    type: Literal["text"] = "text"
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


class DestroySessionRequest(BaseModel):
    connection_id: str = Field(min_length=1, max_length=64)
    user_id: str = Field(min_length=1, max_length=64)


class TransferHostRequest(BaseModel):
    connection_id: str = Field(min_length=1, max_length=64)
    # Caller's secret token; `new_host_id` is the target's *public* id.
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


class TogglePublicRequest(BaseModel):
    connection_id: str = Field(min_length=1, max_length=64)
    user_id: str = Field(min_length=1, max_length=64)
    is_public: bool


class RawLink(BaseModel):
    code: str
    connection_id: str
    block_id: str
    content_type: Literal["text", "file"]
    filename: str
    original_filename: str | None = None
    created_at: str
    # Absolute expiry, set at creation. Previously links had no expiry at all
    # while the session lived, so RAW_LINK_TTL_SECONDS only applied after the
    # session was destroyed and a shared link was effectively permanent.
    expires_at: str
    size: int = 0


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

    def __init__(self, connection_id: str, host_token: str, host_id: str, host_name: str):
        """Initialize a new session with a host user."""
        self.connection_id = connection_id
        # Lobby label, fixed at creation. Tracking the current host instead made
        # a listed room rename itself on a host transfer and fall back to a
        # placeholder once everyone had left.
        self.name = host_name
        self.users: dict[str, User] = {
            host_id: User(id=host_id, name=host_name, is_host=True)
        }
        # Secret member token -> public user id. Never serialized to clients.
        self.tokens: dict[str, str] = {host_token: host_id}
        self.blocks: dict[str, Block] = {}
        self.block_bytes: dict[str, int] = {}  # block_id -> byte size on disk
        self.total_bytes = 0
        # Bytes promised to in-flight uploads that have not yet been committed,
        # so concurrent uploads can't all size themselves off the same baseline.
        self.reserved_bytes = 0
        self.allow_join = True
        self.allow_curl_upload = False
        # Private until the host says otherwise: publishing a session publishes
        # its connection id, which is also the KDF input, so anyone reading the
        # lobby can read the content. That has to be a deliberate act.
        self.is_public = False
        self.created_at = datetime.now()
        self.last_activity = datetime.now()
        self.websockets: dict[str, set[WebSocket]] = {}
        # Pending eviction tasks keyed by public user id so reconnects can cancel them.
        self.pending_disconnects: dict[str, asyncio.Task] = {}
        self.session_dir = UPLOAD_DIR / connection_id
        self.session_dir.mkdir(exist_ok=True)

    def member_id(self, token: str) -> str | None:
        """Resolve a secret member token to its public user id, or None."""
        return self.tokens.get(token)

    def is_host_token(self, token: str) -> bool:
        uid = self.tokens.get(token)
        return uid is not None and self.users[uid].is_host

    def committed_bytes(self) -> int:
        return self.total_bytes + self.reserved_bytes

    def quota_check(self, additional_bytes: int = 0) -> str | None:
        """Return None if quota is OK, else a human-readable error reason."""
        if len(self.blocks) >= MAX_BLOCKS_PER_SESSION:
            return f"Block limit reached ({MAX_BLOCKS_PER_SESSION})"
        if self.committed_bytes() + additional_bytes > MAX_SESSION_BYTES:
            return f"Session storage quota exceeded ({MAX_SESSION_BYTES} bytes)"
        return None

    def update_activity(self):
        """Update the last activity timestamp to prevent session timeout."""
        self.last_activity = datetime.now()
        mark_sessions_dirty()
        if self.is_public:
            # Coalesced into the periodic flush: activity fires on every
            # keystroke-sized action, and the lobby only shows it as a timestamp.
            mark_lobby_dirty()

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

    def add_user(self, token: str, user_id: str, name: str) -> User:
        """Add a new user to the session with a unique name."""
        unique_name = self.get_unique_name(name)
        user = User(id=user_id, name=unique_name, is_host=False)
        self.users[user_id] = user
        self.tokens[token] = user_id
        self.update_activity()
        return user

    def remove_user(self, user_id: str):
        """Remove a user, their token and their WebSocket connections."""
        if user_id in self.users:
            del self.users[user_id]
        for token in [t for t, u in self.tokens.items() if u == user_id]:
            del self.tokens[token]
        self.websockets.pop(user_id, None)
        pending = self.pending_disconnects.pop(user_id, None)
        if pending is not None and not pending.done():
            pending.cancel()
        self.update_activity()

    def transfer_host(self, new_host_id: str):
        """Transfer host privileges to another user in the session.

        Publication does not follow the seat. Listing a room is consent given by
        one particular person, under their name, and the seat moves on its own
        after a 10-second network blip — so a host who slept their laptop in a
        public room would otherwise lose the ability to unpublish it to whoever
        happened to be next in the dict. A new host who wants it listed can say so.
        """
        for user in self.users.values():
            user.is_host = (user.id == new_host_id)
        self.is_public = False
        self.update_activity()

    def add_block(self, block: Block, byte_size: int = 0):
        """Add a new text or file block to the session and account for its size."""
        self.blocks[block.id] = block
        self.block_bytes[block.id] = byte_size
        self.total_bytes += byte_size
        self.update_activity()

    def delete_block(self, block_id: str):
        """Delete a block, its files, and any raw links exposing its content."""
        if block_id in self.blocks:
            block = self.blocks[block_id]
            if block.type == "file" and block.filename:
                file_path = self.session_dir / block.filename
                file_path.unlink(missing_ok=True)
            elif block.type == "text":
                text_file = self.session_dir / f"text_block_{block_id}.txt"
                text_file.unlink(missing_ok=True)
            del self.blocks[block_id]
            self.total_bytes -= self.block_bytes.pop(block_id, 0)
        # A raw link serves *decrypted* content, so leaving it alive after the
        # block is gone keeps publishing data the user believes they deleted.
        purge_raw_links_for_block(self.connection_id, block_id)
        self.update_activity()

    async def broadcast(self, message: dict, exclude_user: str | None = None):
        """
        Broadcast a message to all connected WebSocket clients.

        Args:
            message: Dictionary to send as JSON
            exclude_user: Optional user_id to exclude from broadcast
        """
        for user_id, sockets in list(self.websockets.items()):
            if exclude_user and user_id == exclude_user:
                continue
            for ws in list(sockets):
                try:
                    await ws.send_json(message)
                except Exception:  # noqa: BLE001 — broadcasts must keep going if one socket dies.
                    sockets.discard(ws)

    def to_dict(self) -> dict:
        """Serialize persistable session state. Sockets and tasks are runtime-only."""
        return {
            "connection_id": self.connection_id,
            "name": self.name,
            "users": {uid: u.model_dump() for uid, u in self.users.items()},
            "tokens": self.tokens,
            "blocks": {bid: b.model_dump() for bid, b in self.blocks.items()},
            "block_bytes": self.block_bytes,
            "allow_join": self.allow_join,
            "allow_curl_upload": self.allow_curl_upload,
            "is_public": self.is_public,
            "created_at": self.created_at.isoformat(),
            "last_activity": self.last_activity.isoformat(),
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Session":
        instance = cls.__new__(cls)
        instance.connection_id = data["connection_id"]
        instance.users = {uid: User(**u) for uid, u in data.get("users", {}).items()}
        instance.name = data.get("name") or next(
            (u.name for u in instance.users.values() if u.is_host), "Clippy"
        )
        # Drop tokens pointing at users that no longer exist.
        instance.tokens = {
            t: uid for t, uid in data.get("tokens", {}).items() if uid in instance.users
        }
        instance.blocks = {bid: Block(**b) for bid, b in data.get("blocks", {}).items()}
        instance.block_bytes = dict(data.get("block_bytes", {}))
        instance.total_bytes = sum(instance.block_bytes.values())
        instance.reserved_bytes = 0
        instance.allow_join = data.get("allow_join", True)
        instance.allow_curl_upload = data.get("allow_curl_upload", False)
        instance.is_public = data.get("is_public", False)
        instance.last_activity = datetime.fromisoformat(data["last_activity"])
        # Snapshots written before created_at existed fall back to the last
        # activity rather than "now", which would reshuffle the lobby on restart.
        instance.created_at = datetime.fromisoformat(
            data.get("created_at") or data["last_activity"]
        )
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


# Public lobby: sessions their host has chosen to publish, streamed to anyone
# sitting on the entry page. Sockets here are unauthenticated by design — the
# whole point is that a published session is discoverable without an id.
MAX_PUBLIC_SESSIONS = 5
lobby_sockets: set[WebSocket] = set()
_lobby_dirty = False


def mark_lobby_dirty() -> None:
    global _lobby_dirty
    _lobby_dirty = True


def public_session_entries() -> list[dict]:
    """The newest published sessions, newest first."""
    entries = [
        {
            "connection_id": s.connection_id,
            "name": s.name,
            "created_at": s.created_at.isoformat(),
            "last_activity": s.last_activity.isoformat(),
        }
        for s in sessions.values()
        if s.is_public
    ]
    entries.sort(key=lambda e: e["created_at"], reverse=True)
    return entries[:MAX_PUBLIC_SESSIONS]


async def broadcast_public_sessions() -> None:
    """Push the current lobby to every listener. Call directly whenever a
    session appears or disappears; timestamp-only churn rides the flush loop."""
    global _lobby_dirty
    _lobby_dirty = False
    if not lobby_sockets:
        return
    message = {"type": "public_sessions", "sessions": public_session_entries()}
    for ws in list(lobby_sockets):
        try:
            await ws.send_json(message)
        except Exception:  # noqa: BLE001 — one dead listener must not stop the rest.
            lobby_sockets.discard(ws)


async def persistence_loop() -> None:
    """Background task that flushes dirty flags at a fixed interval."""
    global _sessions_dirty, _raw_links_dirty
    while True:
        try:
            await asyncio.sleep(PERSIST_INTERVAL_SECONDS)
        except asyncio.CancelledError:
            return
        if _lobby_dirty:
            await broadcast_public_sessions()
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


# Raw-link storage. Each link carries its own absolute expiry so a shared link
# stops resolving on a fixed schedule instead of living as long as the session.
raw_links: dict[str, dict[str, RawLink]] = {}  # connection_id -> {code -> RawLink}
_raw_links_dirty = False


def mark_raw_links_dirty() -> None:
    global _raw_links_dirty
    _raw_links_dirty = True


def _discard_raw_link(connection_id: str, code: str) -> int:
    """Drop one link and unlink its on-disk payload. Returns bytes freed."""
    link = raw_links.get(connection_id, {}).pop(code, None)
    if link is None:
        return 0
    (RAW_DIR / connection_id / link.filename).unlink(missing_ok=True)
    if not raw_links.get(connection_id):
        raw_links.pop(connection_id, None)
        shutil.rmtree(RAW_DIR / connection_id, ignore_errors=True)
    return link.size


def purge_raw_links_for_block(connection_id: str, block_id: str) -> None:
    """Revoke every raw link derived from a given block."""
    session_links = raw_links.get(connection_id)
    if not session_links:
        return
    doomed = [code for code, rl in session_links.items() if rl.block_id == block_id]
    freed = sum(_discard_raw_link(connection_id, code) for code in doomed)
    session = sessions.get(connection_id)
    if session is not None:
        session.total_bytes -= freed
    if doomed:
        mark_raw_links_dirty()


def purge_raw_links_for_session(connection_id: str) -> None:
    for code in list(raw_links.get(connection_id, {})):
        _discard_raw_link(connection_id, code)
    raw_links.pop(connection_id, None)
    shutil.rmtree(RAW_DIR / connection_id, ignore_errors=True)
    mark_raw_links_dirty()


async def save_raw_links() -> None:
    payload = json.dumps({
        "links": {
            cid: {code: rl.model_dump() for code, rl in links.items()}
            for cid, links in raw_links.items()
        },
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


async def _read_capped(reader, limit: int) -> bytes | None:
    """Pull from ``reader(n)`` until EOF, or return None once ``limit`` is passed.

    Starlette spools multipart files to disk, but the handler still has to hold
    the plaintext, its ciphertext and the base64 of that simultaneously, so the
    in-memory size has to be bounded before the first byte is retained.
    """
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await reader(1024 * 1024)
        if not chunk:
            return b"".join(chunks)
        total += len(chunk)
        if total > limit:
            return None
        chunks.append(chunk)


async def _read_body_capped(request: Request, limit: int) -> bytes | None:
    """Stream a request body, abandoning it as soon as it exceeds ``limit``."""
    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > limit:
            return None
        chunks.append(chunk)
    return b"".join(chunks)


def bearer_token(request: Request) -> str:
    """Pull the member token out of the Authorization header.

    Deliberately not a query parameter: the token is a credential, and query
    strings end up in proxy access logs, browser history and Referer headers.
    """
    scheme, _, value = request.headers.get("authorization", "").partition(" ")
    return value.strip() if scheme.lower() == "bearer" else ""


def new_member() -> tuple[str, str]:
    """Return (secret token, public user id) for a new member."""
    return secrets.token_urlsafe(32), uuid.uuid4().hex[:12]


def validate_connection_id(candidate: str) -> str | None:
    """Return None when a user-supplied id is usable, else why it is not."""
    if len(candidate) != CONNECTION_ID_LENGTH:
        return f"Connection ID must be exactly {CONNECTION_ID_LENGTH} characters"
    rejected = sorted({c for c in candidate if c not in CONNECTION_ID_ALPHABET})
    if rejected:
        return f"Connection ID cannot contain: {' '.join(rejected)}"
    return None


def generate_connection_id() -> str | None:
    """
    Generate a unique connection ID from the confusion-free alphabet.

    Returns None only when the keyspace is genuinely exhausted; otherwise the
    capped attempt loop will find a free ID with overwhelming probability long
    before the cap is hit.
    """
    chars = CONNECTION_ID_GENERATED_ALPHABET
    max_possible = len(chars) ** CONNECTION_ID_LENGTH

    if len(sessions) >= max_possible:
        return None

    for _ in range(min(max_possible, 1000)):
        # secrets, not random: the connection id is the session's only access
        # token, and random's Mersenne Twister state is recoverable from a few
        # dozen observed ids (session creation is unauthenticated).
        candidate = "".join(secrets.choice(chars) for _ in range(CONNECTION_ID_LENGTH))
        if candidate not in sessions:
            return candidate

    return None


def raw_link_quota_check(session: "Session", additional_bytes: int) -> str | None:
    """Raw links consume session storage and are capped in number."""
    if len(raw_links.get(session.connection_id, {})) >= MAX_RAW_LINKS_PER_SESSION:
        return f"Raw link limit reached ({MAX_RAW_LINKS_PER_SESSION})"
    if session.committed_bytes() + additional_bytes > MAX_SESSION_BYTES:
        return f"Session storage quota exceeded ({MAX_SESSION_BYTES} bytes)"
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

    for sockets in list(session.websockets.values()):
        for ws in list(sockets):
            try:
                await ws.close()
            except Exception:  # noqa: BLE001 — WebSocket may already be closed; nothing actionable.
                pass
    session.websockets.clear()

    if session.session_dir.exists():
        shutil.rmtree(session.session_dir, ignore_errors=True)

    # "Destroy" must mean destroyed: raw links serve decrypted plaintext, so
    # outliving the session would contradict what the confirmation dialog says.
    purge_raw_links_for_session(connection_id)

    mark_sessions_dirty()

    if session.is_public:
        await broadcast_public_sessions()


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
        stale = [
            (cid, code)
            for cid, links in raw_links.items()
            for code, rl in links.items()
            if now > datetime.fromisoformat(rl.expires_at)
        ]
        for cid, code in stale:
            freed = _discard_raw_link(cid, code)
            session = sessions.get(cid)
            if session is not None:
                session.total_bytes -= freed
        if stale:
            mark_raw_links_dirty()
            mark_sessions_dirty()


@router.get(
    "/config",
    summary="Get Configuration",
    description="Retrieve client configuration (file size limits)."
)
async def get_config():
    """
    Get client configuration.

    Content is encrypted in the browser, but the key is derived from the
    connection ID rather than a URL fragment — see
    frontend/src/utils/encryption.js. The server issues that ID, so this is
    encryption at rest, not end-to-end secrecy against the server.
    """
    return api_response(
        HTTPStatus.OK,
        "Configuration retrieved",
        {
            "max_file_size_bytes": MAX_FILE_SIZE,
        }
    )


@router.get(
    "/session/id-length",
    summary="Get Connection ID Length",
    description="Retrieve the configured connection ID length"
)
async def get_connection_id_length():
    """
    Get the configured connection ID length.

    Returns the length of connection IDs, plus every character one may contain,
    so the client can filter input against the server's rule instead of keeping
    its own copy of it. This is the *accepted* set: generated IDs are drawn from
    a narrower one, but a caller may name an ID using any of these.
    """
    return api_response(
        HTTPStatus.OK,
        "Connection ID length retrieved",
        {
            "connection_id_length": CONNECTION_ID_LENGTH,
            "connection_id_alphabet": CONNECTION_ID_ALPHABET,
        }
    )


@router.post(
    "/session/create",
    summary="Create New Session",
    description="Create a new collaborative session and become the host"
)
async def create_session(request: CreateSessionRequest):
    """
    Create a new collaborative session.

    Generates a unique session ID and creates the first user as the host.
    A caller may request its own ID; it still has to match the server's length
    and alphabet, and must not already be taken. If no user name is provided,
    a random name will be generated.

    Returns session ID, user ID, user name, and host status.
    """
    requested_id = (request.connection_id or "").strip().lower()

    if requested_id:
        # A chosen id is guessable in a way a generated one is not, and the id
        # is also the KDF input — that trade-off is the caller's to make. What
        # is not negotiable is the character set: it guards the session
        # directory path. Confusable characters are allowed here; only the
        # generator avoids them.
        invalid = validate_connection_id(requested_id)
        if invalid is not None:
            return api_response(HTTPStatus.BAD_REQUEST, invalid)
        if requested_id in sessions:
            return api_response(HTTPStatus.CONFLICT, "Connection ID already in use")
        connection_id = requested_id
    else:
        connection_id = generate_connection_id()

    if connection_id is None:
        return api_response(
            HTTPStatus.SERVICE_UNAVAILABLE,
            "Unable to create session: all connection IDs are currently in use. Please try again later."
        )

    token, user_id = new_member()
    user_name = request.user_name or generate_random_name()

    session = Session(connection_id, token, user_id, user_name)
    sessions[connection_id] = session
    mark_sessions_dirty()

    return api_response(
        HTTPStatus.OK,
        "Session created",
        {
            "connection_id": connection_id,
            # `user_id` is the caller's secret token; `public_id` is what other
            # members see. Never send one where the other is expected.
            "user_id": token,
            "public_id": user_id,
            "user_name": user_name,
            "is_host": True
        }
    )


@router.post(
    "/session/join",
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

    token, user_id = new_member()
    user_name = request.user_name or generate_random_name()

    user = session.add_user(token, user_id, user_name)

    # Broadcast user joined — User carries no credential, so this is safe.
    await session.broadcast({
        "type": "user_joined",
        "user": user.model_dump()
    })
    mark_sessions_dirty()

    return api_response(
        HTTPStatus.OK,
        "Connection created",
        {
            "connection_id": connection_id,
            "user_id": token,
            "public_id": user_id,
            "user_name": user.name,
            "is_host": False
        }
    )


@router.get(
    "/session/{connection_id}",
    summary="Get Session Details",
    description="Retrieve complete session information including users and blocks"
)
async def get_session(connection_id: str, request: Request):
    """
    Get detailed information about a session. The caller must be a member.

    Authenticates via ``Authorization: Bearer <token>``.
    """
    connection_id = connection_id.lower()

    if connection_id not in sessions:
        return api_response(HTTPStatus.NOT_FOUND, "Session not found")

    session = sessions[connection_id]
    if session.member_id(bearer_token(request)) is None:
        return api_response(HTTPStatus.FORBIDDEN, "User not in session")

    session_info = SessionInfo(
        connection_id=connection_id,
        users=list(session.users.values()),
        blocks=list(session.blocks.values()),
        allow_join=session.allow_join,
        allow_curl_upload=session.allow_curl_upload,
        is_public=session.is_public,
        host_id=next((u.id for u in session.users.values() if u.is_host), ""),
    )

    return api_response(
        HTTPStatus.OK,
        "Session retrieved",
        session_info.model_dump(),
    )


@router.post(
    "/session/destroy",
    summary="Destroy Session",
    description="Permanently delete a session and all its data (host only)"
)
async def destroy_session(request: DestroySessionRequest):
    """
    Destroy a session and clean up all associated data.

    Only the session host can destroy a session. This will:
    - Notify all connected users
    - Close all WebSocket connections
    - Delete all uploaded files, text blocks and raw links
    - Remove the session from memory
    """
    connection_id = request.connection_id.lower()

    if connection_id not in sessions:
        return api_response(
            HTTPStatus.NOT_FOUND,
            "Session not found"
        )

    session = sessions[connection_id]

    if not session.is_host_token(request.user_id):
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


@router.post(
    "/session/transfer_host",
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

    if not session.is_host_token(request.current_host_id):
        return api_response(
            HTTPStatus.FORBIDDEN,
            "Only host can transfer host rights"
        )

    if request.new_host_id not in session.users:
        return api_response(
            HTTPStatus.NOT_FOUND,
            "New host user not found"
        )

    was_public = session.is_public
    session.transfer_host(request.new_host_id)

    # Broadcast host transfer
    await session.broadcast({
        "type": "host_transferred",
        "new_host_id": request.new_host_id
    })

    if was_public:
        await session.broadcast({"type": "public_changed", "is_public": False})
        await broadcast_public_sessions()

    return api_response(
        HTTPStatus.OK,
        "Host transferred",
        {"success": True}
    )


@router.post(
    "/session/toggle_join",
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

    if not session.is_host_token(request.user_id):
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


@router.post(
    "/session/toggle_curl",
    summary="Toggle Curl Upload",
    description="Enable or disable curl-based uploads to the session (host only)"
)
async def toggle_curl(request: ToggleCurlRequest):
    connection_id = request.connection_id.lower()

    if connection_id not in sessions:
        return api_response(HTTPStatus.NOT_FOUND, "Session not found")

    session = sessions[connection_id]

    if not session.is_host_token(request.user_id):
        return api_response(HTTPStatus.FORBIDDEN, "Only host can toggle curl upload")

    session.allow_curl_upload = request.allow_curl_upload
    session.update_activity()

    await session.broadcast({
        "type": "curl_permission_changed",
        "allow_curl_upload": request.allow_curl_upload,
    })

    return api_response(HTTPStatus.OK, "Curl upload permission updated", {"success": True})


@router.post(
    "/session/toggle_public",
    summary="Toggle Public Listing",
    description="Publish or unpublish the session on the entry page (host only)"
)
async def toggle_public(request: TogglePublicRequest):
    """
    Publish the session in the public lobby, or take it back down.

    Host only, and off by default: the lobby hands out the connection id, and
    the connection id is what derives the content key.
    """
    connection_id = request.connection_id.lower()

    if connection_id not in sessions:
        return api_response(HTTPStatus.NOT_FOUND, "Session not found")

    session = sessions[connection_id]

    if not session.is_host_token(request.user_id):
        return api_response(HTTPStatus.FORBIDDEN, "Only host can change visibility")

    session.is_public = request.is_public
    session.update_activity()

    await session.broadcast({
        "type": "public_changed",
        "is_public": session.is_public,
    })
    # Appearing and disappearing is the one thing the lobby must show at once.
    await broadcast_public_sessions()

    return api_response(HTTPStatus.OK, "Visibility updated", {"success": True})


@router.get(
    "/sessions/public",
    summary="List Public Sessions",
    description="The newest published sessions, for the entry page"
)
async def list_public_sessions():
    """Snapshot of the lobby. Live updates arrive over ``/ws/lobby``."""
    return api_response(
        HTTPStatus.OK,
        "Public sessions retrieved",
        {"sessions": public_session_entries()},
    )


@router.post(
    "/block/create",
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

    uid = session.member_id(request.user_id)
    if uid is None:
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
        size=content_bytes,
        created_by=uid,
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


@router.post(
    "/block/upload",
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

    uid = session.member_id(user_id)
    if uid is None:
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

    # Reserve the worst case up front. Sizing off total_bytes alone let N
    # concurrent uploads each measure against the same empty baseline and
    # collectively blow past the session quota by a factor of N.
    per_session_remaining = MAX_SESSION_BYTES - session.committed_bytes()
    effective_cap = max(0, min(MAX_FILE_SIZE, per_session_remaining))
    session.reserved_bytes += effective_cap
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
        file_path.unlink(missing_ok=True)
        raise
    finally:
        session.reserved_bytes -= effective_cap

    if overflow:
        file_path.unlink(missing_ok=True)
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
        size=bytes_written,
        created_by=uid,
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


@router.patch(
    "/block/update",
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

    if session.member_id(request.user_id) is None:
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
    block.size = new_bytes
    session.block_bytes[request.block_id] = new_bytes
    session.total_bytes += delta

    text_file = session.session_dir / f"text_block_{request.block_id}.txt"
    async with aiofiles.open(text_file, "w", encoding="utf-8") as f:
        await f.write(request.content)

    # Existing raw links still serve the *old* plaintext from their own copy on
    # disk, which would silently outlive the edit. Revoke them.
    purge_raw_links_for_block(connection_id, request.block_id)
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


@router.post(
    "/block/replace",
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

    if session.member_id(user_id) is None:
        return api_response(HTTPStatus.FORBIDDEN, "User not in session")

    block = session.blocks.get(block_id)
    if block is None:
        return api_response(HTTPStatus.NOT_FOUND, "Block not found")

    if block.type != "file":
        return api_response(HTTPStatus.BAD_REQUEST, "Block is not a file block")

    old_bytes = session.block_bytes.get(block_id, 0)
    old_filename = block.filename

    # Remaining quota excludes the old file's contribution, since we're replacing it.
    per_session_remaining = MAX_SESSION_BYTES - (session.committed_bytes() - old_bytes)
    effective_cap = max(0, min(MAX_FILE_SIZE, per_session_remaining))
    session.reserved_bytes += effective_cap

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
        tmp_path.unlink(missing_ok=True)
        raise
    finally:
        session.reserved_bytes -= effective_cap

    if overflow:
        tmp_path.unlink(missing_ok=True)
        message = (
            f"File too large. Max size: {MAX_FILE_SIZE} bytes"
            if bytes_written > MAX_FILE_SIZE
            else "Session storage quota exceeded"
        )
        return api_response(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, message)

    if old_filename and old_filename != safe_filename:
        (session.session_dir / old_filename).unlink(missing_ok=True)

    os.replace(tmp_path, file_path)

    block.filename = safe_filename
    block.original_filename = file.filename
    block.size = bytes_written
    session.block_bytes[block_id] = bytes_written
    session.total_bytes = session.total_bytes - old_bytes + bytes_written
    # Raw links point at a snapshot of the old file; revoke them on replace.
    purge_raw_links_for_block(connection_id, block_id)
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


@router.delete(
    "/block/delete",
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

    if session.member_id(request.user_id) is None:
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


@router.get(
    "/block/download/{connection_id}/{block_id}",
    summary="Download Block",
    description="Download a text or file block (encrypted)"
)
async def download_block(connection_id: str, block_id: str, request: Request):
    """
    Stream a block's encrypted content. The caller must be a session member.

    Authenticates via ``Authorization: Bearer <token>``. The response uses
    ``application/octet-stream`` so browsers don't try to sniff or render what
    is actually opaque ciphertext.
    """
    connection_id = connection_id.lower()

    if connection_id not in sessions:
        return api_response(HTTPStatus.NOT_FOUND, "Session not found")

    session = sessions[connection_id]

    if session.member_id(bearer_token(request)) is None:
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


@router.post(
    "/raw/text",
    summary="Create Raw Text Link",
    description="Generate a public short link that serves the decrypted text"
)
async def create_raw_text_link(request: CreateRawTextRequest):
    connection_id = request.connection_id.lower()

    if connection_id not in sessions:
        return api_response(HTTPStatus.NOT_FOUND, "Session not found")

    session = sessions[connection_id]
    if session.member_id(request.user_id) is None:
        return api_response(HTTPStatus.FORBIDDEN, "User not in session")
    if request.block_id not in session.blocks:
        return api_response(HTTPStatus.NOT_FOUND, "Block not found")

    # Raw payloads live on the same disk as everything else, so they have to be
    # counted and capped or a member can fill the host with unlimited links.
    content_bytes = len(request.content.encode("utf-8"))
    quota_error = raw_link_quota_check(session, content_bytes)
    if quota_error is not None:
        return api_response(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, quota_error)

    code = generate_raw_code(connection_id)
    if code is None:
        return api_response(HTTPStatus.SERVICE_UNAVAILABLE, "Unable to generate raw link")

    raw_dir = RAW_DIR / connection_id
    raw_dir.mkdir(exist_ok=True)
    filename = f"{code}.txt"
    async with aiofiles.open(raw_dir / filename, "w", encoding="utf-8") as f:
        await f.write(request.content)

    now = datetime.now()
    link = RawLink(
        code=code,
        connection_id=connection_id,
        block_id=request.block_id,
        content_type="text",
        filename=filename,
        created_at=now.isoformat(),
        expires_at=(now + timedelta(seconds=RAW_LINK_TTL_SECONDS)).isoformat(),
        size=content_bytes,
    )
    raw_links.setdefault(connection_id, {})[code] = link
    session.total_bytes += content_bytes
    session.update_activity()
    mark_raw_links_dirty()

    return api_response(
        HTTPStatus.OK,
        "Raw link created",
        {"code": code, "expires_at": link.expires_at},
    )


@router.post(
    "/raw/file",
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
    if session.member_id(user_id) is None:
        return api_response(HTTPStatus.FORBIDDEN, "User not in session")
    if block_id not in session.blocks:
        return api_response(HTTPStatus.NOT_FOUND, "Block not found")

    quota_error = raw_link_quota_check(session, 0)
    if quota_error is not None:
        return api_response(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, quota_error)

    code = generate_raw_code(connection_id)
    if code is None:
        return api_response(HTTPStatus.SERVICE_UNAVAILABLE, "Unable to generate raw link")

    raw_suffix = Path(original_filename or file.filename or "").suffix
    safe_suffix = "".join(c for c in raw_suffix if c.isalnum() or c in "._-")[:32]
    filename = f"{code}{safe_suffix}"

    raw_dir = RAW_DIR / connection_id
    raw_dir.mkdir(exist_ok=True)
    file_path = raw_dir / filename

    # Same reservation dance as block uploads: raw payloads count against the
    # session quota, so bound them before streaming rather than after.
    per_session_remaining = MAX_SESSION_BYTES - session.committed_bytes()
    effective_cap = max(0, min(MAX_FILE_SIZE, per_session_remaining))
    session.reserved_bytes += effective_cap
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
        file_path.unlink(missing_ok=True)
        raise
    finally:
        session.reserved_bytes -= effective_cap

    if overflow:
        file_path.unlink(missing_ok=True)
        message = (
            f"File too large. Max size: {MAX_FILE_SIZE} bytes"
            if bytes_written > MAX_FILE_SIZE
            else "Session storage quota exceeded"
        )
        return api_response(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, message)

    now = datetime.now()
    link = RawLink(
        code=code,
        connection_id=connection_id,
        block_id=block_id,
        content_type="file",
        filename=filename,
        original_filename=original_filename or file.filename or "download",
        created_at=now.isoformat(),
        expires_at=(now + timedelta(seconds=RAW_LINK_TTL_SECONDS)).isoformat(),
        size=bytes_written,
    )
    raw_links.setdefault(connection_id, {})[code] = link
    session.total_bytes += bytes_written
    session.update_activity()
    mark_raw_links_dirty()

    return api_response(
        HTTPStatus.OK,
        "Raw link created",
        {"code": code, "expires_at": link.expires_at},
    )


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

    if datetime.now() > datetime.fromisoformat(link.expires_at):
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

    Bodies are read against MAX_CURL_UPLOAD_BYTES and abandoned the moment they
    exceed it. Reading first and checking the length afterwards let an
    unauthenticated request of any size OOM the process.
    """
    connection_id = connection_id.lower()

    if connection_id not in sessions:
        return JSONResponse(status_code=404, content={"ok": False, "error": "Session not found"})

    session = sessions[connection_id]

    if not session.allow_curl_upload:
        return JSONResponse(status_code=403, content={"ok": False, "error": "Curl upload is not enabled"})

    # Reject anything that declares itself oversized before touching the body.
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > MAX_CURL_UPLOAD_BYTES:
        return JSONResponse(
            status_code=413,
            content={"ok": False, "error": f"Body too large (max {MAX_CURL_UPLOAD_BYTES} bytes)"},
        )

    content_type = request.headers.get("content-type", "")

    if content_type.startswith("multipart/form-data"):
        form = await request.form(max_part_size=MAX_CURL_UPLOAD_BYTES)
        try:
            upload = form.get("f")
            if upload is None or not hasattr(upload, "read"):
                return JSONResponse(status_code=400, content={"ok": False, "error": "Missing file field 'f'"})

            file_bytes = await _read_capped(upload.read, MAX_CURL_UPLOAD_BYTES)
            if file_bytes is None:
                return JSONResponse(
                    status_code=413,
                    content={"ok": False, "error": f"File too large (max {MAX_CURL_UPLOAD_BYTES} bytes)"},
                )

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
                size=len(encrypted_payload),
                created_by="__curl__",
                created_at=datetime.now().isoformat(),
            )
            session.add_block(block, byte_size=len(encrypted_payload))

            await session.broadcast({"type": "block_created", "block": block.model_dump()})
            return JSONResponse(status_code=200, content={"ok": True, "id": block_id})
        finally:
            await form.close()
    else:
        body = await _read_body_capped(request, MAX_CURL_UPLOAD_BYTES)
        if body is None:
            return JSONResponse(
                status_code=413,
                content={"ok": False, "error": f"Body too large (max {MAX_CURL_UPLOAD_BYTES} bytes)"},
            )
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
            size=content_bytes,
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
    if user is None or session.websockets.get(user_id):
        return

    was_host = user.is_host
    was_public = session.is_public
    session.remove_user(user_id)

    await session.broadcast({"type": "user_left", "user_id": user_id})

    if was_host:
        if session.users:
            new_host_id = next(iter(session.users))
            session.transfer_host(new_host_id)  # also unpublishes — see the method
            await session.broadcast({
                "type": "host_transferred",
                "new_host_id": new_host_id,
            })
        else:
            # Nobody is left to hold the seat, so nobody could ever unpublish or
            # destroy it again. An unlisted room just waits out SESSION_TIMEOUT.
            session.is_public = False

        if was_public:
            await session.broadcast({"type": "public_changed", "is_public": False})
            await broadcast_public_sessions()


@app.websocket("/ws/lobby")
async def lobby_websocket(websocket: WebSocket):
    """Live feed of published sessions for the entry page.

    Unauthenticated on purpose — it only ever carries what a host explicitly
    published. Registered before ``/ws/{connection_id}`` so the literal path
    wins over the parameterised one.
    """
    await websocket.accept()
    lobby_sockets.add(websocket)
    try:
        await websocket.send_json({
            "type": "public_sessions",
            "sessions": public_session_entries(),
        })
        while True:
            data = await websocket.receive_text()
            try:
                message = json.loads(data)
            except json.JSONDecodeError:
                continue
            if message.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    except Exception as e:  # noqa: BLE001 — log and clean up regardless of cause.
        logger.warning("Lobby WebSocket error: %s", e)
    finally:
        lobby_sockets.discard(websocket)


@app.websocket("/ws/{connection_id}")
async def websocket_endpoint(websocket: WebSocket, connection_id: str):
    """Live session feed.

    The member token arrives as the WebSocket subprotocol rather than in the
    path: browsers cannot set headers on a WebSocket handshake, and a token in
    the URL would be written to every proxy access log. The subprotocol has to
    be echoed back on accept or the browser drops the connection.
    """
    connection_id = connection_id.lower()

    token = (websocket.headers.get("sec-websocket-protocol") or "").split(",")[0].strip()

    if connection_id not in sessions:
        await websocket.close(code=1008, reason="Session not found")
        return

    session = sessions[connection_id]

    user_id = session.member_id(token)
    if user_id is None:
        await websocket.close(code=1008, reason="User not in session")
        return

    await websocket.accept(subprotocol=token)

    # Cancel any pending eviction from a previous disconnect — the user is back.
    pending = session.pending_disconnects.pop(user_id, None)
    if pending is not None:
        pending.cancel()

    session.websockets.setdefault(user_id, set()).add(websocket)
    session.update_activity()

    try:
        while True:
            data = await websocket.receive_text()
            try:
                message = json.loads(data)
            except json.JSONDecodeError:
                continue
            if message.get("type") == "ping":
                # Deliberately does not touch last_activity: the keepalive fires
                # every 30s whether anyone is there or not, so refreshing on it
                # made a forgotten open tab keep a dead session alive forever.
                # SESSION_TIMEOUT_SECONDS is meant to measure idleness, not
                # whether a browser is still pointed at the page.
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    except Exception as e:  # noqa: BLE001 — log and clean up regardless of cause.
        logger.warning("WebSocket error: %s", e)
    finally:
        sockets = session.websockets.get(user_id)
        if sockets is not None:
            sockets.discard(websocket)
            if not sockets:
                del session.websockets[user_id]
        if connection_id in sessions and user_id in session.users and not session.websockets.get(user_id):
            session.pending_disconnects[user_id] = asyncio.create_task(
                _remove_user_after_grace(connection_id, user_id)
            )


# Include the latest router (latest endpoint)
app.include_router(router)

if __name__ == "__main__":
    print(f"Starting server on {HOST}:{PORT}")
    uvicorn.run(
        app,
        host=HOST,
        port=PORT
    )
