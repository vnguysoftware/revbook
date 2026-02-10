import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as jose from 'jose';
import * as crypto from 'crypto';
import { AppleNormalizer } from '../../ingestion/providers/apple.js';
import {
  createAppleNotificationPayload,
  createRawWebhookEvent,
} from '../helpers.js';

// Mock the logger
vi.mock('../../config/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

/**
 * Creates a self-signed certificate chain mimicking Apple's x5c format.
 * Generates root CA -> intermediate -> leaf, all using EC P-256 keys.
 */
async function createTestCertChain() {
  // Generate 3 EC key pairs
  const rootKeys = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const intermediateKeys = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const leafKeys = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });

  // Self-signed root CA certificate
  const rootCertPem = createSelfSignedCert(rootKeys, 'Apple Root CA - G3 Test', rootKeys, true);
  // Intermediate signed by root
  const intermediateCertPem = createSelfSignedCert(intermediateKeys, 'Apple Intermediate Test', rootKeys, true);
  // Leaf signed by intermediate
  const leafCertPem = createSelfSignedCert(leafKeys, 'Apple Leaf Test', intermediateKeys, false);

  // Extract base64 DER from PEM
  const extractB64 = (pem: string) => pem
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s/g, '');

  return {
    leafKeys,
    intermediateKeys,
    rootKeys,
    x5c: [
      extractB64(leafCertPem),
      extractB64(intermediateCertPem),
      extractB64(rootCertPem),
    ],
    rootCertPem,
    leafCertPem,
  };
}

/**
 * Minimal self-signed X.509 certificate creation using Node.js crypto.
 * For testing only -- not production-grade cert generation.
 */
