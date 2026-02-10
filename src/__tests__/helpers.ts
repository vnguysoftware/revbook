/**
 * Test helpers: mock factories, fixtures, and database mocks.
 *
 * All tests use in-memory mocks — no PostgreSQL or Redis required.
 */
import { vi } from 'vitest';
import type { BillingSource, EventType, EventStatus, EntitlementState, IssueSeverity } from '../models/types.js';
import * as jose from 'jose';

// ─── Mock Database ────────────────────────────────────────────────

/**
 * Creates a mock Drizzle database object with chainable query builder methods.
 * Each method returns the mock itself for chaining, and the terminal methods
 * (limit, returning, execute) resolve the configured result.
 */
export function createMockDb(overrides?: Record<string, any>) {
  const results: any[] = [];
  let insertedValues: any = null;

  const chainable: any = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    values: vi.fn().mockImplementation((vals: any) => {
      insertedValues = vals;
      return chainable;
    }),
    orderBy: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockImplementation(() => Promise.resolve(results)),
    offset: vi.fn().mockReturnThis(),
    returning: vi.fn().mockImplementation(() => Promise.resolve(results)),
    onConflictDoNothing: vi.fn().mockImplementation(() => Promise.resolve(results)),
    onConflictDoUpdate: vi.fn().mockImplementation(() => Promise.resolve(results)),
    catch: vi.fn().mockReturnThis(),
    then: vi.fn().mockImplementation((resolve: any) => resolve(results)),

    // Helpers for tests to configure results
    _setResults(r: any[]) {
      results.length = 0;
      results.push(...r);
    },
    _getInsertedValues() {
      return insertedValues;
    },
  };

  // Make chainable itself resolve as a promise (for queries without .limit()/.returning())
  chainable[Symbol.for('nodejs.util.inspect.custom')] = () => 'MockDb';

  return Object.assign(chainable, overrides);
}

/**
 * Creates a more structured mock database where you can configure
 * per-table per-operation responses.
 */
export function createConfigurableMockDb() {
  const responses = new Map<string, any[]>();

  function makeChain(key?: string): any {
    const chain: any = {};
    const methods = [
      'select', 'insert', 'update', 'delete', 'from', 'where',
      'set', 'values', 'orderBy', 'groupBy', 'offset',
      'onConflictDoNothing', 'onConflictDoUpdate', 'catch',
    ];

    for (const method of methods) {
      chain[method] = vi.fn().mockReturnValue(chain);
    }

    chain.limit = vi.fn().mockImplementation(() => {
      return Promise.resolve(key ? (responses.get(key) || []) : []);
    });
    chain.returning = vi.fn().mockImplementation(() => {
      return Promise.resolve(key ? (responses.get(key) || []) : []);
    });
    chain.then = vi.fn().mockImplementation((resolve: any) => {
      return resolve(key ? (responses.get(key) || []) : []);
    });

    return chain;
  }

  const db: any = makeChain();

  db._setResponse = (key: string, data: any[]) => {
    responses.set(key, data);
  };

  return db;
}

// ─── UUID Generator ───────────────────────────────────────────────

let uuidCounter = 0;
export function mockUuid(): string {
  uuidCounter++;
  return `00000000-0000-0000-0000-${String(uuidCounter).padStart(12, '0')}`;
}

export function resetUuidCounter() {
  uuidCounter = 0;
}

// ─── Factory Functions ────────────────────────────────────────────

