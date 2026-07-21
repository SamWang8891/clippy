"""
Test configuration: point the backend at a throwaway data dir so we don't
pollute the developer's local state.

Env vars are set at *import* time, not in a fixture. conftest is imported before
any test module, whereas fixtures run after collection — so a test module with a
module-level `import app` would otherwise pick up production defaults and make
the limit tests silently pass against the wrong values.
"""

import os
import shutil
import sys
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

TMP_DATA_DIR = Path(tempfile.mkdtemp(prefix="clippy-test-"))
os.environ["DATA_DIR"] = str(TMP_DATA_DIR)
os.environ["MAX_BLOCKS_PER_SESSION"] = "3"
os.environ["MAX_TEXT_BLOCK_LENGTH"] = "128"
os.environ["MAX_CURL_UPLOAD_MIB"] = "1"


@pytest.fixture(autouse=True, scope="session")
def isolated_data_dir():
    yield TMP_DATA_DIR
    shutil.rmtree(TMP_DATA_DIR, ignore_errors=True)


@pytest.fixture()
def client():
    # Import lazily so the env vars above take effect.
    from fastapi.testclient import TestClient

    import app as app_module

    # TestClient(app) handles lifespan startup/shutdown via context manager.
    with TestClient(app_module.app) as c:
        yield c
    # Clean module-level state between tests so each one starts fresh.
    app_module.sessions.clear()
    app_module.raw_links.clear()
