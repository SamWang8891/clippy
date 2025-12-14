/**
 * API client for Clippy backend.
 *
 * Handles all HTTP requests to the backend API, including session management,
 * block operations, and file uploads. Automatically encrypts data before sending.
 */

import CryptoJS from 'crypto-js';
import { encrypt, decrypt } from './encryption';
import { getBackendUrl } from './config';

/**
 * Get the full API base URL
 * @returns {string} Full API base URL
 */
function getApiBase() {
  return `${getBackendUrl()}/api/v1`;
}

/**
 * Create a new collaborative session.
 *
 * @param {string} [userName] - Optional user name (random name generated if not provided)
 * @returns {Promise<Object>} Session data including session_id, user_id, user_name, is_host
 */
export async function createSession(userName) {
  const response = await fetch(`${getApiBase()}/session/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_name: userName }),
  });
  const data = await response.json();
  return data;
}

/**
 * Join an existing session.
 *
 * @param {string} sessionId - The 6-character session ID to join
 * @param {string} [userName] - Optional user name (random name generated if not provided)
 * @returns {Promise<Object>} Session data including session_id, user_id, user_name, is_host
 * @throws {Error} If session not found or not accepting new members
 */
export async function joinSession(sessionId, userName) {
  const response = await fetch(`${getApiBase()}/session/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, user_name: userName }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Failed to join session');
  }

  const data = await response.json();
  return data;
}

/**
 * Get session details including all users and blocks.
 *
 * @param {string} sessionId - The session ID
 * @returns {Promise<Object>} Session info with users, blocks, allow_join status, host_id
 * @throws {Error} If session not found
 */
export async function getSession(sessionId) {
  const response = await fetch(`${getApiBase()}/session/${sessionId}`);

  if (!response.ok) {
    throw new Error('Session not found');
  }

  const data = await response.json();
  return data;
}

export async function destroySession(sessionId, userId) {
  const response = await fetch(`${getApiBase()}/session/destroy?session_id=${sessionId}&user_id=${userId}`, {
    method: 'POST',
  });
  return response.json();
}

export async function transferHost(sessionId, currentHostId, newHostId) {
  const response = await fetch(`${getApiBase()}/session/transfer_host`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: sessionId,
      current_host_id: currentHostId,
      new_host_id: newHostId,
    }),
  });
  return response.json();
}

export async function toggleJoin(sessionId, userId, allowJoin) {
  const response = await fetch(`${getApiBase()}/session/toggle_join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: sessionId,
      user_id: userId,
      allow_join: allowJoin,
    }),
  });
  return response.json();
}

/**
 * Create a new text block (encrypted).
 *
 * @param {string} sessionId - The session ID
 * @param {string} userId - The user ID
 * @param {string} content - Plain text content to encrypt and store
 * @returns {Promise<Object>} Block data including block_id
 */
export async function createTextBlock(sessionId, userId, content) {
  const encryptedContent = encrypt(content);

  const response = await fetch(`${getApiBase()}/block/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: sessionId,
      user_id: userId,
      type: 'text',
      content: encryptedContent,
    }),
  });
  return response.json();
}

/**
 * Upload a file block (encrypted).
 *
 * @param {string} sessionId - The session ID
 * @param {string} userId - The user ID
 * @param {File} file - The file to encrypt and upload
 * @returns {Promise<Object>} Block data including block_id
 * @throws {Error} If file size exceeds maximum
 */
export async function uploadFileBlock(sessionId, userId, file) {
  // Read file as array buffer
  const arrayBuffer = await file.arrayBuffer();
  const wordArray = CryptoJS.lib.WordArray.create(arrayBuffer);
  const base64 = CryptoJS.enc.Base64.stringify(wordArray);

  // Encrypt the base64 data
  const encryptedData = encrypt(base64);

  // Create a blob with encrypted data and send it
  const formData = new FormData();
  formData.append('session_id', sessionId);
  formData.append('user_id', userId);

  // Create a blob with the encrypted data
  const encryptedBlob = new Blob([encryptedData], { type: 'application/octet-stream' });
  formData.append('file', encryptedBlob, file.name);

  const response = await fetch(`${getApiBase()}/block/upload`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Failed to upload file');
  }

  return response.json();
}

export async function deleteBlock(sessionId, userId, blockId) {
  const response = await fetch(`${getApiBase()}/block/delete`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: sessionId,
      user_id: userId,
      block_id: blockId,
    }),
  });
  return response.json();
}

export function getDownloadUrl(sessionId, blockId) {
  return `${getApiBase()}/block/download/${sessionId}/${blockId}`;
}

export async function downloadBlock(sessionId, blockId) {
  const response = await fetch(getDownloadUrl(sessionId, blockId));
  const encryptedData = await response.text();

  try {
    // Try to decrypt as text first
    const decryptedText = decrypt(encryptedData);
    return decryptedText;
  } catch (e) {
    // If decryption fails, it might be binary data
    return encryptedData;
  }
}
