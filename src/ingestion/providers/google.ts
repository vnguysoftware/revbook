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
import { CircuitBreaker } from '../../security/circuit-breaker.js';

const log = createChildLogger('google-normalizer');

// ─── Google Play Developer Notification Types ─────────────────────

/** Subscription notification type codes from Google Cloud Pub/Sub */
const SUBSCRIPTION_NOTIFICATION_MAP: Record<number, { eventType: EventType; status: EventStatus } | null> = {
  1:  { eventType: 'renewal', status: 'success' },          // RECOVERED
  2:  { eventType: 'renewal', status: 'success' },          // RENEWED
  3:  { eventType: 'cancellation', status: 'success' },     // CANCELED
  4:  { eventType: 'purchase', status: 'success' },         // PURCHASED
  5:  { eventType: 'billing_retry', status: 'failed' },     // ON_HOLD
  6:  { eventType: 'grace_period_start', status: 'pending' }, // IN_GRACE_PERIOD
  7:  { eventType: 'resume', status: 'success' },           // RESTARTED
  8:  { eventType: 'price_change', status: 'success' },     // PRICE_CHANGE_CONFIRMED
  9:  null,                                                   // DEFERRED (skip)
  10: { eventType: 'pause', status: 'success' },            // PAUSED
  11: null,                                                   // PAUSE_SCHEDULE_CHANGED (skip)
  12: { eventType: 'revoke', status: 'success' },           // REVOKED
  13: { eventType: 'expiration', status: 'success' },       // EXPIRED
};

/** Human-readable names for subscription notification types (for logging) */
const SUBSCRIPTION_NOTIFICATION_NAMES: Record<number, string> = {
  1: 'RECOVERED', 2: 'RENEWED', 3: 'CANCELED', 4: 'PURCHASED',
  5: 'ON_HOLD', 6: 'IN_GRACE_PERIOD', 7: 'RESTARTED',
  8: 'PRICE_CHANGE_CONFIRMED', 9: 'DEFERRED', 10: 'PAUSED',
  11: 'PAUSE_SCHEDULE_CHANGED', 12: 'REVOKED', 13: 'EXPIRED',
};

// ─── Pub/Sub Message Types ────────────────────────────────────────

interface PubSubPushMessage {
  message: {
    data: string; // base64-encoded DeveloperNotification JSON
    messageId: string;
    publishTime: string;
    attributes?: Record<string, string>;
  };
  subscription: string;
}

interface DeveloperNotification {
  version: string;
  packageName: string;
  eventTimeMillis: string;
  subscriptionNotification?: {
    version: string;
    notificationType: number;
    purchaseToken: string;
    subscriptionId: string;
  };
  voidedPurchaseNotification?: {
    purchaseToken: string;
    orderId: string;
    productType: number; // 1 = subscription, 2 = one-time
    refundType?: number; // 1 = full refund, 2 = quantity-based (one-time only)
  };
  oneTimeProductNotification?: {
    version: string;
    notificationType: number;
    purchaseToken: string;
    sku: string;
  };
  testNotification?: {
    version: string;
  };
}

// ─── Google Play Developer API Response Types ─────────────────────

interface SubscriptionPurchaseV2 {
  kind: string;
  regionCode: string;
  startTime: string;
  expiryTime: string;
  subscriptionState: string; // e.g. "SUBSCRIPTION_STATE_ACTIVE"
  linkedPurchaseToken?: string;
  acknowledgementState: string;
  externalAccountIdentifiers?: {
    externalAccountId?: string;
    obfuscatedExternalAccountId?: string;
    obfuscatedExternalProfileId?: string;
  };
  lineItems: Array<{
    productId: string;
    expiryTime: string;
    offerDetails?: {
      basePlanId?: string;
      offerId?: string;
    };
  }>;
  // Financial data (from monetization API)
  canceledStateContext?: {
    userInitiatedCancellation?: Record<string, unknown>;
    systemInitiatedCancellation?: Record<string, unknown>;
    developerInitiatedCancellation?: Record<string, unknown>;
    replacementCancellation?: Record<string, unknown>;
  };
}

// ─── Google API Auth ──────────────────────────────────────────────

interface GoogleCredentials {
  clientEmail: string;
  privateKey: string;
  packageName: string;
}

/** Circuit breaker for Google Play Developer API calls. */
const googleApiBreaker = new CircuitBreaker('google-play-api', {
  failureThreshold: 5,
  resetTimeoutMs: 60_000,
  halfOpenMaxAttempts: 3,
});