function createSelfSignedCert(
  subjectKeys: crypto.KeyPairKeyObjectResult,
  cn: string,
  signerKeys: crypto.KeyPairKeyObjectResult,
  isCA: boolean,
): string {
  // Use Node.js built-in X509Certificate generation via openssl-like ASN.1
  // Since Node doesn't have a simple createCertificate API, we use a DER builder approach
  // For test purposes, we generate a minimal valid X.509v3 cert

  const now = new Date();
  const notBefore = new Date(now.getTime() - 86400000);
  const notAfter = new Date(now.getTime() + 365 * 86400000);

  // We'll use a simple approach: create CSR-like structure and self-sign
  // Actually, for Node 20+, we can use the experimental certificate API
  // But for compatibility, let's use a raw DER construction

  // Simplest approach: use node:crypto to create a certificate
  // Node doesn't natively create certs, so we'll create a minimal DER-encoded cert

  const subjectPublicKeyDer = subjectKeys.publicKey.export({ type: 'spki', format: 'der' });

  // Build TBSCertificate
  const serialNumber = crypto.randomBytes(8);
  const tbs = buildTBSCertificate({
    serialNumber,
    issuerCN: cn,
    subjectCN: cn,
    notBefore,
    notAfter,
    subjectPublicKeyInfo: subjectPublicKeyDer,
    isCA,
  });

  // Sign TBSCertificate
  const signer = crypto.createSign('SHA256');
  signer.update(tbs);
  const signature = signer.sign(signerKeys.privateKey);

  // Build full certificate
  const cert = buildCertificate(tbs, signature);

  // Convert to PEM
  const b64 = cert.toString('base64');
  const lines = b64.match(/.{1,64}/g) || [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----`;
}

// ASN.1 DER encoding helpers
function derLength(length: number): Buffer {
  if (length < 0x80) return Buffer.from([length]);
  if (length < 0x100) return Buffer.from([0x81, length]);
  return Buffer.from([0x82, (length >> 8) & 0xff, length & 0xff]);
}

function derSequence(...items: Buffer[]): Buffer {
  const content = Buffer.concat(items);
  return Buffer.concat([Buffer.from([0x30]), derLength(content.length), content]);
}

function derSet(...items: Buffer[]): Buffer {
  const content = Buffer.concat(items);
  return Buffer.concat([Buffer.from([0x31]), derLength(content.length), content]);
}

function derInteger(value: Buffer): Buffer {
  // Ensure positive by prepending 0x00 if high bit set
  let v = value;
  if (v[0] & 0x80) {
    v = Buffer.concat([Buffer.from([0x00]), v]);
  }
  return Buffer.concat([Buffer.from([0x02]), derLength(v.length), v]);
}

function derBitString(value: Buffer): Buffer {
  const content = Buffer.concat([Buffer.from([0x00]), value]); // 0 unused bits
  return Buffer.concat([Buffer.from([0x03]), derLength(content.length), content]);
}

function derOID(oid: string): Buffer {
  const parts = oid.split('.').map(Number);
  const bytes: number[] = [];
  bytes.push(40 * parts[0] + parts[1]);
  for (let i = 2; i < parts.length; i++) {
    let val = parts[i];
    if (val < 128) {
      bytes.push(val);
    } else {
      const encoded: number[] = [];
      encoded.unshift(val & 0x7f);
      val >>= 7;
      while (val > 0) {
        encoded.unshift((val & 0x7f) | 0x80);
        val >>= 7;
      }
      bytes.push(...encoded);
    }
  }
  return Buffer.concat([Buffer.from([0x06]), derLength(bytes.length), Buffer.from(bytes)]);
}

function derUTF8String(value: string): Buffer {
  const buf = Buffer.from(value, 'utf8');
  return Buffer.concat([Buffer.from([0x0c]), derLength(buf.length), buf]);
}

function derGeneralizedTime(date: Date): Buffer {
  const s = date.toISOString().replace(/[-:T]/g, '').replace(/\.\d+/, '').replace('Z', 'Z');
  const buf = Buffer.from(s, 'ascii');
  return Buffer.concat([Buffer.from([0x18]), derLength(buf.length), buf]);
}

function derExplicit(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([0xa0 | tag]), derLength(content.length), content]);
}

function buildTBSCertificate(opts: {
  serialNumber: Buffer;
  issuerCN: string;
  subjectCN: string;
  notBefore: Date;
  notAfter: Date;
  subjectPublicKeyInfo: Buffer;
  isCA: boolean;
}): Buffer {
  // Version v3
  const version = derExplicit(0, derInteger(Buffer.from([0x02])));

  // Serial number
  const serial = derInteger(opts.serialNumber);

  // Signature algorithm: ecdsa-with-SHA256 (1.2.840.10045.4.3.2)
  const sigAlgo = derSequence(derOID('1.2.840.10045.4.3.2'));

  // Issuer: CN=...
  const issuer = derSequence(
    derSet(derSequence(derOID('2.5.4.3'), derUTF8String(opts.issuerCN))),
  );

  // Validity
  const validity = derSequence(
    derGeneralizedTime(opts.notBefore),
    derGeneralizedTime(opts.notAfter),
  );

  // Subject: CN=...
  const subject = derSequence(
    derSet(derSequence(derOID('2.5.4.3'), derUTF8String(opts.subjectCN))),
  );

  // Subject Public Key Info (already DER-encoded)
  const spki = opts.subjectPublicKeyInfo;

  // Basic Constraints extension (if CA)
  let extensions = Buffer.alloc(0);
  if (opts.isCA) {
    const basicConstraints = derSequence(
      derOID('2.5.29.19'),       // basicConstraints OID
      Buffer.from([0x01, 0x01, 0xff]), // critical: TRUE
      // OCTET STRING wrapping the SEQUENCE { BOOLEAN TRUE }
      (() => {
        const val = derSequence(Buffer.from([0x01, 0x01, 0xff])); // CA: TRUE
        return Buffer.concat([Buffer.from([0x04]), derLength(val.length), val]);
      })(),
    );
    extensions = derExplicit(3, derSequence(basicConstraints));
  }

  return derSequence(version, serial, sigAlgo, issuer, validity, subject, spki, extensions);
}

function buildCertificate(tbs: Buffer, signature: Buffer): Buffer {
  // Signature algorithm
  const sigAlgo = derSequence(derOID('1.2.840.10045.4.3.2'));

  // Signature value as BIT STRING
  const sigBitString = derBitString(signature);

  return derSequence(tbs, sigAlgo, sigBitString);
}

/**
 * Creates a JWS signed with an EC key and including x5c certificate chain.
 */
async function createSignedAppleJws(
  payload: Record<string, any>,
  leafPrivateKey: crypto.KeyObject,
  x5c: string[],
): Promise<string> {
  const ecKey = await jose.importPKCS8(
    leafPrivateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
    'ES256',
  );

  const jws = await new jose.SignJWT(payload)
    .setProtectedHeader({
      alg: 'ES256',
      x5c,
    })
    .sign(ecKey);

  return jws;
}

describe('AppleNormalizer', () => {
  let normalizer: AppleNormalizer;
  const orgId = 'org_test_apple_001';

  beforeEach(() => {
    normalizer = new AppleNormalizer();
  });

  describe('source', () => {
    it('should identify as apple', () => {
      expect(normalizer.source).toBe('apple');
    });
  });

  describe('normalize', () => {
    // ─── SUBSCRIBED:INITIAL_BUY ────────────────────────────────────
    describe('SUBSCRIBED:INITIAL_BUY', () => {
      it('should normalize to purchase event', async () => {
        const payload = await createAppleNotificationPayload(
          'SUBSCRIBED',
          'INITIAL_BUY',
        );
        const rawEvent = createRawWebhookEvent(
          'apple',
          JSON.stringify({ signedPayload: payload.signedPayload }),
        );

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe('purchase');
        expect(events[0].status).toBe('success');
        expect(events[0].source).toBe('apple');
        expect(events[0].orgId).toBe(orgId);
      });

      it('should set external subscription ID to original_transaction_id', async () => {
        const payload = await createAppleNotificationPayload(
          'SUBSCRIBED',
          'INITIAL_BUY',
          { originalTransactionId: 'orig_txn_custom' },
        );
        const rawEvent = createRawWebhookEvent(
          'apple',
          JSON.stringify({ signedPayload: payload.signedPayload }),
        );

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events[0].externalSubscriptionId).toBe('orig_txn_custom');
      });

      it('should set idempotency key from notification UUID', async () => {
        const payload = await createAppleNotificationPayload(
          'SUBSCRIBED',
          'INITIAL_BUY',
        );
        const rawEvent = createRawWebhookEvent(
          'apple',
          JSON.stringify({ signedPayload: payload.signedPayload }),
        );

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events[0].idempotencyKey).toMatch(/^apple:/);
      });
    });

    // ─── SUBSCRIBED:RESUBSCRIBE ────────────────────────────────────
    describe('SUBSCRIBED:RESUBSCRIBE', () => {
      it('should normalize to purchase event', async () => {
        const payload = await createAppleNotificationPayload(
          'SUBSCRIBED',
          'RESUBSCRIBE',
        );
        const rawEvent = createRawWebhookEvent(
          'apple',
          JSON.stringify({ signedPayload: payload.signedPayload }),
        );

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe('purchase');
        expect(events[0].status).toBe('success');
      });
    });

    // ─── DID_RENEW ─────────────────────────────────────────────────
    describe('DID_RENEW', () => {
      it('should normalize to renewal event', async () => {
        const payload = await createAppleNotificationPayload(
          'DID_RENEW',
          undefined,
        );
        const rawEvent = createRawWebhookEvent(
          'apple',
          JSON.stringify({ signedPayload: payload.signedPayload }),
        );

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe('renewal');
        expect(events[0].status).toBe('success');
      });

      it('should normalize BILLING_RECOVERY subtype to renewal', async () => {
        const payload = await createAppleNotificationPayload(
          'DID_RENEW',
          'BILLING_RECOVERY',
        );
        const rawEvent = createRawWebhookEvent(
          'apple',
          JSON.stringify({ signedPayload: payload.signedPayload }),
        );

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe('renewal');
        expect(events[0].status).toBe('success');
      });
    });

    // ─── DID_FAIL_TO_RENEW ─────────────────────────────────────────
    describe('DID_FAIL_TO_RENEW', () => {
      it('should normalize to billing_retry when no grace period', async () => {
        const payload = await createAppleNotificationPayload(
          'DID_FAIL_TO_RENEW',
          undefined,
        );
        const rawEvent = createRawWebhookEvent(
          'apple',
          JSON.stringify({ signedPayload: payload.signedPayload }),
        );

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe('billing_retry');
        expect(events[0].status).toBe('failed');
      });

      it('should normalize to grace_period_start with GRACE_PERIOD subtype', async () => {
        const payload = await createAppleNotificationPayload(
          'DID_FAIL_TO_RENEW',
          'GRACE_PERIOD',
        );
        const rawEvent = createRawWebhookEvent(
          'apple',
          JSON.stringify({ signedPayload: payload.signedPayload }),
        );

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe('grace_period_start');
        expect(events[0].status).toBe('pending');
      });
    });

    // ─── EXPIRED ───────────────────────────────────────────────────
    describe('EXPIRED', () => {
      it('should normalize VOLUNTARY expiration', async () => {
        const payload = await createAppleNotificationPayload(
          'EXPIRED',
          'VOLUNTARY',
        );
        const rawEvent = createRawWebhookEvent(
          'apple',
          JSON.stringify({ signedPayload: payload.signedPayload }),
        );

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe('expiration');
        expect(events[0].status).toBe('success');
      });

      it('should normalize BILLING_RETRY expiration with failed status', async () => {
        const payload = await createAppleNotificationPayload(
          'EXPIRED',
          'BILLING_RETRY',
        );
        const rawEvent = createRawWebhookEvent(
          'apple',
          JSON.stringify({ signedPayload: payload.signedPayload }),
        );

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe('expiration');
        expect(events[0].status).toBe('failed');
      });

      it('should normalize PRICE_INCREASE expiration', async () => {
        const payload = await createAppleNotificationPayload(
          'EXPIRED',
          'PRICE_INCREASE',
        );
        const rawEvent = createRawWebhookEvent(
          'apple',
          JSON.stringify({ signedPayload: payload.signedPayload }),
        );

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe('expiration');
        expect(events[0].status).toBe('success');
      });
    });

    // ─── REFUND ────────────────────────────────────────────────────
    describe('REFUND', () => {
      it('should normalize to refund event', async () => {
        const payload = await createAppleNotificationPayload(
          'REFUND',
          undefined,
        );
        const rawEvent = createRawWebhookEvent(
          'apple',
          JSON.stringify({ signedPayload: payload.signedPayload }),
        );

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe('refund');
        expect(events[0].status).toBe('refunded');
      });
    });

    // ─── REVOKE ────────────────────────────────────────────────────
    describe('REVOKE', () => {
      it('should normalize to revoke event', async () => {
        const payload = await createAppleNotificationPayload(
          'REVOKE',
          undefined,
        );
        const rawEvent = createRawWebhookEvent(
          'apple',
          JSON.stringify({ signedPayload: payload.signedPayload }),
        );

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe('revoke');
        expect(events[0].status).toBe('success');
      });
    });

    // ─── OFFER_REDEEMED ────────────────────────────────────────────
    describe('OFFER_REDEEMED', () => {
      it('should normalize INITIAL_BUY offer redemption', async () => {
        const payload = await createAppleNotificationPayload(
          'OFFER_REDEEMED',
          'INITIAL_BUY',
        );
        const rawEvent = createRawWebhookEvent(
          'apple',
          JSON.stringify({ signedPayload: payload.signedPayload }),
        );

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe('offer_redeemed');
        expect(events[0].status).toBe('success');
      });
    });

    // ─── PRICE_INCREASE ────────────────────────────────────────────
    describe('PRICE_INCREASE', () => {
      it('should normalize price increase pending', async () => {
        const payload = await createAppleNotificationPayload(
          'PRICE_INCREASE',
          'PENDING',
        );
        const rawEvent = createRawWebhookEvent(
          'apple',
          JSON.stringify({ signedPayload: payload.signedPayload }),
        );

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe('price_change');
        expect(events[0].status).toBe('pending');
      });

      it('should normalize price increase accepted', async () => {
        const payload = await createAppleNotificationPayload(
          'PRICE_INCREASE',
          'ACCEPTED',
        );
        const rawEvent = createRawWebhookEvent(
          'apple',
          JSON.stringify({ signedPayload: payload.signedPayload }),
        );

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe('price_change');
        expect(events[0].status).toBe('success');
      });
    });

    // ─── Skipped / test events ─────────────────────────────────────
    describe('skipped events', () => {
      it('should return empty for TEST notification', async () => {
        const payload = await createAppleNotificationPayload(
          'TEST',
          undefined,
        );
        const rawEvent = createRawWebhookEvent(
          'apple',
          JSON.stringify({ signedPayload: payload.signedPayload }),
        );

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(0);
      });

      it('should return empty for CONSUMPTION_REQUEST', async () => {
        const payload = await createAppleNotificationPayload(
          'CONSUMPTION_REQUEST',
          undefined,
        );
        const rawEvent = createRawWebhookEvent(
          'apple',
          JSON.stringify({ signedPayload: payload.signedPayload }),
        );

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(0);
      });

      it('should return empty for unmapped notification type', async () => {
        const payload = await createAppleNotificationPayload(
          'COMPLETELY_UNKNOWN_TYPE',
          'MYSTERY_SUBTYPE',
        );
        const rawEvent = createRawWebhookEvent(
          'apple',
          JSON.stringify({ signedPayload: payload.signedPayload }),
        );

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(0);
      });
    });

    // ─── Financial extraction ──────────────────────────────────────
    describe('financial details', () => {
      it('should extract price in milliunits and convert', async () => {
        const payload = await createAppleNotificationPayload(
          'SUBSCRIBED',
          'INITIAL_BUY',
          { price: 9990, currency: 'USD' },
        );
        const rawEvent = createRawWebhookEvent(
          'apple',
          JSON.stringify({ signedPayload: payload.signedPayload }),
        );

        const events = await normalizer.normalize(orgId, rawEvent);

        // Apple sends price in milliunits, normalizer multiplies by 1000
        expect(events[0].amountCents).toBe(Math.round(9990 * 1000));
        expect(events[0].currency).toBe('USD');
      });

      it('should handle missing price gracefully', async () => {
        const payload = await createAppleNotificationPayload(
          'DID_RENEW',
          undefined,
          { price: undefined },
        );
        const rawEvent = createRawWebhookEvent(
          'apple',
          JSON.stringify({ signedPayload: payload.signedPayload }),
        );

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(1);
        expect(events[0].amountCents).toBeUndefined();
      });
    });

    // ─── Environment detection ─────────────────────────────────────
    describe('environment detection', () => {
      it('should preserve Production environment in raw payload', async () => {
        const payload = await createAppleNotificationPayload(
          'SUBSCRIBED',
          'INITIAL_BUY',
          { environment: 'Production' },
        );
        const rawEvent = createRawWebhookEvent(
          'apple',
          JSON.stringify({ signedPayload: payload.signedPayload }),
        );

        const events = await normalizer.normalize(orgId, rawEvent);

        const raw = events[0].rawPayload as any;
        expect(raw.notification.data.environment).toBe('Production');
      });

      it('should preserve Sandbox environment in raw payload', async () => {
        const payload = await createAppleNotificationPayload(
          'SUBSCRIBED',
          'INITIAL_BUY',
          { environment: 'Sandbox' },
        );
        const rawEvent = createRawWebhookEvent(
          'apple',
          JSON.stringify({ signedPayload: payload.signedPayload }),
        );

        const events = await normalizer.normalize(orgId, rawEvent);

        const raw = events[0].rawPayload as any;
        expect(raw.transaction.environment).toBe('Sandbox');
      });
    });

    // ─── Family share detection ────────────────────────────────────
    describe('family share', () => {
      it('should include family share info in raw payload when present', async () => {
        const payload = await createAppleNotificationPayload(
          'SUBSCRIBED',
          'INITIAL_BUY',
          { inAppOwnershipType: 'FAMILY_SHARED' },
        );
        const rawEvent = createRawWebhookEvent(
          'apple',
          JSON.stringify({ signedPayload: payload.signedPayload }),
        );

        const events = await normalizer.normalize(orgId, rawEvent);

        const raw = events[0].rawPayload as any;
        expect(raw.transaction.inAppOwnershipType).toBe('FAMILY_SHARED');
      });
    });
  });

  // ─── extractIdentityHints ────────────────────────────────────────
  describe('extractIdentityHints', () => {
    it('should extract original_transaction_id', () => {
      const payload = {
        transaction: {
          originalTransactionId: 'orig_txn_001',
          bundleId: 'com.app.test',
          productId: 'com.app.premium',
        },
      };

      const hints = normalizer.extractIdentityHints(payload);

      expect(hints.find(h => h.idType === 'original_transaction_id')).toEqual({
        source: 'apple',
        idType: 'original_transaction_id',
        externalId: 'orig_txn_001',
      });
    });

    it('should extract appAccountToken as app_user_id', () => {
      const payload = {
        transaction: {
          originalTransactionId: 'orig_txn_001',
          appAccountToken: 'user_uuid_123',
          bundleId: 'com.app.test',
          productId: 'com.app.premium',
        },
      };

      const hints = normalizer.extractIdentityHints(payload);

      expect(hints.find(h => h.idType === 'app_user_id')).toEqual({
        source: 'apple',
        idType: 'app_user_id',
        externalId: 'user_uuid_123',
      });
    });

    it('should extract bundleId with productId metadata', () => {
      const payload = {
        transaction: {
          originalTransactionId: 'orig_txn_001',
          bundleId: 'com.app.test',
          productId: 'com.app.premium',
        },
      };

      const hints = normalizer.extractIdentityHints(payload);

      const bundleHint = hints.find(h => h.idType === 'bundle_id');
      expect(bundleHint).toBeDefined();
      expect(bundleHint!.externalId).toBe('com.app.test');
      expect(bundleHint!.metadata).toEqual({ productId: 'com.app.premium' });
    });

    it('should return empty array when no transaction data', () => {
      const hints = normalizer.extractIdentityHints({});

      expect(hints).toHaveLength(0);
    });
  });

  // ─── verifySignature ─────────────────────────────────────────────
  describe('verifySignature', () => {
    it('should return false for JWT without x5c certificate chain', async () => {
      const payload = await createAppleNotificationPayload(
        'SUBSCRIBED',
        'INITIAL_BUY',
      );
      const rawEvent = createRawWebhookEvent(
        'apple',
        JSON.stringify({ signedPayload: payload.signedPayload }),
      );

      // Test JWS is signed with HS256 and has no x5c chain,
      // so verifySignature correctly returns false
      const result = await normalizer.verifySignature(rawEvent, '');

      expect(result).toBe(false);
    });

    it('should return false for missing signedPayload', async () => {
      const rawEvent = createRawWebhookEvent(
        'apple',
        JSON.stringify({ something: 'else' }),
      );

      const result = await normalizer.verifySignature(rawEvent, '');

      expect(result).toBe(false);
    });

    it('should return false for invalid JWT', async () => {
      const rawEvent = createRawWebhookEvent(
        'apple',
        JSON.stringify({ signedPayload: 'not-a-jwt' }),
      );

      const result = await normalizer.verifySignature(rawEvent, '');

      expect(result).toBe(false);
    });

    it('should return false for invalid JSON body', async () => {
      const rawEvent = createRawWebhookEvent(
        'apple',
        'not-json',
      );

      const result = await normalizer.verifySignature(rawEvent, '');

      expect(result).toBe(false);
    });

    it('should return false for JWS with only 2 certs in chain (too short)', async () => {
      const chain = await createTestCertChain();
      // Create a JWS with only 2 certs instead of required 3
      const shortX5c = chain.x5c.slice(0, 2);
      const jws = await createSignedAppleJws(
        { notificationType: 'TEST', version: '2.0', signedDate: Date.now() },
        chain.leafKeys.privateKey,
        shortX5c,
      );
      const rawEvent = createRawWebhookEvent(
        'apple',
        JSON.stringify({ signedPayload: jws }),
      );

      const result = await normalizer.verifySignature(rawEvent, '');

      expect(result).toBe(false);
    });

    it('should return false when root cert does not match Apple root CA', async () => {
      const chain = await createTestCertChain();
      // JWS has a valid 3-cert chain but the root is NOT Apple's real root CA
      const jws = await createSignedAppleJws(
        { notificationType: 'TEST', version: '2.0', signedDate: Date.now() },
        chain.leafKeys.privateKey,
        chain.x5c,
      );
      const rawEvent = createRawWebhookEvent(
        'apple',
        JSON.stringify({ signedPayload: jws }),
      );

      const result = await normalizer.verifySignature(rawEvent, '');

      // Should fail because our test root cert doesn't match Apple's known root CA
      expect(result).toBe(false);
    });

    it('should return false for empty body', async () => {
      const rawEvent = createRawWebhookEvent('apple', '');

      const result = await normalizer.verifySignature(rawEvent, '');

      expect(result).toBe(false);
    });

    it('should return false for body with signedPayload as empty string', async () => {
      const rawEvent = createRawWebhookEvent(
        'apple',
        JSON.stringify({ signedPayload: '' }),
      );

      const result = await normalizer.verifySignature(rawEvent, '');

      expect(result).toBe(false);
    });
  });
});
