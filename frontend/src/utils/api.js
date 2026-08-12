/**
 * API client for Clippy backend.
 *
 * Wraps every backend endpoint and encrypts any payload that travels through
 * the server, so the server sees only ciphertext. The key is derived from the
 * connection ID (see ./encryption.js) — the server issues that ID and could
 * derive the key too, so this is encryption at rest and opaque ciphertext on
 * the wire, not end-to-end secrecy against a malicious server.
 *
 * `userId` throughout is the caller's *secret* member token. It is sent in
 * request bodies, or in an Authorization header where there is no body — never
 * in a URL, which would leak it to proxy logs, history and Referer headers.
 */

import {encrypt} from './encryption';
import {getBackendUrl} from './config';

function getApiBase() {
    return `${getBackendUrl()}/api/v2`;
}

function authHeaders(userId) {
    return userId ? {Authorization: `Bearer ${userId}`} : {};
}

async function handleApiResponse(response) {
    let json;
    try {
        json = await response.json();
    } catch {
        throw new Error(`Invalid JSON response (HTTP ${response.status})`);
    }

    if (json.status !== undefined) {
        if (json.status >= 200 && json.status < 300) {
            return json.data ?? json;
        }
        throw new Error(json.message || 'Request failed');
    }

    if (!response.ok) {
        throw new Error(json.detail || json.message || 'Request failed');
    }
    return json;
}

/**
 * Length and allowed characters for a connection ID, straight from the server
 * so the client never keeps a second copy of the rule.
 *
 * @returns {Promise<{length: number, alphabet: string}>}
 */
export async function getConnectionIdRules() {
    const response = await fetch(`${getApiBase()}/session/id-length`);
    const data = await handleApiResponse(response);
    return {
        length: data.connection_id_length,
        alphabet: data.connection_id_alphabet ?? 'abcdefghijklmnopqrstuvwxyz0123456789',
    };
}

export async function createSession(userName, connectionId) {
    const response = await fetch(`${getApiBase()}/session/create`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({user_name: userName, connection_id: connectionId || null}),
    });
    return handleApiResponse(response);
}

export async function joinSession(sessionId, userName) {
    const response = await fetch(`${getApiBase()}/session/join`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({connection_id: sessionId, user_name: userName}),
    });
    return handleApiResponse(response);
}

export async function getSession(sessionId, userId) {
    const response = await fetch(`${getApiBase()}/session/${encodeURIComponent(sessionId)}`, {
        headers: authHeaders(userId),
    });
    return handleApiResponse(response);
}

export async function destroySession(sessionId, userId) {
    const response = await fetch(`${getApiBase()}/session/destroy`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({connection_id: sessionId, user_id: userId}),
    });
    return handleApiResponse(response);
}

export async function transferHost(sessionId, currentHostId, newHostId) {
    const response = await fetch(`${getApiBase()}/session/transfer_host`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            connection_id: sessionId,
            current_host_id: currentHostId,
            new_host_id: newHostId,
        }),
    });
    return handleApiResponse(response);
}

export async function toggleJoin(sessionId, userId, allowJoin) {
    const response = await fetch(`${getApiBase()}/session/toggle_join`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            connection_id: sessionId,
            user_id: userId,
            allow_join: allowJoin,
        }),
    });
    return handleApiResponse(response);
}

export async function toggleCurl(sessionId, userId, allowCurlUpload) {
    const response = await fetch(`${getApiBase()}/session/toggle_curl`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            connection_id: sessionId,
            user_id: userId,
            allow_curl_upload: allowCurlUpload,
        }),
    });
    return handleApiResponse(response);
}

export async function toggleSessionPublic(sessionId, userId, isPublic) {
    const response = await fetch(`${getApiBase()}/session/toggle_public`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            connection_id: sessionId,
            user_id: userId,
            is_public: isPublic,
        }),
    });
    return handleApiResponse(response);
}

/** Snapshot of the public lobby; live updates come over the lobby socket. */
export async function getPublicSessions() {
    const response = await fetch(`${getApiBase()}/sessions/public`);
    const data = await handleApiResponse(response);
    return data.sessions ?? [];
}

