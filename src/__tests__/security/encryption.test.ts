import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { encrypt, decrypt, isEncrypted, getKeyRotationStatus } from '../../security/encryption.js';
import { writeCredentials, readCredentials } from '../../security/credentials.js';
import { randomBytes } from 'crypto';

// Generate a valid 32-byte hex key for testing
const TEST_KEY = randomBytes(32).toString('hex');
const TEST_KEY_2 = randomBytes(32).toString('hex');
const TEST_KEY_3 = randomBytes(32).toString('hex');

describe('encryption', () => {
  describe('without encryption key', () => {
    beforeEach(() => {
      delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    });

    it('encrypt returns plaintext when no key configured', () => {
      const plaintext = 'sk_test_abc123';
      expect(encrypt(plaintext)).toBe(plaintext);
    });

    it('decrypt returns plaintext when no key configured and value is not encrypted', () => {
      const plaintext = 'sk_test_abc123';
      expect(decrypt(plaintext)).toBe(plaintext);
    });

    it('decrypt throws when encrypted value found but no key set', () => {
      // First encrypt with a key
      process.env.CREDENTIAL_ENCRYPTION_KEY = TEST_KEY;
      const encrypted = encrypt('secret');
      delete process.env.CREDENTIAL_ENCRYPTION_KEY;

      expect(() => decrypt(encrypted)).toThrow('CREDENTIAL_ENCRYPTION_KEY is required');
    });
  });

  describe('with encryption key', () => {
    beforeEach(() => {
      process.env.CREDENTIAL_ENCRYPTION_KEY = TEST_KEY;
    });

    afterEach(() => {
      delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    });

    it('round-trips correctly', () => {
      const plaintext = 'sk_live_very_secret_key_12345';
      const encrypted = encrypt(plaintext);
      expect(encrypted).not.toBe(plaintext);
      expect(encrypted.startsWith('enc:')).toBe(true);
      expect(decrypt(encrypted)).toBe(plaintext);
    });

    it('produces different ciphertexts for the same plaintext (unique IV)', () => {
      const plaintext = 'same_secret';
      const enc1 = encrypt(plaintext);
      const enc2 = encrypt(plaintext);
      expect(enc1).not.toBe(enc2);
      expect(decrypt(enc1)).toBe(plaintext);
      expect(decrypt(enc2)).toBe(plaintext);
    });

    it('handles empty strings', () => {
      const encrypted = encrypt('');
      expect(decrypt(encrypted)).toBe('');
    });

    it('handles unicode/special characters', () => {
      const plaintext = '🔑 private_key: -----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----';
      const encrypted = encrypt(plaintext);
      expect(decrypt(encrypted)).toBe(plaintext);
    });

    it('handles large payloads', () => {
      const plaintext = 'x'.repeat(10000);
      const encrypted = encrypt(plaintext);
      expect(decrypt(encrypted)).toBe(plaintext);
    });

    it('detects tampered ciphertext', () => {
      const encrypted = encrypt('secret');
      // Tamper with the ciphertext portion
      const parts = encrypted.split(':');
      parts[3] = Buffer.from('tampered').toString('base64');
      const tampered = parts.join(':');
      expect(() => decrypt(tampered)).toThrow();
    });

    it('detects tampered auth tag', () => {
      const encrypted = encrypt('secret');
      const parts = encrypted.split(':');
      parts[2] = Buffer.from(randomBytes(16)).toString('base64');
      const tampered = parts.join(':');
      expect(() => decrypt(tampered)).toThrow();
    });

    it('wrong key cannot decrypt (no fallback)', () => {
      const encrypted = encrypt('secret');
      process.env.CREDENTIAL_ENCRYPTION_KEY = TEST_KEY_2;
      delete process.env.CREDENTIAL_ENCRYPTION_KEY_PREVIOUS;
      expect(() => decrypt(encrypted)).toThrow();
    });

    it('isEncrypted returns true for encrypted values', () => {
      const encrypted = encrypt('secret');
      expect(isEncrypted(encrypted)).toBe(true);
    });

    it('isEncrypted returns false for plaintext', () => {
      expect(isEncrypted('sk_test_abc')).toBe(false);
    });
  });

  describe('key validation', () => {
    afterEach(() => {
      delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    });

    it('throws on invalid key length', () => {
      process.env.CREDENTIAL_ENCRYPTION_KEY = 'tooshort';
      expect(() => encrypt('test')).toThrow('64 hex characters');
    });
  });

  describe('key rotation', () => {
    afterEach(() => {
      delete process.env.CREDENTIAL_ENCRYPTION_KEY;
      delete process.env.CREDENTIAL_ENCRYPTION_KEY_PREVIOUS;
    });

    it('decrypts with current key when both keys are set', () => {
      process.env.CREDENTIAL_ENCRYPTION_KEY = TEST_KEY;
      const encrypted = encrypt('my-secret');

      // Set up rotation: new key is current, old key is previous
      process.env.CREDENTIAL_ENCRYPTION_KEY = TEST_KEY;
      process.env.CREDENTIAL_ENCRYPTION_KEY_PREVIOUS = TEST_KEY_2;

      expect(decrypt(encrypted)).toBe('my-secret');
    });

    it('falls back to previous key when current key cannot decrypt', () => {
      // Encrypt with OLD key
      process.env.CREDENTIAL_ENCRYPTION_KEY = TEST_KEY;
      const encrypted = encrypt('old-secret');

      // Rotate: new key is TEST_KEY_2, old key (TEST_KEY) is previous
      process.env.CREDENTIAL_ENCRYPTION_KEY = TEST_KEY_2;
      process.env.CREDENTIAL_ENCRYPTION_KEY_PREVIOUS = TEST_KEY;

      expect(decrypt(encrypted)).toBe('old-secret');
    });

    it('re-encrypt after rotation uses new key', () => {
      // Encrypt with old key
      process.env.CREDENTIAL_ENCRYPTION_KEY = TEST_KEY;
      const oldEncrypted = encrypt('rotate-me');

      // Rotate keys
      process.env.CREDENTIAL_ENCRYPTION_KEY = TEST_KEY_2;
      process.env.CREDENTIAL_ENCRYPTION_KEY_PREVIOUS = TEST_KEY;

      // Decrypt (should work via fallback)
      const plain = decrypt(oldEncrypted);
      expect(plain).toBe('rotate-me');

      // Re-encrypt — uses current (new) key
      const newEncrypted = encrypt(plain);

      // Now decrypt with just the new key (no previous needed)
      delete process.env.CREDENTIAL_ENCRYPTION_KEY_PREVIOUS;
      expect(decrypt(newEncrypted)).toBe('rotate-me');
    });

    it('fails when neither key can decrypt', () => {
      process.env.CREDENTIAL_ENCRYPTION_KEY = TEST_KEY;
      const encrypted = encrypt('secret');

      // Set both keys to ones that can't decrypt
      process.env.CREDENTIAL_ENCRYPTION_KEY = TEST_KEY_2;
      process.env.CREDENTIAL_ENCRYPTION_KEY_PREVIOUS = TEST_KEY_3;

      expect(() => decrypt(encrypted)).toThrow('Failed to decrypt credential with any configured key');
    });

    it('works with only previous key set (current key missing)', () => {
      process.env.CREDENTIAL_ENCRYPTION_KEY = TEST_KEY;
      const encrypted = encrypt('previous-only');

      // Remove current, set previous to the encrypting key
      delete process.env.CREDENTIAL_ENCRYPTION_KEY;
      process.env.CREDENTIAL_ENCRYPTION_KEY_PREVIOUS = TEST_KEY;

      expect(decrypt(encrypted)).toBe('previous-only');
    });
  });

  describe('getKeyRotationStatus', () => {
    afterEach(() => {
      delete process.env.CREDENTIAL_ENCRYPTION_KEY;
      delete process.env.CREDENTIAL_ENCRYPTION_KEY_PREVIOUS;
    });

    it('returns no keys configured', () => {
      delete process.env.CREDENTIAL_ENCRYPTION_KEY;
      const status = getKeyRotationStatus();
      expect(status.currentKeyConfigured).toBe(false);
      expect(status.previousKeyConfigured).toBe(false);
      expect(status.rotationInProgress).toBe(false);
    });

    it('returns current key only', () => {
      process.env.CREDENTIAL_ENCRYPTION_KEY = TEST_KEY;
      const status = getKeyRotationStatus();
      expect(status.currentKeyConfigured).toBe(true);
      expect(status.previousKeyConfigured).toBe(false);
      expect(status.rotationInProgress).toBe(false);
    });

    it('returns rotation in progress when both keys set', () => {
      process.env.CREDENTIAL_ENCRYPTION_KEY = TEST_KEY;
      process.env.CREDENTIAL_ENCRYPTION_KEY_PREVIOUS = TEST_KEY_2;
      const status = getKeyRotationStatus();
      expect(status.currentKeyConfigured).toBe(true);
      expect(status.previousKeyConfigured).toBe(true);
      expect(status.rotationInProgress).toBe(true);
    });
  });
});

