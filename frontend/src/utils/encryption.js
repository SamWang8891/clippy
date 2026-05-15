/**
 * Per-session AES-GCM encryption using the Web Crypto API.
 *
 * - Key: 32 bytes derived deterministically from the session's connection ID
 *   via SHA-256 over `clippy-session-v1:{connection_id}`. Both the creator and
 *   any joiner can compute it from the shared connection ID alone — no URL
 *   fragment required.
 * - Cipher: AES-256-GCM with a fresh 96-bit IV per message. Authentication tag
 *   is appended by Web Crypto, so any bit-flip is detected on decrypt.
 * - Wire format: base64(iv ‖ ciphertextWithTag) — a single string suitable
 *   for both JSON payloads and request bodies.
 *
 * Note: because the key is derived from the connection ID, the server (which
 * issues IDs) could theoretically derive it too. It does not. This gives
 * encrypted-at-rest properties and opaque ciphertext on the wire, but is not
 * a strict end-to-end model against a malicious server.
 */

const AES_GCM = 'AES-GCM';
const IV_LENGTH = 12;
const KDF_PREFIX = 'clippy-session-v1:';
const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

let sessionKeyBytes = null; // Uint8Array(32)
let cryptoKeyPromise = null; // Promise<CryptoKey>

export async function setSessionKeyFromConnectionId(connectionId) {
    if (!connectionId) {
        clearSessionKey();
        return;
    }
    const input = ENCODER.encode(`${KDF_PREFIX}${connectionId}`);
    const digest = await crypto.subtle.digest('SHA-256', input);
    sessionKeyBytes = new Uint8Array(digest);
    cryptoKeyPromise = null; // re-import on next use
}

export function clearSessionKey() {
    sessionKeyBytes = null;
    cryptoKeyPromise = null;
}

export function hasSessionKey() {
    return sessionKeyBytes !== null;
}

async function getCryptoKey() {
    if (!sessionKeyBytes) throw new Error('Session key not set');
    if (!cryptoKeyPromise) {
        cryptoKeyPromise = crypto.subtle.importKey(
            'raw',
            sessionKeyBytes,
            {name: AES_GCM},
            false,
            ['encrypt', 'decrypt'],
        );
    }
    return cryptoKeyPromise;
}

/**
 * Encrypt a string or Uint8Array, returning base64(iv ‖ ciphertext).
 */
export async function encrypt(input) {
    const key = await getCryptoKey();
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const plaintextBytes = typeof input === 'string' ? ENCODER.encode(input) : input;
    const ciphertext = await crypto.subtle.encrypt({name: AES_GCM, iv}, key, plaintextBytes);

    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.length);
    return bytesToBase64(combined);
}

/**
 * Decrypt base64(iv ‖ ciphertext) and return the plaintext as a UTF-8 string.
 * Throws if the AES-GCM tag is invalid (i.e., wrong key or tampered ciphertext).
 */
export async function decrypt(b64Cipher) {
    const bytes = await decryptToBytes(b64Cipher);
    return DECODER.decode(bytes);
}

/**
 * Decrypt base64(iv ‖ ciphertext) and return the raw plaintext bytes.
 * Use this for downloaded files — calling decrypt() and re-encoding would
 * corrupt non-UTF-8 binary data.
 */
export async function decryptToBytes(b64Cipher) {
    const key = await getCryptoKey();
    const combined = base64ToBytes(b64Cipher);
    if (combined.length < IV_LENGTH) {
        throw new Error('Ciphertext too short');
    }
    const iv = combined.subarray(0, IV_LENGTH);
    const ciphertext = combined.subarray(IV_LENGTH);
    const plaintext = await crypto.subtle.decrypt({name: AES_GCM, iv}, key, ciphertext);
    return new Uint8Array(plaintext);
}

// --- base64 helpers ---------------------------------------------------------

function bytesToBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

function base64ToBytes(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}
