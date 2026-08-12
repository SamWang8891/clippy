"""
Smoke tests for the Clippy HTTP API.

These don't cover the WebSocket path — they verify the contract on the simple
HTTP surface so refactors don't regress it, plus the authorization boundary
between "public identity" and "secret credential".
"""


def _create_session(client):
    r = client.post("/api/v2/session/create", json={"user_name": "Alice"})
    assert r.status_code == 200, r.text
    return r.json()["data"]


def _join(client, cid, name="Bob"):
    r = client.post("/api/v2/session/join", json={"connection_id": cid, "user_name": name})
    assert r.status_code == 200, r.text
    return r.json()["data"]


def _auth(member):
    return {"Authorization": f"Bearer {member['user_id']}"}


def test_create_session_returns_unique_id(client):
    a = _create_session(client)
    b = _create_session(client)
    assert a["connection_id"] != b["connection_id"]
    assert a["is_host"] is True
    assert a["user_name"] == "Alice"
    # The credential and the public identity must be different values.
    assert a["user_id"] != a["public_id"]


def test_generated_ids_avoid_confusable_characters(client):
    """i/o/e/0/1 must never be *generated* — they are the ones users misread."""
    for _ in range(30):
        cid = _create_session(client)["connection_id"]
        assert not set(cid) & set("ioe01"), cid


def test_custom_connection_id_is_honoured_and_validated(client):
    import app as app_module

    good = "z" * app_module.CONNECTION_ID_LENGTH
    r = client.post("/api/v2/session/create", json={"connection_id": good.upper()})
    assert r.status_code == 200, r.text
    assert r.json()["data"]["connection_id"] == good

    # Taken.
    r = client.post("/api/v2/session/create", json={"connection_id": good})
    assert r.status_code == 409

    # A confusable character is the caller's business when they name it.
    r = client.post("/api/v2/session/create", json={"connection_id": "e" + good[1:]})
    assert r.status_code == 200
    assert r.json()["data"]["connection_id"] == "e" + good[1:]

    # Wrong length.
    r = client.post("/api/v2/session/create", json={"connection_id": good[:-1]})
    assert r.status_code == 400

    # Path traversal via the id would land in the uploads dir.
    r = client.post("/api/v2/session/create", json={"connection_id": "../abc"})
    assert r.status_code == 400


def test_join_then_get_session_requires_membership(client):
    host = _create_session(client)
    cid = host["connection_id"]

    r = client.get(f"/api/v2/session/{cid}", headers={"Authorization": "Bearer nope"})
    assert r.status_code == 403

    r = client.get(f"/api/v2/session/{cid}", headers=_auth(host))
    assert r.status_code == 200
    assert r.json()["data"]["host_id"] == host["public_id"]


def test_session_view_never_leaks_member_tokens(client):
    """The bug this guards: user_id was both credential and broadcast identity,
    so any member could read the host's token and take over the session."""
    host = _create_session(client)
    cid = host["connection_id"]
    guest = _join(client, cid)

    body = client.get(f"/api/v2/session/{cid}", headers=_auth(guest)).text
    assert host["user_id"] not in body
    assert guest["user_id"] not in body
    assert host["public_id"] in body


def test_guest_cannot_seize_host(client):
    host = _create_session(client)
    cid = host["connection_id"]
    guest = _join(client, cid)

    # Everything a guest can legitimately see about the host.
    users = client.get(f"/api/v2/session/{cid}", headers=_auth(guest)).json()["data"]["users"]
    host_public = next(u["id"] for u in users if u["is_host"])

    r = client.post("/api/v2/session/transfer_host", json={
        "connection_id": cid,
        "current_host_id": host_public,       # public id is not a credential
        "new_host_id": guest["public_id"],
    })
    assert r.status_code == 403

    r = client.post("/api/v2/session/destroy", json={
        "connection_id": cid, "user_id": guest["user_id"],
    })
    assert r.status_code == 403

    # The real host still holds it.
    assert client.post("/api/v2/session/transfer_host", json={
        "connection_id": cid,
        "current_host_id": host["user_id"],
        "new_host_id": guest["public_id"],
    }).status_code == 200


def _public(client):
    r = client.get("/api/v2/sessions/public")
    assert r.status_code == 200, r.text
    return r.json()["data"]["sessions"]


