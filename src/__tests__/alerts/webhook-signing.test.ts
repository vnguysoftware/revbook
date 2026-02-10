import { describe, it, expect } from 'vitest';
import {
  generateSigningSecret,
  signWebhookPayload,
  verifyWebhookSignature,
} from '../../alerts/webhook-signing.js';

describe('webhook signing', () => {
  describe('generateSigningSecret', () => {
    it('generates a secret with whsec_ prefix', () => {
      const secret = generateSigningSecret();
      expect(secret).toMatch(/^whsec_[a-f0-9]{64}$/);
    });

    it('generates unique secrets', () => {
      const s1 = generateSigningSecret();
      const s2 = generateSigningSecret();
      expect(s1).not.toEqual(s2);
    });
  });

  describe('signWebhookPayload', () => {
    it('produces a valid signature format', () => {
      const secret = generateSigningSecret();
      const payload = JSON.stringify({ test: true });
      const { signature, timestamp } = signWebhookPayload(payload, secret);

      expect(signature).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);
      expect(timestamp).toBeTypeOf('number');
    });

    it('uses provided timestamp', () => {
      const secret = generateSigningSecret();
      const payload = JSON.stringify({ test: true });
      const { signature } = signWebhookPayload(payload, secret, 1234567890);

      expect(signature).toContain('t=1234567890');
    });

    it('produces different signatures for different payloads', () => {
      const secret = generateSigningSecret();
      const ts = Math.floor(Date.now() / 1000);
      const sig1 = signWebhookPayload('{"a":1}', secret, ts);
      const sig2 = signWebhookPayload('{"b":2}', secret, ts);

      expect(sig1.signature).not.toEqual(sig2.signature);
    });

    it('produces different signatures for different secrets', () => {
      const payload = '{"test":true}';
      const ts = Math.floor(Date.now() / 1000);
      const sig1 = signWebhookPayload(payload, generateSigningSecret(), ts);
      const sig2 = signWebhookPayload(payload, generateSigningSecret(), ts);

      expect(sig1.signature).not.toEqual(sig2.signature);
    });
  });

  describe('verifyWebhookSignature', () => {
    it('verifies a valid signature', () => {
      const secret = generateSigningSecret();
      const payload = JSON.stringify({ event: 'issue.created' });
      const { signature } = signWebhookPayload(payload, secret);

      expect(verifyWebhookSignature(payload, signature, secret)).toBe(true);
    });

    it('rejects tampered payload', () => {
      const secret = generateSigningSecret();
      const payload = JSON.stringify({ event: 'issue.created' });
      const { signature } = signWebhookPayload(payload, secret);

      const tampered = JSON.stringify({ event: 'issue.resolved' });
      expect(verifyWebhookSignature(tampered, signature, secret)).toBe(false);
    });

    it('rejects wrong secret', () => {
      const secret = generateSigningSecret();
      const wrongSecret = generateSigningSecret();
      const payload = JSON.stringify({ event: 'issue.created' });
      const { signature } = signWebhookPayload(payload, secret);

      expect(verifyWebhookSignature(payload, signature, wrongSecret)).toBe(false);
    });

    it('rejects expired signatures (replay protection)', () => {
      const secret = generateSigningSecret();
      const payload = JSON.stringify({ event: 'issue.created' });
      // Sign with a timestamp 10 minutes ago
      const oldTimestamp = Math.floor(Date.now() / 1000) - 600;
      const { signature } = signWebhookPayload(payload, secret, oldTimestamp);

      // Default tolerance is 300s (5 minutes)
      expect(verifyWebhookSignature(payload, signature, secret)).toBe(false);
    });

    it('accepts signatures within tolerance', () => {
      const secret = generateSigningSecret();
      const payload = JSON.stringify({ event: 'issue.created' });
      // Sign with a timestamp 2 minutes ago
      const recentTimestamp = Math.floor(Date.now() / 1000) - 120;
      const { signature } = signWebhookPayload(payload, secret, recentTimestamp);

      expect(verifyWebhookSignature(payload, signature, secret)).toBe(true);
    });

    it('accepts custom tolerance', () => {
      const secret = generateSigningSecret();
      const payload = JSON.stringify({ event: 'issue.created' });
      const oldTimestamp = Math.floor(Date.now() / 1000) - 600;
      const { signature } = signWebhookPayload(payload, secret, oldTimestamp);

      // With a 10-minute tolerance, this should pass
      expect(verifyWebhookSignature(payload, signature, secret, 700)).toBe(true);
    });

    it('rejects malformed signature header', () => {
      const secret = generateSigningSecret();
      const payload = '{}';

      expect(verifyWebhookSignature(payload, 'invalid', secret)).toBe(false);
      expect(verifyWebhookSignature(payload, 'v1=abc', secret)).toBe(false);
      expect(verifyWebhookSignature(payload, 't=notanumber,v1=abc', secret)).toBe(false);
    });
  });
});