/** Google JWKS endpoint for Pub/Sub token verification */
const GOOGLE_JWKS_URI = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_PLAY_API_BASE = 'https://androidpublisher.googleapis.com/androidpublisher/v3';

export class GoogleNormalizer implements EventNormalizer {
  source: BillingSource = 'google';

  /** Per-org credentials injected before normalize() */
  private credentials: GoogleCredentials | null = null;

  /** Cached OAuth2 access token */
  private accessToken: string | null = null;
  private accessTokenExpiresAt: number = 0;

  /**
   * Inject per-org service account credentials.
   * Called by the pipeline before normalize() for Google events.
   */
  setCredentials(clientEmail: string, privateKey: string, packageName: string): void {
    this.credentials = { clientEmail, privateKey, packageName };
    // Invalidate cached token when credentials change
    this.accessToken = null;
    this.accessTokenExpiresAt = 0;
  }

  /**
   * Verify Google Cloud Pub/Sub push message OAuth2 bearer token.
   *
   * Google Pub/Sub push subscriptions send an OAuth2 bearer token in the
   * Authorization header. We verify by:
   * 1. Extracting JWT from Authorization: Bearer <token>
   * 2. Verifying against Google's public JWKS
   * 3. Checking `email` claim ends with `.gserviceaccount.com`
   * 4. Checking `aud` claim matches configured endpoint URL (webhookSecret)
   */
  async verifySignature(event: RawWebhookEvent, secret: string): Promise<boolean> {
    try {
      const authHeader = event.headers['authorization'] || event.headers['Authorization'];
      if (!authHeader) {
        log.warn('Google webhook missing Authorization header');
        return false;
      }

      if (!authHeader.startsWith('Bearer ')) {
        log.warn('Google webhook Authorization header is not Bearer token');
        return false;
      }

      const token = authHeader.slice(7);

      // Fetch Google's public JWKS and verify the JWT
      const JWKS = jose.createRemoteJWKSet(new URL(GOOGLE_JWKS_URI));
      const { payload } = await jose.jwtVerify(token, JWKS, {
        audience: secret, // webhookSecret stores the expected audience URL
      });

      // Verify the email claim is a Google service account
      const email = payload.email as string | undefined;
      if (!email || !email.endsWith('.gserviceaccount.com')) {
        log.warn({ email }, 'Google Pub/Sub token email is not a service account');
        return false;
      }

      return true;
    } catch (err) {
      log.warn({ err }, 'Google Pub/Sub token verification failed');
      return false;
    }
  }

  async normalize(orgId: string, event: RawWebhookEvent): Promise<NormalizedEvent[]> {
    const pubSubMessage = JSON.parse(event.body) as PubSubPushMessage;

    // Decode the Pub/Sub message data (base64 → JSON)
    const dataStr = Buffer.from(pubSubMessage.message.data, 'base64').toString('utf-8');
    const notification = JSON.parse(dataStr) as DeveloperNotification;

    // Skip test notifications
    if (notification.testNotification) {
      log.info('Received Google test notification, skipping');
      return [];
    }

    // Handle subscription notifications
    if (notification.subscriptionNotification) {
      return this.normalizeSubscriptionNotification(orgId, notification, pubSubMessage);
    }

    // Handle voided purchase notifications (refunds / chargebacks)
    if (notification.voidedPurchaseNotification) {
      return this.normalizeVoidedPurchaseNotification(orgId, notification, pubSubMessage);
    }

    // Handle one-time product notifications
    if (notification.oneTimeProductNotification) {
      return this.normalizeOneTimeProductNotification(orgId, notification, pubSubMessage);
    }

    log.debug('Google notification has no actionable notification type, skipping');
    return [];
  }

  extractIdentityHints(payload: Record<string, unknown>): IdentityHint[] {
    const hints: IdentityHint[] = [];

    const purchaseToken = payload.purchaseToken as string | undefined;
    if (purchaseToken) {
      hints.push({
        source: 'google',
        idType: 'purchase_token',
        externalId: purchaseToken,
      });
    }

    const appUserId = payload.obfuscatedExternalAccountId as string | undefined;
    if (appUserId) {
      hints.push({
        source: 'google',
        idType: 'app_user_id',
        externalId: appUserId,
      });
    }

    const linkedPurchaseToken = payload.linkedPurchaseToken as string | undefined;
    if (linkedPurchaseToken) {
      hints.push({
        source: 'google',
        idType: 'linked_purchase_token',
        externalId: linkedPurchaseToken,
      });
    }

    return hints;
  }

