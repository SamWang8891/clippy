"""
Smoke tests for the Clippy HTTP API.

These don't cover the WebSocket path or end-to-end encryption — they verify
the contract on the simple HTTP surface so refactors don't regress it.
"""


def _create_session(client):
    r = client.post("/api/v2/session/create", json={"user_name": "Alice"})
    assert r.status_code == 200, r.text
    return r.json()["data"]


def test_create_session_returns_unique_id(client):
    a = _create_session(client)
    b = _create_session(client)
    assert a["connection_id"] != b["connection_id"]
    assert a["is_host"] is True
    assert a["user_name"] == "Alice"


def test_join_then_get_session_requires_membership(client):
    host = _create_session(client)
    cid = host["connection_id"]

    # Stranger can't read session details.
    r = client.get(f"/api/v2/session/{cid}", params={"user_id": "not-a-real-user"})
    assert r.status_code == 403

    # Valid host can.
    r = client.get(f"/api/v2/session/{cid}", params={"user_id": host["user_id"]})
    assert r.status_code == 200
    assert r.json()["data"]["host_id"] == host["user_id"]


def test_text_block_length_limit_enforced(client):
    host = _create_session(client)
    payload = {
        "connection_id": host["connection_id"],
        "user_id": host["user_id"],
        "type": "text",
        "content": "x" * 200,  # exceeds MAX_TEXT_BLOCK_LENGTH=128 from conftest
    }
    r = client.post("/api/v2/block/create", json=payload)
    assert r.status_code == 422  # pydantic validation error


def test_block_quota_enforced(client):
    host = _create_session(client)
    cid, uid = host["connection_id"], host["user_id"]

    for i in range(3):
        r = client.post("/api/v2/block/create", json={
            "connection_id": cid,
            "user_id": uid,
            "type": "text",
            "content": f"hello {i}",
        })
        assert r.status_code == 200, r.text

    # Fourth one should hit the per-session block cap (=3).
    r = client.post("/api/v2/block/create", json={
        "connection_id": cid,
        "user_id": uid,
        "type": "text",
        "content": "overflow",
    })
    assert r.status_code == 413


def test_download_requires_membership(client):
    host = _create_session(client)
    cid, uid = host["connection_id"], host["user_id"]

    r = client.post("/api/v2/block/create", json={
        "connection_id": cid,
        "user_id": uid,
        "type": "text",
        "content": "secret",
    })
    block_id = r.json()["data"]["block_id"]

    # Outsider rejected.
    r = client.get(f"/api/v2/block/download/{cid}/{block_id}", params={"user_id": "outsider"})
    assert r.status_code == 403

    # Member allowed.
    r = client.get(f"/api/v2/block/download/{cid}/{block_id}", params={"user_id": uid})
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/octet-stream"
