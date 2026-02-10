import * as jose from 'jose';
import type { EventNormalizer } from '../normalizer/base.js';
import type {
  BillingSource,
  EventType,
  EventStatus,
  NormalizedEvent,
  RawWebhookEvent,
  IdentityHint,
} from '../../models/types.js';
import { createChildLogger } from '../../config/logger.js';

const log = createChildLogger('apple-normalizer');

/**
 * Apple App Store Server Notifications V2 types.
 * Reference: https://developer.apple.com/documentation/appstoreservernotifications
 */

interface AppleNotificationV2 {
  signedPayload: string;
}

interface DecodedNotification {
  notificationType: string;
  subtype?: string;
  data: {
    signedTransactionInfo: string;
    signedRenewalInfo?: string;
    environment: string;
    bundleId: string;
    appAppleId?: number;
  };
  notificationUUID: string;
  version: string;
  signedDate: number;
}

interface DecodedTransaction {
  transactionId: string;
  originalTransactionId: string;
  productId: string;
  bundleId: string;
  purchaseDate: number;
  expiresDate?: number;
  type: string; // Auto-Renewable, Non-Consumable, etc.
  environment: string;
  storefront: string;
  price?: number;
  currency?: string;
  offerType?: number;
  offerIdentifier?: string;
  revocationDate?: number;
  revocationReason?: number;
  appAccountToken?: string; // This is the developer's user ID if set
  quantity?: number;
}

interface DecodedRenewalInfo {
  originalTransactionId: string;
  productId: string;
  autoRenewStatus: number;
  autoRenewProductId: string;
  expirationIntent?: number;
  gracePeriodExpiresDate?: number;
  isInBillingRetryPeriod?: boolean;
  offerType?: number;
  priceIncreaseStatus?: number;
}

/** Maps Apple notification type + subtype to canonical event */
const APPLE_EVENT_MAP: Record<string, { eventType: EventType; status: EventStatus } | null> = {
  'SUBSCRIBED:INITIAL_BUY': { eventType: 'purchase', status: 'success' },
  'SUBSCRIBED:RESUBSCRIBE': { eventType: 'purchase', status: 'success' },
  'DID_RENEW:': { eventType: 'renewal', status: 'success' },
  'DID_RENEW:BILLING_RECOVERY': { eventType: 'renewal', status: 'success' },
  'DID_FAIL_TO_RENEW:': { eventType: 'billing_retry', status: 'failed' },
  'DID_FAIL_TO_RENEW:GRACE_PERIOD': { eventType: 'grace_period_start', status: 'pending' },
  'GRACE_PERIOD_EXPIRED:': { eventType: 'grace_period_end', status: 'failed' },
  'DID_CHANGE_RENEWAL_STATUS:AUTO_RENEW_DISABLED': { eventType: 'cancellation', status: 'success' },
  'DID_CHANGE_RENEWAL_STATUS:AUTO_RENEW_ENABLED': { eventType: 'resume', status: 'success' },
  'DID_CHANGE_RENEWAL_INFO:': null, // informational, skip
  'EXPIRED:VOLUNTARY': { eventType: 'expiration', status: 'success' },
  'EXPIRED:BILLING_RETRY': { eventType: 'expiration', status: 'failed' },
  'EXPIRED:PRICE_INCREASE': { eventType: 'expiration', status: 'success' },
  'EXPIRED:PRODUCT_NOT_FOR_SALE': { eventType: 'expiration', status: 'success' },
  'REFUND:': { eventType: 'refund', status: 'refunded' },
  'REVOKE:': { eventType: 'revoke', status: 'success' },
  'CONSUMPTION_REQUEST:': null, // Apple asking for consumption data
  'OFFER_REDEEMED:INITIAL_BUY': { eventType: 'offer_redeemed', status: 'success' },
  'OFFER_REDEEMED:RESUBSCRIBE': { eventType: 'offer_redeemed', status: 'success' },
  'OFFER_REDEEMED:UPGRADE': { eventType: 'offer_redeemed', status: 'success' },
  'OFFER_REDEEMED:DOWNGRADE': { eventType: 'offer_redeemed', status: 'success' },
  'PRICE_INCREASE:PENDING': { eventType: 'price_change', status: 'pending' },
  'PRICE_INCREASE:ACCEPTED': { eventType: 'price_change', status: 'success' },
  'RENEWAL_EXTENDED:': { eventType: 'renewal', status: 'success' },
  'TEST:': null, // test notification
};