  // ─── Private Methods ──────────────────────────────────────────────

  private async normalizeSubscriptionNotification(
    orgId: string,
    notification: DeveloperNotification,
    pubSubMessage: PubSubPushMessage,
  ): Promise<NormalizedEvent[]> {
    const subNotif = notification.subscriptionNotification!;
    const notifType = subNotif.notificationType;

    const mapping = SUBSCRIPTION_NOTIFICATION_MAP[notifType];
    if (mapping === undefined) {
      log.warn({ notifType }, 'Unmapped Google subscription notification type');
      return [];
    }
    if (mapping === null) {
      log.debug({
        notifType,
        name: SUBSCRIPTION_NOTIFICATION_NAMES[notifType],
      }, 'Skipping non-actionable Google notification');
      return [];
    }

    // Try to enrich with full subscription details from Google Play API
    let subscriptionDetails: SubscriptionPurchaseV2 | null = null;
    if (this.credentials) {
      try {
        subscriptionDetails = await this.fetchSubscriptionDetails(
          notification.packageName,
          subNotif.purchaseToken,
        );
      } catch (err) {
        log.warn({ err, purchaseToken: subNotif.purchaseToken },
          'Failed to fetch Google subscription details — proceeding with limited data');
      }
    }

    // Build identity hints
    const identityPayload: Record<string, unknown> = {
      purchaseToken: subNotif.purchaseToken,
    };
    if (subscriptionDetails?.externalAccountIdentifiers?.obfuscatedExternalAccountId) {
      identityPayload.obfuscatedExternalAccountId =
        subscriptionDetails.externalAccountIdentifiers.obfuscatedExternalAccountId;
    }
    if (subscriptionDetails?.linkedPurchaseToken) {
      identityPayload.linkedPurchaseToken = subscriptionDetails.linkedPurchaseToken;
    }

    const identityHints = this.extractIdentityHints(identityPayload);

    const eventTimeMs = parseInt(notification.eventTimeMillis, 10);
    const externalEventId = `google:${pubSubMessage.message.messageId}`;

    const normalized: NormalizedEvent = {
      orgId,
      source: 'google',
      eventType: mapping.eventType,
      eventTime: new Date(eventTimeMs),
      status: mapping.status,
      externalEventId,
      externalSubscriptionId: subNotif.purchaseToken,
      idempotencyKey: `google:${pubSubMessage.message.messageId}`,
      rawPayload: {
        notification: notification as unknown as Record<string, unknown>,
        subscriptionDetails: subscriptionDetails as unknown as Record<string, unknown>,
        productId: subscriptionDetails?.lineItems?.[0]?.productId || subNotif.subscriptionId,
      },
      identityHints,
    };

    // Enrich with financials and plan metadata from API response
    if (subscriptionDetails) {
      this.enrichWithSubscriptionDetails(normalized, subscriptionDetails, subNotif.subscriptionId);
    } else {
      // Basic plan metadata from notification alone
      normalized.planTier = subNotif.subscriptionId;
    }

    return [normalized];
  }

  private async normalizeVoidedPurchaseNotification(
    orgId: string,
    notification: DeveloperNotification,
    pubSubMessage: PubSubPushMessage,
  ): Promise<NormalizedEvent[]> {
    const voided = notification.voidedPurchaseNotification!;
    const eventTimeMs = parseInt(notification.eventTimeMillis, 10);

    // refundType: 1 = full refund, everything else = chargeback
    const isRefund = voided.refundType === 1;

    const identityHints = this.extractIdentityHints({
      purchaseToken: voided.purchaseToken,
    });

    const normalized: NormalizedEvent = {
      orgId,
      source: 'google',
      eventType: isRefund ? 'refund' : 'chargeback',
      eventTime: new Date(eventTimeMs),
      status: 'refunded',
      externalEventId: `google:voided:${voided.orderId}`,
      externalSubscriptionId: voided.purchaseToken,
      idempotencyKey: `google:voided:${voided.orderId}`,
      rawPayload: {
        notification: notification as unknown as Record<string, unknown>,
      },
      identityHints,
    };

    return [normalized];
  }

