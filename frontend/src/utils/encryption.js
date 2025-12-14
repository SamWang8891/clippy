/**
 * Client-side encryption utilities using AES encryption with PBKDF2 key derivation.
 *
 * Provides end-to-end encryption for text and files before sending to the server.
 * The server stores only encrypted data and cannot read the content.
 */

import CryptoJS from 'crypto-js';

// Encryption configuration fetched from server on initialization
let encryptionConfig = null;

import { getBackendUrl } from './config';

/**
 * Initialize encryption by fetching the passphrase and salt from the server.
 * Must be called before using encrypt() or decrypt().
 *
 * @returns {Promise<Object>} Configuration object with passphrase, salt, and file size limit
 */
export async function initEncryption() {
  const backendUrl = getBackendUrl();
  const response = await fetch(`${backendUrl}/api/v1/config`);
  const config = await response.json();
  encryptionConfig = {
    passphrase: config.encryption_passphrase,
    salt: config.encryption_salt,
  };
  return config;
}

/**
 * Encrypt data using AES encryption.
 *
 * @param {string} data - Plain text data to encrypt
 * @returns {string} Encrypted data as a base64 string
 * @throws {Error} If encryption hasn't been initialized
 */
export function encrypt(data) {
  if (!encryptionConfig) {
    throw new Error('Encryption not initialized');
  }

  const key = CryptoJS.PBKDF2(
    encryptionConfig.passphrase,
    encryptionConfig.salt,
    { keySize: 256 / 32, iterations: 1000 }
  );

  const encrypted = CryptoJS.AES.encrypt(data, key.toString());
  return encrypted.toString();
}

/**
 * Decrypt AES-encrypted data.
 *
 * @param {string} encryptedData - Encrypted data as a base64 string
 * @returns {string} Decrypted plain text
 * @throws {Error} If encryption hasn't been initialized
 */
export function decrypt(encryptedData) {
  if (!encryptionConfig) {
    throw new Error('Encryption not initialized');
  }

  const key = CryptoJS.PBKDF2(
    encryptionConfig.passphrase,
    encryptionConfig.salt,
    { keySize: 256 / 32, iterations: 1000 }
  );

  const decrypted = CryptoJS.AES.decrypt(encryptedData, key.toString());
  return decrypted.toString(CryptoJS.enc.Utf8);
}
