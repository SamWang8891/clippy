"""
Test configuration: point the backend at a throwaway data dir for each test
session so we don't pollute the developer's local state.
"""

import os
import shutil
import sys
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


@pytest.fixture(autouse=True, scope="session")
def isolated_data_dir():
    tmp = Path(tempfile.mkdtemp(prefix="clippy-test-"))
    os.environ["DATA_DIR"] = str(tmp)
    os.environ["MAX_BLOCKS_PER_SESSION"] = "3"
    os.environ["MAX_TEXT_BLOCK_LENGTH"] = "128"
    yield tmp
    shutil.rmtree(tmp, ignore_errors=True)


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