  private normalizeOneTimeProductNotification(
    orgId: string,
    notification: DeveloperNotification,
    pubSubMessage: PubSubPushMessage,
  ): NormalizedEvent[] {
    const oneTime = notification.oneTimeProductNotification!;
    const eventTimeMs = parseInt(notification.eventTimeMillis, 10);

    // One-time product notification types:
    // 1 = ONE_TIME_PRODUCT_PURCHASED, 2 = ONE_TIME_PRODUCT_CANCELED
    let eventType: EventType;
    let status: EventStatus;

    if (oneTime.notificationType === 1) {
      eventType = 'purchase';
      status = 'success';
    } else if (oneTime.notificationType === 2) {
      eventType = 'cancellation';
      status = 'success';
    } else {
      log.debug({ notificationType: oneTime.notificationType }, 'Unknown one-time product notification type');
      return [];
    }

    const identityHints = this.extractIdentityHints({
      purchaseToken: oneTime.purchaseToken,
    });

    const normalized: NormalizedEvent = {
      orgId,
      source: 'google',
      eventType,
      eventTime: new Date(eventTimeMs),
      status,
      externalEventId: `google:onetime:${pubSubMessage.message.messageId}`,
      externalSubscriptionId: oneTime.purchaseToken,
      idempotencyKey: `google:onetime:${pubSubMessage.message.messageId}`,
      rawPayload: {
        notification: notification as unknown as Record<string, unknown>,
        productId: oneTime.sku,
      },
      identityHints,
      planTier: oneTime.sku,
    };

    return [normalized];
  }

  private enrichWithSubscriptionDetails(
    event: NormalizedEvent,
    details: SubscriptionPurchaseV2,
    subscriptionId: string,
  ): void {
    // Product / plan info from lineItems
    const lineItem = details.lineItems?.[0];
    if (lineItem) {
      event.planTier = lineItem.productId;

      if (lineItem.offerDetails?.basePlanId) {
        // Use basePlanId to infer billing interval
        const basePlan = lineItem.offerDetails.basePlanId.toLowerCase();
        if (basePlan.includes('month')) {
          event.billingInterval = 'month';
        } else if (basePlan.includes('year') || basePlan.includes('annual')) {
          event.billingInterval = 'year';
        } else if (basePlan.includes('week')) {
          event.billingInterval = 'week';
        }
      }
    }

    // Region code
    if (details.regionCode) {
      (event.rawPayload as any).regionCode = details.regionCode;
    }
  }

  // ─── Google Play Developer API ────────────────────────────────────

  /**
   * Fetch full subscription details from Google Play Developer API.
   * Uses purchases.subscriptionsv2.get endpoint.
   */
  private async fetchSubscriptionDetails(
    packageName: string,
    purchaseToken: string,
  ): Promise<SubscriptionPurchaseV2> {
    const accessToken = await this.getAccessToken();
    const url = `${GOOGLE_PLAY_API_BASE}/applications/${packageName}/purchases/subscriptionsv2/tokens/${purchaseToken}`;

    return googleApiBreaker.execute(async () => {
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`Google Play API error ${response.status}: ${body}`);
      }

      return response.json() as Promise<SubscriptionPurchaseV2>;
    });
  }

  /**
   * Get an OAuth2 access token for the Google Play Developer API.
   * Uses service account JWT to exchange for access token.
   * Caches the token until 5 minutes before expiry.
   */
  private async getAccessToken(): Promise<string> {
    if (!this.credentials) {
      throw new Error('Google service account credentials not configured');
    }

    // Return cached token if still valid (with 5 min buffer)
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt - 300_000) {
      return this.accessToken;
    }

    // Generate JWT for service account auth
    const now = Math.floor(Date.now() / 1000);
    const privateKey = await jose.importPKCS8(this.credentials.privateKey, 'RS256');

    const jwt = await new jose.SignJWT({
      iss: this.credentials.clientEmail,
      sub: this.credentials.clientEmail,
      aud: GOOGLE_TOKEN_URL,
      iat: now,
      exp: now + 3600,
      scope: 'https://www.googleapis.com/auth/androidpublisher',
    })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .sign(privateKey);

    // Exchange JWT for access token
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Google OAuth2 token exchange failed ${response.status}: ${body}`);
    }

    const tokenData = await response.json() as { access_token: string; expires_in: number };
    this.accessToken = tokenData.access_token;
    this.accessTokenExpiresAt = Date.now() + tokenData.expires_in * 1000;

    return this.accessToken;
  }
}
