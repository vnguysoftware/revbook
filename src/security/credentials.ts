import { encrypt, decrypt } from './encryption.js';

/**
 * Credential encryption helpers for billing_connections.credentials.
 *
 * The credentials column stores a JSON object. When encryption is enabled,
 * we serialize the object to JSON, encrypt the JSON string, and store
 * the encrypted string. On read, we detect whether the value is an
 * encrypted string or a legacy plaintext object and handle both.
 */

/**
 * Encrypt a credentials object for database storage.
 * Returns the encrypted string (or the raw object if encryption is not configured).
 */
export function writeCredentials(credentials: Record<string, unknown>): unknown {
  const json = JSON.stringify(credentials);
  const encrypted = encrypt(json);
  // If encryption happened, store as a string; otherwise store the raw object
  if (encrypted !== json) {
    return encrypted;
  }
  return credentials;
}

/**
 * Read and decrypt credentials from the database.
 * Handles both encrypted strings and legacy plaintext JSON objects.
 */
export function readCredentials<T = Record<string, unknown>>(raw: unknown): T {
  // Already a parsed object (legacy plaintext storage)
  if (typeof raw === 'object' && raw !== null) {
    return raw as T;
  }

  // Encrypted string or plain JSON string
  if (typeof raw === 'string') {
    const decrypted = decrypt(raw);
    return JSON.parse(decrypted) as T;
  }

  throw new Error('Unexpected credentials format');
}