// Apple's G3 root certificate for App Store Server Notifications JWS verification.
// Publicly available at https://www.apple.com/certificateauthority/AppleRootCA-G3.cer
const APPLE_ROOT_CA_G3_PEM = `-----BEGIN CERTIFICATE-----
MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwS
QXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9u
IEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcN
MTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBS
b290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9y
aXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49
AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtf
TjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK515
3aBAxL0LYhV08cWo0IwQDAdBgNVHQ4EFgQUu7DeoVgziJqkipnevr3rr9rLJKsw
DwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMCAQYwCgYIKoZIzj0EAwMDaAAw
ZQIxAIPpwcQWCIm7yNlHCNqfnAJjfb1oUSYcCN6FJM1d0Kf5olHJwsMxNdKhT5y4
xGPvngIwMnHpRtLogSEGRJSuieX+ericbEiEYs0hd89K9wqdqEPzKOBVB1BPC/GV
nAhIU5Pk
-----END CERTIFICATE-----`;

export class AppleNormalizer implements EventNormalizer {
  source: BillingSource = 'apple';

  /**
   * Verify Apple App Store Server Notifications V2 JWS signature.
   *
   * Apple signs notifications using a JWS with an x5c certificate chain.
   * We verify by:
   * 1. Extracting the x5c chain from the JWS protected header
   * 2. Verifying the root certificate matches Apple's known G3 root CA
   * 3. Verifying the JWS signature using the leaf certificate's public key
   *
   * The `secret` parameter is unused for Apple (verification uses x5c chain,
   * not a shared secret) but is required by the EventNormalizer interface.
   */
  async verifySignature(event: RawWebhookEvent, _secret: string): Promise<boolean> {
    try {
      const body = JSON.parse(event.body) as AppleNotificationV2;
      if (!body.signedPayload) return false;

      const jws = body.signedPayload;

      // 1. Decode the JWS header to get the x5c certificate chain
      const protectedHeader = jose.decodeProtectedHeader(jws);
      const x5c = protectedHeader.x5c;

      if (!x5c || x5c.length === 0) {
        log.warn('Apple JWS missing x5c certificate chain');
        return false;
      }

      // 2. Verify the root certificate matches Apple's known root CA
      // The x5c array is ordered: [leaf, intermediate, ..., root]
      const rootCertB64 = x5c[x5c.length - 1];
      const knownRootB64 = APPLE_ROOT_CA_G3_PEM
        .replace(/-----BEGIN CERTIFICATE-----/g, '')
        .replace(/-----END CERTIFICATE-----/g, '')
        .replace(/\s/g, '');

      if (rootCertB64.replace(/\s/g, '') !== knownRootB64) {
        log.warn('Apple JWS root certificate does not match known Apple Root CA');
        return false;
      }

      // 3. Import the leaf certificate's public key and verify the JWS
      const leafCert = await jose.importX509(
        `-----BEGIN CERTIFICATE-----\n${x5c[0]}\n-----END CERTIFICATE-----`,
        protectedHeader.alg || 'ES256',
      );

      // 4. Verify the JWS signature
      const { payload } = await jose.jwtVerify(jws, leafCert, {
        algorithms: [protectedHeader.alg || 'ES256'],
      });

      return !!payload;
    } catch (err) {
      log.warn({ err }, 'Apple JWS signature verification failed');
      return false;
    }
  }