export function createTestOrg(overrides?: Partial<any>) {
  return {
    id: mockUuid(),
    name: 'Test Org',
    slug: 'test-org',
    settings: {},
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

export function createTestUser(orgId: string, overrides?: Partial<any>) {
  return {
    id: mockUuid(),
    orgId,
    externalUserId: `ext_user_${uuidCounter}`,
    email: `user${uuidCounter}@test.com`,
    metadata: {},
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

export function createTestProduct(orgId: string, overrides?: Partial<any>) {
  return {
    id: mockUuid(),
    orgId,
    name: 'Premium Plan',
    externalIds: { stripe: 'prod_test123', apple: 'com.app.premium' },
    isActive: true,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

export function createTestEntitlement(
  orgId: string,
  userId: string,
  productId: string,
  overrides?: Partial<any>,
) {
  return {
    id: mockUuid(),
    orgId,
    userId,
    productId,
    source: 'stripe' as BillingSource,
    state: 'active' as EntitlementState,
    externalSubscriptionId: 'sub_test123',
    currentPeriodStart: new Date('2025-01-01T00:00:00Z'),
    currentPeriodEnd: new Date('2025-02-01T00:00:00Z'),
    cancelAt: null,
    trialEnd: null,
    billingInterval: null,
    planTier: null,
    lastEventId: null,
    stateHistory: [],
    metadata: {},
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

export function createTestCanonicalEvent(
  orgId: string,
  overrides?: Partial<any>,
) {
  return {
    id: mockUuid(),
    orgId,
    userId: null,
    productId: null,
    source: 'stripe' as BillingSource,
    eventType: 'renewal' as EventType,
    sourceEventType: 'invoice.payment_succeeded',
    eventTime: new Date('2025-01-15T12:00:00Z'),
    status: 'success' as EventStatus,
    amountCents: 1999,
    currency: 'USD',
    proceedsCents: null,
    externalEventId: 'evt_test123',
    externalSubscriptionId: 'sub_test123',
    originalTransactionId: null,
    subscriptionGroupId: null,
    periodType: 'normal',
    expirationTime: null,
    gracePeriodExpiration: null,
    cancellationReason: null,
    isFamilyShare: false,
    environment: 'production',
    countryCode: 'US',
    billingInterval: null,
    planTier: null,
    trialStartedAt: null,
    idempotencyKey: `stripe:evt_test_${uuidCounter}`,
    rawPayload: {},
    processedAt: new Date(),
    ingestedAt: new Date(),
    createdAt: new Date(),
    ...overrides,
  };
}

export function createTestIssue(orgId: string, overrides?: Partial<any>) {
  return {
    id: mockUuid(),
    orgId,
    userId: null,
    issueType: 'payment_without_entitlement',
    severity: 'critical' as IssueSeverity,
    status: 'open',
    title: 'Payment succeeded but entitlement is inactive',
    description: 'Test issue description',
    estimatedRevenueCents: 1999,
    confidence: 0.95,
    detectorId: 'payment_without_entitlement',
    evidence: {},
    resolvedAt: null,
    resolvedBy: null,
    resolution: null,
    createdAt: new Date('2025-01-15T12:00:00Z'),
    updatedAt: new Date('2025-01-15T12:00:00Z'),
    ...overrides,
  };
}

export function createTestBillingConnection(orgId: string, overrides?: Partial<any>) {
  return {
    id: mockUuid(),
    orgId,
    source: 'stripe' as BillingSource,
    credentials: { apiKey: 'sk_test_xxx' },
    webhookSecret: 'whsec_test',
    isActive: true,
    lastSyncAt: null,
    lastWebhookAt: new Date('2025-01-15T12:00:00Z'),
    syncStatus: 'active',
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

export function createTestApiKey(orgId: string, overrides?: Partial<any>) {
  return {
    id: mockUuid(),
    orgId,
    name: 'Test Key',
    keyHash: 'abc123hash',
    keyPrefix: 'rev_test',
    scopes: [],
    lastUsedAt: null,
    expiresAt: null,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

// ─── Stripe Webhook Fixtures ──────────────────────────────────────

export function createStripeInvoicePayload(overrides?: Partial<any>) {
  return {
    id: 'evt_stripe_invoice_001',
    object: 'event',
    type: 'invoice.payment_succeeded',
    created: Math.floor(new Date('2025-01-15T12:00:00Z').getTime() / 1000),
    data: {
      object: {
        id: 'in_test123',
        object: 'invoice',
        customer: 'cus_test123',
        customer_email: 'user@test.com',
        subscription: 'sub_test123',
        amount_paid: 1999,
        currency: 'usd',
        status: 'paid',
        lines: {
          data: [{
            price: {
              id: 'price_test123',
              product: 'prod_test123',
              unit_amount: 1999,
              currency: 'usd',
            },
          }],
        },
        metadata: {},
        ...overrides?.dataObject,
      },
      ...(overrides?.data || {}),
    },
    ...overrides,
  };
}

export function createStripeSubscriptionCreatedPayload(overrides?: Partial<any>) {
  return {
    id: 'evt_stripe_sub_created_001',
    object: 'event',
    type: 'customer.subscription.created',
    created: Math.floor(new Date('2025-01-15T12:00:00Z').getTime() / 1000),
    data: {
      object: {
        id: 'sub_test123',
        object: 'subscription',
        customer: 'cus_test123',
        status: 'active',
        items: {
          data: [{
            price: {
              id: 'price_test123',
              product: 'prod_test123',
              unit_amount: 1999,
              currency: 'usd',
            },
          }],
        },
        current_period_start: Math.floor(new Date('2025-01-15T00:00:00Z').getTime() / 1000),
        current_period_end: Math.floor(new Date('2025-02-15T00:00:00Z').getTime() / 1000),
        cancel_at_period_end: false,
        metadata: {},
      },
    },
    ...overrides,
  };
}

export function createStripeSubscriptionUpdatedPayload(overrides?: Partial<any>) {
  return {
    id: 'evt_stripe_sub_updated_001',
    object: 'event',
    type: 'customer.subscription.updated',
    created: Math.floor(new Date('2025-01-15T12:00:00Z').getTime() / 1000),
    data: {
      object: {
        id: 'sub_test123',
        object: 'subscription',
        customer: 'cus_test123',
        status: 'active',
        cancel_at_period_end: false,
        items: {
          data: [{
            price: {
              id: 'price_test123',
              product: 'prod_test123',
              unit_amount: 1999,
              currency: 'usd',
            },
          }],
        },
        current_period_start: Math.floor(new Date('2025-01-15T00:00:00Z').getTime() / 1000),
        current_period_end: Math.floor(new Date('2025-02-15T00:00:00Z').getTime() / 1000),
        currency: 'usd',
        metadata: {},
        ...overrides?.dataObject,
      },
      previous_attributes: overrides?.previousAttributes || {},
    },
    ...overrides,
  };
}

export function createStripeSubscriptionDeletedPayload(overrides?: Partial<any>) {
  return {
    id: 'evt_stripe_sub_deleted_001',
    object: 'event',
    type: 'customer.subscription.deleted',
    created: Math.floor(new Date('2025-01-15T12:00:00Z').getTime() / 1000),
    data: {
      object: {
        id: 'sub_test123',
        object: 'subscription',
        customer: 'cus_test123',
        status: 'canceled',
        items: {
          data: [{
            price: {
              id: 'price_test123',
              product: 'prod_test123',
              unit_amount: 1999,
              currency: 'usd',
            },
          }],
        },
        metadata: {},
      },
    },
    ...overrides,
  };
}

export function createStripeChargeRefundedPayload(overrides?: Partial<any>) {
  return {
    id: 'evt_stripe_refund_001',
    object: 'event',
    type: 'charge.refunded',
    created: Math.floor(new Date('2025-01-15T12:00:00Z').getTime() / 1000),
    data: {
      object: {
        id: 'ch_test123',
        object: 'charge',
        customer: 'cus_test123',
        amount: 1999,
        currency: 'usd',
        refunded: true,
        subscription: 'sub_test123',
        metadata: {},
      },
    },
    ...overrides,
  };
}

export function createStripeDisputePayload(overrides?: Partial<any>) {
  return {
    id: 'evt_stripe_dispute_001',
    object: 'event',
    type: 'charge.dispute.created',
    created: Math.floor(new Date('2025-01-15T12:00:00Z').getTime() / 1000),
    data: {
      object: {
        id: 'dp_test123',
        object: 'dispute',
        charge: 'ch_test123',
        amount: 1999,
        currency: 'usd',
        customer: 'cus_test123',
        subscription: 'sub_test123',
        metadata: {},
      },
    },
    ...overrides,
  };
}

// ─── Apple Notification Fixtures ──────────────────────────────────

/**
 * Creates a JWS-like token for Apple notifications.
 * Uses jose to create a properly formatted JWT that can be decoded.
 */
async function createJws(payload: Record<string, any>): Promise<string> {
  // Use a test key for JWS encoding
  const secret = new TextEncoder().encode('test-secret-key-for-apple-notifications-testing-only');
  const jwt = await new jose.SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .sign(secret);
  return jwt;
}

export async function createAppleNotificationPayload(
  notificationType: string,
  subtype: string | undefined,
  transactionOverrides?: Partial<any>,
  notificationOverrides?: Partial<any>,
) {
  const transaction = {
    transactionId: 'txn_apple_001',
    originalTransactionId: 'orig_txn_apple_001',
    productId: 'com.app.premium.monthly',
    bundleId: 'com.app.test',
    purchaseDate: new Date('2025-01-15T12:00:00Z').getTime(),
    expiresDate: new Date('2025-02-15T12:00:00Z').getTime(),
    type: 'Auto-Renewable',
    environment: 'Production',
    storefront: 'USA',
    price: 9990, // Apple sends in milliunits
    currency: 'USD',
    ...transactionOverrides,
  };

  const notification: any = {
    notificationType,
    subtype: subtype || undefined,
    data: {
      signedTransactionInfo: await createJws(transaction),
      environment: transaction.environment,
      bundleId: transaction.bundleId,
    },
    notificationUUID: `notif_apple_${notificationType}_${subtype || 'none'}`,
    version: '2.0',
    signedDate: new Date('2025-01-15T12:00:00Z').getTime(),
    ...notificationOverrides,
  };

  const signedPayload = await createJws(notification);

  return {
    signedPayload,
    // Expose for direct access in tests
    _notification: notification,
    _transaction: transaction,
  };
}

export function createRawWebhookEvent(
  source: BillingSource,
  body: string,
  headers?: Record<string, string>,
) {
  return {
    source,
    headers: headers || {},
    body,
    receivedAt: new Date(),
  };
}

// ─── Mock Logger ──────────────────────────────────────────────────

export function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
}
