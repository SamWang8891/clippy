/**
 * Per-session AES encryption with a key generated client-side and shared
 * out-of-band via the URL fragment. The server never sees the key, so blocks
 * are end-to-end encrypted: anyone with the share URL can read; the server
 * (and anyone with raw API access) cannot.
 *
 * Implementation notes:
 * - Key is 32 random bytes (AES-256), encoded as base64url for the fragment.
 * - High-entropy random key means no PBKDF2 / iteration count is required.
 * - AES-CBC via crypto-js. Authenticated encryption (GCM) would be stronger
 *   but requires a Web Crypto async refactor across all call sites.
 */

import CryptoJS from 'crypto-js';

let sessionKey = null; // CryptoJS WordArray

/**
 * Generate a fresh 256-bit session key, returning the base64url-encoded form
 * suitable for embedding in a URL fragment.
 */
export function generateSessionKey() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return bytesToBase64Url(bytes);
}

/**
 * Install the active session key from its base64url-encoded form.
 * Must be called before encrypt() / decrypt().
 */
export function setSessionKey(base64UrlKey) {
    if (!base64UrlKey) {
        sessionKey = null;
        return;
    }
    const bytes = base64UrlToBytes(base64UrlKey);
    if (bytes.length !== 32) {
        throw new Error(`Invalid session key length: expected 32 bytes, got ${bytes.length}`);
    }
    sessionKey = CryptoJS.lib.WordArray.create(bytes);
}

export function clearSessionKey() {
    sessionKey = null;
}

export function hasSessionKey() {
    return sessionKey !== null;
}

export function encrypt(data) {
    if (!sessionKey) {
        throw new Error('Session key not set');
    }
    return CryptoJS.AES.encrypt(data, sessionKey, {
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7,
    }).toString();
}

export function decrypt(encryptedData) {
    if (!sessionKey) {
        throw new Error('Session key not set');
    }
    const decrypted = CryptoJS.AES.decrypt(encryptedData, sessionKey, {
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7,
    });
    const text = decrypted.toString(CryptoJS.enc.Utf8);
    if (!text && encryptedData) {
        // crypto-js returns "" on bad key/ciphertext rather than throwing.
        throw new Error('Decryption failed');
    }
    return text;
}

function bytesToBase64Url(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(b64url) {
    const padded = b64url.replace(/-/g, '+').replace(/_/g, '/')
        + '==='.slice((b64url.length + 3) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}