  async normalize(orgId: string, event: RawWebhookEvent): Promise<NormalizedEvent[]> {
    const body = JSON.parse(event.body) as AppleNotificationV2;
    const notification = await this.decodeNotification(body.signedPayload);

    const mapKey = `${notification.notificationType}:${notification.subtype || ''}`;
    const mapping = APPLE_EVENT_MAP[mapKey];

    if (mapping === undefined) {
      // Try without subtype
      const fallbackKey = `${notification.notificationType}:`;
      const fallbackMapping = APPLE_EVENT_MAP[fallbackKey];
      if (fallbackMapping === undefined) {
        log.warn({ mapKey }, 'Unmapped Apple notification type');
        return [];
      }
      if (fallbackMapping === null) return [];
    }
    if (mapping === null) return [];

    const transaction = await this.decodeTransaction(notification.data.signedTransactionInfo);
    const renewalInfo = notification.data.signedRenewalInfo
      ? await this.decodeRenewalInfo(notification.data.signedRenewalInfo)
      : undefined;

    const identityHints = this.extractIdentityHints({
      transaction,
      notification,
    } as unknown as Record<string, unknown>);

    const normalized: NormalizedEvent = {
      orgId,
      source: 'apple',
      eventType: mapping!.eventType,
      eventTime: new Date(notification.signedDate),
      status: mapping!.status,
      externalEventId: notification.notificationUUID,
      externalSubscriptionId: transaction.originalTransactionId,
      idempotencyKey: `apple:${notification.notificationUUID}`,
      rawPayload: {
        notification: notification as unknown as Record<string, unknown>,
        transaction: transaction as unknown as Record<string, unknown>,
        renewalInfo: renewalInfo as unknown as Record<string, unknown>,
      },
      identityHints,
    };

    // Financial details
    if (transaction.price !== undefined) {
      normalized.amountCents = Math.round(transaction.price * 1000); // Apple sends in milliunits
      normalized.currency = transaction.currency;
    }

    // Plan metadata
    // Extract plan tier from product ID (last segment, e.g. "com.app.premium" → "premium")
    if (transaction.productId) {
      const segments = transaction.productId.split('.');
      normalized.planTier = segments[segments.length - 1];
    }

    // Trial start: if offerType === 1 (free trial), use purchaseDate
    if (transaction.offerType === 1 && transaction.purchaseDate) {
      normalized.trialStartedAt = new Date(transaction.purchaseDate);
    }

    return [normalized];
  }

  extractIdentityHints(payload: Record<string, unknown>): IdentityHint[] {
    const hints: IdentityHint[] = [];
    const transaction = (payload as any)?.transaction as DecodedTransaction | undefined;
    const notification = (payload as any)?.notification as DecodedNotification | undefined;

    if (transaction?.originalTransactionId) {
      hints.push({
        source: 'apple',
        idType: 'original_transaction_id',
        externalId: transaction.originalTransactionId,
      });
    }
    if (transaction?.appAccountToken) {
      hints.push({
        source: 'apple',
        idType: 'app_user_id',
        externalId: transaction.appAccountToken,
      });
    }
    if (transaction?.bundleId) {
      hints.push({
        source: 'apple',
        idType: 'bundle_id',
        externalId: transaction.bundleId,
        metadata: { productId: transaction.productId },
      });
    }

    return hints;
  }

  private async decodeNotification(signedPayload: string): Promise<DecodedNotification> {
    // In production: verify JWS signature chain against Apple root CA
    // For MVP: decode the JWT payload
    const decoded = jose.decodeJwt(signedPayload);
    return decoded as unknown as DecodedNotification;
  }

  private async decodeTransaction(signedTransaction: string): Promise<DecodedTransaction> {
    const decoded = jose.decodeJwt(signedTransaction);
    return decoded as unknown as DecodedTransaction;
  }

  private async decodeRenewalInfo(signedRenewalInfo: string): Promise<DecodedRenewalInfo> {
    const decoded = jose.decodeJwt(signedRenewalInfo);
    return decoded as unknown as DecodedRenewalInfo;
  }
}