describe('credentials helpers', () => {
  describe('without encryption key', () => {
    beforeEach(() => {
      delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    });

    it('writeCredentials returns the raw object', () => {
      const creds = { apiKey: 'sk_test_abc' };
      const stored = writeCredentials(creds);
      expect(stored).toEqual(creds);
    });

    it('readCredentials handles a plain object', () => {
      const creds = { apiKey: 'sk_test_abc' };
      const result = readCredentials<{ apiKey: string }>(creds);
      expect(result.apiKey).toBe('sk_test_abc');
    });
  });

  describe('with encryption key', () => {
    beforeEach(() => {
      process.env.CREDENTIAL_ENCRYPTION_KEY = TEST_KEY;
    });

    afterEach(() => {
      delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    });

    it('round-trips credentials object', () => {
      const creds = {
        apiKey: 'sk_live_very_secret',
        webhookSecret: 'whsec_test123',
      };

      const stored = writeCredentials(creds);
      expect(typeof stored).toBe('string');
      expect((stored as string).startsWith('enc:')).toBe(true);

      const restored = readCredentials<typeof creds>(stored);
      expect(restored).toEqual(creds);
    });

    it('readCredentials handles legacy plaintext object', () => {
      // Simulate reading a legacy row that was never encrypted
      const legacy = { apiKey: 'sk_test_old', webhookSecret: null };
      const result = readCredentials<typeof legacy>(legacy);
      expect(result.apiKey).toBe('sk_test_old');
    });

    it('handles Apple credentials with private keys', () => {
      const appleCreds = {
        keyId: 'ABC123',
        issuerId: 'DEF456',
        bundleId: 'com.example.app',
        privateKey: '-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49...\n-----END PRIVATE KEY-----',
      };

      const stored = writeCredentials(appleCreds);
      const restored = readCredentials<typeof appleCreds>(stored);
      expect(restored).toEqual(appleCreds);
    });
  });
});