def test_sessions_are_private_until_the_host_publishes_them(client):
    host = _create_session(client)
    cid = host["connection_id"]
    guest = _join(client, cid)

    assert _public(client) == []

    # A guest must not be able to publish someone else's session.
    r = client.post("/api/v2/session/toggle_public", json={
        "connection_id": cid, "user_id": guest["user_id"], "is_public": True,
    })
    assert r.status_code == 403
    assert _public(client) == []

    r = client.post("/api/v2/session/toggle_public", json={
        "connection_id": cid, "user_id": host["user_id"], "is_public": True,
    })
    assert r.status_code == 200

    listed = _public(client)
    assert [e["connection_id"] for e in listed] == [cid]
    assert listed[0]["name"] == "Alice"
    # The label is the creator's, so a host transfer must not rename the room.
    r = client.post("/api/v2/session/transfer_host", json={
        "connection_id": cid,
        "current_host_id": host["user_id"],
        "new_host_id": guest["public_id"],
    })
    assert r.status_code == 200
    assert _public(client)[0]["name"] == "Alice"
    assert listed[0]["created_at"] and listed[0]["last_activity"]
    assert client.get(f"/api/v2/session/{cid}", headers=_auth(host)).json()["data"]["is_public"] is True

    # Bob holds the session now, so taking it back down is his call, not Alice's.
    r = client.post("/api/v2/session/toggle_public", json={
        "connection_id": cid, "user_id": host["user_id"], "is_public": False,
    })
    assert r.status_code == 403
    r = client.post("/api/v2/session/toggle_public", json={
        "connection_id": cid, "user_id": guest["user_id"], "is_public": False,
    })
    assert r.status_code == 200
    assert _public(client) == []


def test_lobby_socket_pushes_appearances_and_disappearances(client):
    host = _create_session(client)
    cid = host["connection_id"]

    with client.websocket_connect("/ws/lobby") as ws:
        assert ws.receive_json() == {"type": "public_sessions", "sessions": []}

        client.post("/api/v2/session/toggle_public", json={
            "connection_id": cid, "user_id": host["user_id"], "is_public": True,
        })
        appeared = ws.receive_json()
        assert [e["connection_id"] for e in appeared["sessions"]] == [cid]

        client.post("/api/v2/session/toggle_public", json={
            "connection_id": cid, "user_id": host["user_id"], "is_public": False,
        })
        assert ws.receive_json()["sessions"] == []


def test_public_listing_is_capped_and_newest_first(client):
    import app as app_module

    created = []
    for _ in range(app_module.MAX_PUBLIC_SESSIONS + 2):
        host = _create_session(client)
        r = client.post("/api/v2/session/toggle_public", json={
            "connection_id": host["connection_id"],
            "user_id": host["user_id"],
            "is_public": True,
        })
        assert r.status_code == 200
        created.append(host["connection_id"])

    listed = [e["connection_id"] for e in _public(client)]
    assert len(listed) == app_module.MAX_PUBLIC_SESSIONS
    assert set(listed) <= set(created)
    # Newest first, so the two oldest fell off the end.
    assert created[-1] in listed
    assert created[0] not in listed


def test_destroying_a_public_session_removes_it_from_the_lobby(client):
    host = _create_session(client)
    cid = host["connection_id"]
    client.post("/api/v2/session/toggle_public", json={
        "connection_id": cid, "user_id": host["user_id"], "is_public": True,
    })
    assert _public(client)

    r = client.post("/api/v2/session/destroy", json={
        "connection_id": cid, "user_id": host["user_id"],
    })
    assert r.status_code == 200
    assert _public(client) == []


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


def test_file_type_rejected_on_text_endpoint(client):
    """A "file" block with no upload has no filename and can never be fetched."""
    host = _create_session(client)
    r = client.post("/api/v2/block/create", json={
        "connection_id": host["connection_id"],
        "user_id": host["user_id"],
        "type": "file",
        "content": "x",
    })
    assert r.status_code == 422


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

    url = f"/api/v2/block/download/{cid}/{block_id}"
    assert client.get(url, headers={"Authorization": "Bearer outsider"}).status_code == 403

    r = client.get(url, headers=_auth(host))
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/octet-stream"


def test_deleting_block_revokes_its_raw_link(client):
    """A raw link serves decrypted plaintext; it must not outlive its block."""
    host = _create_session(client)
    cid, uid = host["connection_id"], host["user_id"]

    block_id = client.post("/api/v2/block/create", json={
        "connection_id": cid, "user_id": uid, "type": "text", "content": "ct",
    }).json()["data"]["block_id"]

    code = client.post("/api/v2/raw/text", json={
        "connection_id": cid, "user_id": uid, "block_id": block_id, "content": "plaintext",
    }).json()["data"]["code"]

    assert client.get(f"/r/{cid}/{code}").status_code == 200

    r = client.request("DELETE", "/api/v2/block/delete", json={
        "connection_id": cid, "user_id": uid, "block_id": block_id,
    })
    assert r.status_code == 200
    assert client.get(f"/r/{cid}/{code}").status_code == 404


def test_curl_upload_rejects_oversized_body(client):
    host = _create_session(client)
    cid, uid = host["connection_id"], host["user_id"]
    assert client.post("/api/v2/session/toggle_curl", json={
        "connection_id": cid, "user_id": uid, "allow_curl_upload": True,
    }).status_code == 200

    import app as app_module
    oversized = b"x" * (app_module.MAX_CURL_UPLOAD_BYTES + 1)
    r = client.post(f"/u/{cid}", content=oversized)
    assert r.status_code == 413
