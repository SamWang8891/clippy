/**
 * API client for Clippy backend.
 *
 * Wraps every backend endpoint and handles client-side encryption of any
 * payload that travels through the server. The server only ever sees
 * ciphertext — encryption keys live in the URL fragment, not on the wire.
 */

import {encrypt} from './encryption';
import {getBackendUrl} from './config';

function getApiBase() {
    return `${getBackendUrl()}/api/v1`;
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

export async function getConnectionIdLength() {
    const response = await fetch(`${getApiBase()}/session/id-length`);
    const data = await handleApiResponse(response);
    return data.connection_id_length;
}

export async function createSession(userName) {
    const response = await fetch(`${getApiBase()}/session/create`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({user_name: userName}),
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
    const params = new URLSearchParams({user_id: userId ?? ''});
    const response = await fetch(`${getApiBase()}/session/${encodeURIComponent(sessionId)}?${params}`);
    return handleApiResponse(response);
}

export async function destroySession(sessionId, userId) {
    const params = new URLSearchParams({connection_id: sessionId, user_id: userId});
    const response = await fetch(`${getApiBase()}/session/destroy?${params}`, {method: 'POST'});
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

export async function uploadFileBlock(sessionId, userId, file) {
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

export function getDownloadUrl(sessionId, blockId, userId) {
    const params = new URLSearchParams({user_id: userId ?? ''});
    return `${getApiBase()}/block/download/${encodeURIComponent(sessionId)}/${encodeURIComponent(blockId)}?${params}`;
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
