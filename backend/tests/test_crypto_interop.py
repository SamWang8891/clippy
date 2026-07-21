"""
Pins the server's key derivation to the browser's.

The backend encrypts curl uploads; the browser decrypts them. Both derive the
same AES-256-GCM key from the connection ID, so the KDF prefix is a wire-format
constant shared across two languages with nothing but a comment holding them
together. An api-version find/replace once changed the backend's prefix from
"clippy-session-v1:" to "v2:" without touching the frontend, and every curl
upload silently became undecryptable — no test failed.

These read the frontend source directly, so drift on either side fails here.
"""

import base64
import hashlib
import re
from pathlib import Path

import pytest
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

import app

FRONTEND_CRYPTO = (
    Path(__file__).resolve().parents[2] / "frontend" / "src" / "utils" / "encryption.js"
)


def _frontend_const(name: str) -> str:
    source = FRONTEND_CRYPTO.read_text(encoding="utf-8")
    match = re.search(rf"^const {name} = '([^']*)';", source, re.MULTILINE)
    assert match, f"{name} not found in {FRONTEND_CRYPTO}"
    return match.group(1)


def test_kdf_prefix_matches_frontend():
    assert app.KDF_PREFIX.decode() == _frontend_const("KDF_PREFIX")


def test_iv_length_matches_frontend():
    source = FRONTEND_CRYPTO.read_text(encoding="utf-8")
    frontend_iv = re.search(r"^const IV_LENGTH = (\d+);", source, re.MULTILINE)
    assert frontend_iv and int(frontend_iv.group(1)) == app.ENCRYPTION_IV_LENGTH


def test_derived_key_is_stable():
    """Locks the exact key bytes: any prefix change breaks stored data."""
    expected = "ed983a7c36c1ce7038d9b1808aedfca78f2c6270c74f1d9a8484a116acc17914"
    actual = hashlib.sha256(app.KDF_PREFIX + b"abc123").hexdigest()
    assert actual == expected, (
        f"Session key derivation changed ({actual}). Every previously stored "
        f"block is now undecryptable. If this is deliberate, update the vector "
        f"and frontend/src/utils/encryption.js together."
    )


def test_roundtrip_matches_browser_wire_format():
    """base64(iv ‖ ciphertext ‖ tag), decrypted the way encryption.js does."""
    blob = base64.b64decode(app.server_encrypt("abc123", b"hello from curl"))
    key = hashlib.sha256(app.KDF_PREFIX + b"abc123").digest()
    iv, ciphertext = blob[: app.ENCRYPTION_IV_LENGTH], blob[app.ENCRYPTION_IV_LENGTH :]
    assert AESGCM(key).decrypt(iv, ciphertext, None) == b"hello from curl"


def test_wrong_prefix_fails_to_decrypt():
    """Demonstrates the failure mode the pin above guards against."""
    blob = base64.b64decode(app.server_encrypt("abc123", b"hello"))
    stale = hashlib.sha256(b"clippy-session-v2:" + b"abc123").digest()
    with pytest.raises(InvalidTag):
        AESGCM(stale).decrypt(blob[:12], blob[12:], None)