export async function createTextBlock(sessionId, userId, content) {
    const encryptedContent = await encrypt(content);
    const response = await fetch(`${getApiBase()}/block/create`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            connection_id: sessionId,
            user_id: userId,
            type: 'text',
            content: encryptedContent,
        }),
    });
    return handleApiResponse(response);
}

// Encrypting in the browser holds the file, its ciphertext and the base64 of
// that in memory at once, so the practical ceiling is far below the server's
// configured limit. Refuse early with a clear message instead of killing the tab.
export const BROWSER_MAX_FILE_BYTES = 256 * 1024 * 1024;

export function checkFileSize(file) {
    if (file.size > BROWSER_MAX_FILE_BYTES) {
        const mib = Math.round(BROWSER_MAX_FILE_BYTES / 1024 / 1024);
        throw new Error(`File is too large to encrypt in the browser (max ${mib} MB)`);
    }
}

export async function uploadFileBlock(sessionId, userId, file) {
    checkFileSize(file);
    const arrayBuffer = await file.arrayBuffer();
    const encryptedBytes = await encrypt(new Uint8Array(arrayBuffer));

    const formData = new FormData();
    formData.append('connection_id', sessionId);
    formData.append('user_id', userId);
    const blob = new Blob([encryptedBytes], {type: 'application/octet-stream'});
    formData.append('file', blob, file.name);

    const response = await fetch(`${getApiBase()}/block/upload`, {
        method: 'POST',
        body: formData,
    });
    return handleApiResponse(response);
}

export async function updateTextBlock(sessionId, userId, blockId, content) {
    const encryptedContent = await encrypt(content);
    const response = await fetch(`${getApiBase()}/block/update`, {
        method: 'PATCH',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            connection_id: sessionId,
            user_id: userId,
            block_id: blockId,
            content: encryptedContent,
        }),
    });
    return handleApiResponse(response);
}

export async function replaceFileBlock(sessionId, userId, blockId, file) {
    checkFileSize(file);
    const arrayBuffer = await file.arrayBuffer();
    const encryptedBytes = await encrypt(new Uint8Array(arrayBuffer));

    const formData = new FormData();
    formData.append('connection_id', sessionId);
    formData.append('user_id', userId);
    formData.append('block_id', blockId);
    const blob = new Blob([encryptedBytes], {type: 'application/octet-stream'});
    formData.append('file', blob, file.name);

    const response = await fetch(`${getApiBase()}/block/replace`, {
        method: 'POST',
        body: formData,
    });
    return handleApiResponse(response);
}

export async function deleteBlock(sessionId, userId, blockId) {
    const response = await fetch(`${getApiBase()}/block/delete`, {
        method: 'DELETE',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            connection_id: sessionId,
            user_id: userId,
            block_id: blockId,
        }),
    });
    return handleApiResponse(response);
}

/**
 * Fetch a block's ciphertext. Auth travels in a header, so this can't be an
 * `<a href>` — every caller already used fetch(), so nothing is lost.
 */
export async function fetchBlockCiphertext(sessionId, blockId, userId) {
    const url = `${getApiBase()}/block/download/${encodeURIComponent(sessionId)}/${encodeURIComponent(blockId)}`;
    const response = await fetch(url, {headers: authHeaders(userId)});
    if (!response.ok) throw new Error(`Download failed (HTTP ${response.status})`);
    return response.text();
}

export async function getConfig() {
    const response = await fetch(`${getApiBase()}/config`);
    return handleApiResponse(response);
}

export async function createRawTextLink(sessionId, userId, blockId, content) {
    const response = await fetch(`${getApiBase()}/raw/text`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            connection_id: sessionId,
            user_id: userId,
            block_id: blockId,
            content,
        }),
    });
    return handleApiResponse(response);
}

export async function createRawFileLink(sessionId, userId, blockId, decryptedBlob, originalFilename) {
    const formData = new FormData();
    formData.append('connection_id', sessionId);
    formData.append('user_id', userId);
    formData.append('block_id', blockId);
    formData.append('original_filename', originalFilename);
    formData.append('file', decryptedBlob, originalFilename);

    const response = await fetch(`${getApiBase()}/raw/file`, {
        method: 'POST',
        body: formData,
    });
    return handleApiResponse(response);
}

export function getRawLinkUrl(sessionId, code) {
    return `${window.location.origin}/r/${encodeURIComponent(sessionId)}/${encodeURIComponent(code)}`;
}
