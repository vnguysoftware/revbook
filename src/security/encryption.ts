import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { createChildLogger } from '../config/logger.js';

const log = createChildLogger('encryption');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM recommended IV length
const AUTH_TAG_LENGTH = 16;
const PREFIX = 'enc:';

/**
 * AES-256-GCM encryption utility for credential storage.
 *
 * Format: "enc:<iv>:<authTag>:<ciphertext>" (all base64)
 *
 * Key rotation support:
 * - CREDENTIAL_ENCRYPTION_KEY — primary key (used for encrypt + first decrypt attempt)
 * - CREDENTIAL_ENCRYPTION_KEY_PREVIOUS — previous key (fallback decrypt only)
 *
 * - If CREDENTIAL_ENCRYPTION_KEY is not set, encrypt() returns plaintext
 *   and decrypt() passes through — so dev environments don't break.
 * - decrypt() auto-detects plaintext (no "enc:" prefix) for migration compat.
 */

function parseKeyHex(keyHex: string, envName: string): Buffer {
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) {
    throw new Error(
      `${envName} must be 64 hex characters (32 bytes). Got ${keyHex.length} hex chars.`,
    );
  }
  return key;
}

function getEncryptionKey(): Buffer | null {
  const keyHex = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!keyHex) return null;
  return parseKeyHex(keyHex, 'CREDENTIAL_ENCRYPTION_KEY');
}

function getPreviousEncryptionKey(): Buffer | null {
  const keyHex = process.env.CREDENTIAL_ENCRYPTION_KEY_PREVIOUS;
  if (!keyHex) return null;
  return parseKeyHex(keyHex, 'CREDENTIAL_ENCRYPTION_KEY_PREVIOUS');
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Always uses the current (primary) CREDENTIAL_ENCRYPTION_KEY.
 * Returns the encrypted string prefixed with "enc:" or the plaintext
 * if no encryption key is configured.
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  if (!key) return plaintext;

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `${PREFIX}${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

/** Internal: try to decrypt with a specific key buffer. Throws on failure. */
function decryptWithKey(parts: string[], key: Buffer): string {
  const iv = Buffer.from(parts[0], 'base64');
  const authTag = Buffer.from(parts[1], 'base64');
  const encrypted = Buffer.from(parts[2], 'base64');

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

/**
 * Decrypt an encrypted string. If the string doesn't have the "enc:"
 * prefix, it's treated as legacy plaintext and returned as-is.
 *
 * Tries the current key first. If that fails and a previous key is
 * configured, falls back to the previous key (key rotation support).
 */
export function decrypt(ciphertext: string): string {
  // Legacy plaintext passthrough
  if (!ciphertext.startsWith(PREFIX)) {
    return ciphertext;
  }

  const currentKey = getEncryptionKey();
  const previousKey = getPreviousEncryptionKey();

  if (!currentKey && !previousKey) {
    log.warn('Encrypted credential found but no encryption keys are set');
    throw new Error('CREDENTIAL_ENCRYPTION_KEY is required to decrypt credentials');
  }

  const parts = ciphertext.slice(PREFIX.length).split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted credential format');
  }

  // Try current key first
  if (currentKey) {
    try {
      return decryptWithKey(parts, currentKey);
    } catch {
      // Current key failed — fall through to previous key
    }
  }

  // Fall back to previous key
  if (previousKey) {
    try {
      const result = decryptWithKey(parts, previousKey);
      log.info('Decrypted with previous key — credential should be re-encrypted with current key');
      return result;
    } catch {
      // Previous key also failed
    }
  }

  throw new Error('Failed to decrypt credential with any configured key');
}

/**
 * Check if a value is encrypted (has the "enc:" prefix).
 */
export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

/**
 * Returns key rotation status info (safe for logging / admin endpoints).
 */
export function getKeyRotationStatus(): {
  currentKeyConfigured: boolean;
  previousKeyConfigured: boolean;
  rotationInProgress: boolean;
} {
  const currentKey = !!process.env.CREDENTIAL_ENCRYPTION_KEY;
  const previousKey = !!process.env.CREDENTIAL_ENCRYPTION_KEY_PREVIOUS;
  return {
    currentKeyConfigured: currentKey,
    previousKeyConfigured: previousKey,
    rotationInProgress: currentKey && previousKey,
  };
}
