/**
 * Seed script for RevBack demo data.
 *
 * Generates realistic billing data for "Acme Fitness" -- a fitness app company
 * with Stripe + Apple App Store billing. Designed to showcase the platform's
 * issue detection capabilities during demos and first-customer onboarding.
 *
 * Run: npx tsx scripts/seed.ts
 *
 * Idempotent: drops existing seed data (org slug = "acme-fitness") before inserting.
 */

import 'dotenv/config';
import crypto from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import * as schema from '../src/models/schema.js';

// ─── Database connection (standalone, not using getDb to avoid env validation) ──

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL environment variable is required');
  process.exit(1);
}

const client = postgres(databaseUrl, { max: 5 });
const db = drizzle(client, { schema });

// ─── Helpers ─────────────────────────────────────────────────────────

const uuid = () => crypto.randomUUID();

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function weightedChoice<T>(items: T[], weights: number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function hoursAgo(hours: number): Date {
  const d = new Date();
  d.setHours(d.getHours() - hours);
  return d;
}

function minutesAgo(minutes: number): Date {
  const d = new Date();
  d.setMinutes(d.getMinutes() - minutes);
  return d;
}

function randomDateBetween(start: Date, end: Date): Date {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** Generate a Stripe-like customer ID */
function stripeCusId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id = 'cus_';
  for (let i = 0; i < 14; i++) id += chars[randomInt(0, chars.length - 1)];
  return id;
}

/** Generate an Apple-like numeric original transaction ID */
function appleTransactionId(): string {
  return String(randomInt(1000000000000, 9999999999999));
}

/** Generate a Stripe subscription ID */
function stripeSubId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id = 'sub_';
  for (let i = 0; i < 14; i++) id += chars[randomInt(0, chars.length - 1)];
  return id;
}

/** Generate a Stripe event ID */
function stripeEventId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id = 'evt_';
  for (let i = 0; i < 14; i++) id += chars[randomInt(0, chars.length - 1)];
  return id;
}

const FIRST_NAMES = [
  'James', 'Mary', 'John', 'Patricia', 'Robert', 'Jennifer', 'Michael', 'Linda',
  'William', 'Elizabeth', 'David', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica',
  'Thomas', 'Sarah', 'Charles', 'Karen', 'Christopher', 'Lisa', 'Daniel', 'Nancy',
  'Matthew', 'Betty', 'Anthony', 'Margaret', 'Mark', 'Sandra', 'Donald', 'Ashley',
  'Steven', 'Kimberly', 'Paul', 'Emily', 'Andrew', 'Donna', 'Joshua', 'Michelle',
  'Kenneth', 'Dorothy', 'Kevin', 'Carol', 'Brian', 'Amanda', 'George', 'Melissa',
  'Timothy', 'Deborah', 'Alex', 'Olivia', 'Emma', 'Sophia', 'Liam', 'Noah',
  'Ava', 'Isabella', 'Mia', 'Charlotte', 'Amelia', 'Harper', 'Evelyn', 'Abigail',
];

const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
  'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson',
  'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson',
  'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker',
  'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill',
  'Flores', 'Green', 'Adams', 'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell',
  'Mitchell', 'Carter', 'Roberts', 'Chen', 'Kim', 'Patel', 'Sharma', 'Singh',
];

const EMAIL_DOMAINS = ['gmail.com', 'yahoo.com', 'outlook.com', 'icloud.com', 'hotmail.com', 'protonmail.com'];

function randomEmail(first: string, last: string): string {
  const sep = randomChoice(['.', '_', '']);
  const suffix = randomInt(1, 999);
  return `${first.toLowerCase()}${sep}${last.toLowerCase()}${suffix}@${randomChoice(EMAIL_DOMAINS)}`;
}

// ─── Constants ───────────────────────────────────────────────────────

const NOW = new Date();
const SIX_MONTHS_AGO = daysAgo(180);
const ORG_ID = uuid();
const SEED_ORG_SLUG = 'acme-fitness';

// ─── Product Definitions ─────────────────────────────────────────────

interface ProductDef {
  id: string;
  name: string;
  amountCents: number;
  periodMonths: number;
  stripeProductId: string;
  appleProductId: string | null;
  stripePriceId: string;
}

const PRODUCTS: ProductDef[] = [
  {
    id: uuid(), name: 'Basic Monthly',
    amountCents: 999, periodMonths: 1,
    stripeProductId: 'prod_BasicMonth01', appleProductId: 'com.acmefitness.basic.monthly',
    stripePriceId: 'price_BasicMonth01',
  },
  {
    id: uuid(), name: 'Basic Annual',
    amountCents: 7999, periodMonths: 12,
    stripeProductId: 'prod_BasicYear01', appleProductId: 'com.acmefitness.basic.annual',
    stripePriceId: 'price_BasicYear01',
  },
  {
    id: uuid(), name: 'Premium Monthly',
    amountCents: 1999, periodMonths: 1,
    stripeProductId: 'prod_PremMonth01', appleProductId: 'com.acmefitness.premium.monthly',
    stripePriceId: 'price_PremMonth01',
  },
  {
    id: uuid(), name: 'Premium Annual',
    amountCents: 15999, periodMonths: 12,
    stripeProductId: 'prod_PremYear01', appleProductId: 'com.acmefitness.premium.annual',
    stripePriceId: 'price_PremYear01',
  },
  {
    id: uuid(), name: 'Family Monthly',
    amountCents: 2999, periodMonths: 1,
    stripeProductId: 'prod_FamMonth01', appleProductId: 'com.acmefitness.family.monthly',
    stripePriceId: 'price_FamMonth01',
  },
  {
    id: uuid(), name: 'Family Annual',
    amountCents: 24999, periodMonths: 12,
    stripeProductId: 'prod_FamYear01', appleProductId: 'com.acmefitness.family.annual',
    stripePriceId: 'price_FamYear01',
  },
  {
    id: uuid(), name: 'Pro Monthly',
    amountCents: 3999, periodMonths: 1,
    stripeProductId: 'prod_ProMonth01', appleProductId: 'com.acmefitness.pro.monthly',
    stripePriceId: 'price_ProMonth01',
  },
  {
    id: uuid(), name: 'Pro Annual',
    amountCents: 34999, periodMonths: 12,
    stripeProductId: 'prod_ProYear01', appleProductId: null,
    stripePriceId: 'price_ProYear01',
  },
  {
    id: uuid(), name: 'Student Monthly',
    amountCents: 499, periodMonths: 1,
    stripeProductId: 'prod_StudMonth01', appleProductId: 'com.acmefitness.student.monthly',
    stripePriceId: 'price_StudMonth01',
  },
  {
    id: uuid(), name: 'Lite Weekly',
    amountCents: 299, periodMonths: 1,
    stripeProductId: 'prod_LiteWeek01', appleProductId: null,
    stripePriceId: 'price_LiteWeek01',
  },
];

// ─── Main Seed Function ─────────────────────────────────────────────

async function seed() {
  console.log('--- RevBack Demo Seed Script ---');
  console.log(`Target org: ${SEED_ORG_SLUG} (id: ${ORG_ID})\n`);

  // ── 0. Cleanup existing seed data ──────────────────────────────────
  console.log('[0/9] Cleaning up existing seed data...');
  const existing = await db
    .select({ id: schema.organizations.id })
    .from(schema.organizations)
    .where(eq(schema.organizations.slug, SEED_ORG_SLUG));

  if (existing.length > 0) {
    const oldOrgId = existing[0].id;
    console.log(`  Found existing org ${oldOrgId}, deleting cascade...`);
    // Delete in FK-safe order
    await db.delete(schema.webhookLogs).where(eq(schema.webhookLogs.orgId, oldOrgId));
    await db.delete(schema.issues).where(eq(schema.issues.orgId, oldOrgId));
    await db.delete(schema.entitlements).where(eq(schema.entitlements.orgId, oldOrgId));
    await db.delete(schema.canonicalEvents).where(eq(schema.canonicalEvents.orgId, oldOrgId));
    await db.delete(schema.userIdentities).where(eq(schema.userIdentities.orgId, oldOrgId));
    await db.delete(schema.accessChecks).where(eq(schema.accessChecks.orgId, oldOrgId));
    await db.delete(schema.users).where(eq(schema.users.orgId, oldOrgId));
    await db.delete(schema.products).where(eq(schema.products.orgId, oldOrgId));
    await db.delete(schema.billingConnections).where(eq(schema.billingConnections.orgId, oldOrgId));
    await db.delete(schema.apiKeys).where(eq(schema.apiKeys.orgId, oldOrgId));
    await db.delete(schema.organizations).where(eq(schema.organizations.id, oldOrgId));
    console.log('  Cleanup complete.');
  }

  // ── 1. Organization ────────────────────────────────────────────────
  console.log('[1/9] Creating organization...');
  await db.insert(schema.organizations).values({
    id: ORG_ID,
    name: 'Acme Fitness',
    slug: SEED_ORG_SLUG,
    settings: {
      timezone: 'America/Los_Angeles',
      webhookUrl: 'https://api.acmefitness.com/webhooks',
      alertEmail: 'billing@acmefitness.com',
    },
  });
  console.log('  Created org: Acme Fitness');

  // ── 2. API Keys ────────────────────────────────────────────────────
  console.log('[2/9] Creating API keys...');
  const activeKeyId = uuid();
  const expiredKeyId = uuid();
  await db.insert(schema.apiKeys).values([
    {
      id: activeKeyId,
      orgId: ORG_ID,
      name: 'Production API Key',
      keyHash: crypto.createHash('sha256').update('rev_live_acme_prod_key_demo_2024').digest('hex'),
      keyPrefix: 'rev_live',
      scopes: ['*'],
      lastUsedAt: minutesAgo(3),
      expiresAt: null,
    },
    {
      id: expiredKeyId,
      orgId: ORG_ID,
      name: 'Old Staging Key (expired)',
      keyHash: crypto.createHash('sha256').update('rev_test_acme_staging_key_old').digest('hex'),
      keyPrefix: 'rev_test',
      scopes: ['events:read', 'issues:read'],
      lastUsedAt: daysAgo(45),
      expiresAt: daysAgo(30),
    },
  ]);
  console.log('  Created 2 API keys (1 active, 1 expired)');

  // ── 3. Billing Connections ─────────────────────────────────────────
  console.log('[3/9] Creating billing connections...');
  await db.insert(schema.billingConnections).values([
    {
      id: uuid(),
      orgId: ORG_ID,
      source: 'stripe',
      credentials: { accountId: 'acct_1AcmeFitness', mode: 'live' },
      webhookSecret: 'whsec_demo_stripe_secret',
      isActive: true,
      lastSyncAt: minutesAgo(2),
      lastWebhookAt: minutesAgo(5), // healthy: 5 min ago
      syncStatus: 'synced',
    },
    {
      id: uuid(),
      orgId: ORG_ID,
      source: 'apple',
      credentials: { bundleId: 'com.acmefitness.app', keyId: 'DEMO_KEY_01' },
      webhookSecret: null,
      isActive: true,
      lastSyncAt: hoursAgo(1),
      lastWebhookAt: hoursAgo(2), // stale: 2 hours ago (triggers webhook gap detector)
      syncStatus: 'synced',
    },
  ]);
  console.log('  Created 2 billing connections (Stripe + Apple)');

  // ── 4. Products ────────────────────────────────────────────────────
  console.log('[4/9] Creating products...');
  await db.insert(schema.products).values(
    PRODUCTS.map((p) => ({
      id: p.id,
      orgId: ORG_ID,
      name: p.name,
      externalIds: {
        ...(p.stripeProductId ? { stripe: p.stripeProductId, stripePriceId: p.stripePriceId } : {}),
        ...(p.appleProductId ? { apple: p.appleProductId } : {}),
      },
      isActive: true,
    }))
  );
  console.log(`  Created ${PRODUCTS.length} products`);

  // ── 5. Users + Identities ──────────────────────────────────────────
  console.log('[5/9] Creating users and identities...');
  const USER_COUNT = 500;

  interface UserRecord {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    stripeCustomerId: string | null;
    appleTransactionId: string | null;
    createdAt: Date;
  }

  const userRecords: UserRecord[] = [];
  const userRows: Array<{
    id: string;
    orgId: string;
    externalUserId: string | null;
    email: string | null;
    metadata: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
  }> = [];
  const identityRows: Array<{
    id: string;
    userId: string;
    orgId: string;
    source: 'stripe' | 'apple';
    externalId: string;
    idType: string;
    metadata: Record<string, unknown>;
    createdAt: Date;
  }> = [];

  for (let i = 0; i < USER_COUNT; i++) {
    const userId = uuid();
    const firstName = randomChoice(FIRST_NAMES);
    const lastName = randomChoice(LAST_NAMES);
    const email = randomEmail(firstName, lastName);
    const createdAt = randomDateBetween(SIX_MONTHS_AGO, daysAgo(7));

    // Identity distribution:
    //   0-249:   both Stripe + Apple (250 users with both)
    //   250-399: Stripe only         (150 users, total Stripe = 400)
    //   400-499: Apple only          (100 users, total Apple  = 350)
    const hasStripeId = i < 400;   // indices 0-399 = 400 users
    const hasAppleId = i < 250 || i >= 400; // indices 0-249 + 400-499 = 350 users
    // Both: 0-249 = 250 users

    const sId = hasStripeId ? stripeCusId() : null;
    const aId = hasAppleId ? appleTransactionId() : null;

    userRecords.push({
      id: userId,
      email,
      firstName,
      lastName,
      stripeCustomerId: sId,
      appleTransactionId: aId,
      createdAt,
    });

    userRows.push({
      id: userId,
      orgId: ORG_ID,
      externalUserId: sId ?? aId ?? null,
      email,
      metadata: { firstName, lastName, signupSource: hasStripeId ? 'web' : 'ios' },
      createdAt,
      updatedAt: createdAt,
    });

    if (sId) {
      identityRows.push({
        id: uuid(),
        userId,
        orgId: ORG_ID,
        source: 'stripe',
        externalId: sId,
        idType: 'customer_id',
        metadata: {},
        createdAt,
      });
    }

    if (aId) {
      identityRows.push({
        id: uuid(),
        userId,
        orgId: ORG_ID,
        source: 'apple',
        externalId: aId,
        idType: 'original_transaction_id',
        metadata: {},
        createdAt,
      });
    }

    // ~100 users also have an email identity
    if (i < 100) {
      identityRows.push({
        id: uuid(),
        userId,
        orgId: ORG_ID,
        source: 'stripe',
        externalId: email,
        idType: 'email',
        metadata: {},
        createdAt,
      });
    }
  }

  // Insert in batches (postgres has parameter limits)
  const BATCH = 100;
  for (let i = 0; i < userRows.length; i += BATCH) {
    await db.insert(schema.users).values(userRows.slice(i, i + BATCH));
  }
  for (let i = 0; i < identityRows.length; i += BATCH) {
    await db.insert(schema.userIdentities).values(identityRows.slice(i, i + BATCH));
  }
  console.log(`  Created ${USER_COUNT} users with ${identityRows.length} identity mappings`);

  // ── 6. Canonical Events ────────────────────────────────────────────
  console.log('[6/9] Creating canonical events...');

  type EventType = typeof schema.eventTypeEnum.enumValues[number];
  type EventStatus = typeof schema.eventStatusEnum.enumValues[number];
  type BillingSource = 'stripe' | 'apple';

  // Event type distribution weights
  const EVENT_TYPES: EventType[] = [
    'renewal', 'purchase', 'cancellation', 'refund', 'billing_retry',
    'trial_start', 'trial_conversion', 'expiration', 'upgrade', 'downgrade',
    'grace_period_start', 'grace_period_end',
  ];
  const EVENT_WEIGHTS = [
    60, // renewal
    15, // purchase
    10, // cancellation
    5,  // refund
    3,  // billing_retry
    2,  // trial_start
    1,  // trial_conversion
    1,  // expiration
    1,  // upgrade
    1,  // downgrade
    0.5, // grace_period_start
    0.5, // grace_period_end
  ];

  const CURRENCIES = ['USD', 'USD', 'USD', 'USD', 'USD', 'USD', 'USD', 'EUR', 'GBP'];
  const COUNTRIES = ['US', 'US', 'US', 'US', 'US', 'CA', 'GB', 'DE', 'FR', 'AU', 'JP'];

  const eventRows: Array<Record<string, unknown>> = [];
  const EVENT_COUNT = 5000;

  // Map to track subscription IDs per user for chronological consistency
  const userSubMap = new Map<string, { subId: string; source: BillingSource; product: ProductDef; startDate: Date }>();

  // Pre-assign subscriptions to users
  for (const user of userRecords) {
    const product = randomChoice(PRODUCTS);
    const source: BillingSource = user.stripeCustomerId ? 'stripe' : 'apple';
    const subId = source === 'stripe' ? stripeSubId() : appleTransactionId();
    userSubMap.set(user.id, {
      subId,
      source,
      product,
      startDate: user.createdAt,
    });
  }

  // Generate events
  for (let i = 0; i < EVENT_COUNT; i++) {
    const user = randomChoice(userRecords);
    const sub = userSubMap.get(user.id)!;
    const eventType = weightedChoice(EVENT_TYPES, EVENT_WEIGHTS);
    const eventTime = randomDateBetween(sub.startDate, NOW);
    const source = sub.source;
    const product = sub.product;
    const currency = randomChoice(CURRENCIES);

    let status: EventStatus = 'success';
    let amountCents = product.amountCents;
    let proceedsCents = source === 'apple' ? Math.round(amountCents * 0.7) : Math.round(amountCents * 0.971);

    // Adjust by event type
    if (eventType === 'refund') {
      status = 'refunded';
      amountCents = -amountCents;
      proceedsCents = -proceedsCents;
    } else if (eventType === 'billing_retry') {
      status = randomChoice(['success', 'failed', 'failed']);
    } else if (eventType === 'cancellation' || eventType === 'expiration') {
      amountCents = 0;
      proceedsCents = 0;
    } else if (eventType === 'trial_start') {
      amountCents = 0;
      proceedsCents = 0;
    }

    const externalEventId = source === 'stripe' ? stripeEventId() : uuid();
    const expirationTime = addMonths(eventTime, product.periodMonths);

    const sourceEventTypeMap: Record<string, string> = {
      purchase: source === 'stripe' ? 'customer.subscription.created' : 'SUBSCRIBED:INITIAL_BUY',
      renewal: source === 'stripe' ? 'invoice.payment_succeeded' : 'DID_RENEW',
      cancellation: source === 'stripe' ? 'customer.subscription.deleted' : 'DID_CHANGE_RENEWAL_STATUS',
      refund: source === 'stripe' ? 'charge.refunded' : 'REFUND',
      billing_retry: source === 'stripe' ? 'invoice.payment_failed' : 'DID_FAIL_TO_RENEW',
      trial_start: source === 'stripe' ? 'customer.subscription.trial_will_end' : 'OFFER_REDEEMED',
      trial_conversion: source === 'stripe' ? 'invoice.payment_succeeded' : 'DID_RENEW',
      expiration: source === 'stripe' ? 'customer.subscription.updated' : 'EXPIRED',
      upgrade: source === 'stripe' ? 'customer.subscription.updated' : 'DID_CHANGE_RENEWAL_PREF',
      downgrade: source === 'stripe' ? 'customer.subscription.updated' : 'DID_CHANGE_RENEWAL_PREF',
      grace_period_start: source === 'stripe' ? 'customer.subscription.updated' : 'GRACE_PERIOD_EXPIRES',
      grace_period_end: source === 'stripe' ? 'customer.subscription.updated' : 'EXPIRED',
    };

    eventRows.push({
      id: uuid(),
      orgId: ORG_ID,
      userId: user.id,
      productId: product.id,
      source,
      eventType,
      sourceEventType: sourceEventTypeMap[eventType] ?? eventType,
      eventTime,
      status,
      amountCents: Math.abs(amountCents) > 0 ? amountCents : null,
      currency,
      proceedsCents: Math.abs(proceedsCents) > 0 ? proceedsCents : null,
      externalEventId,
      externalSubscriptionId: sub.subId,
      originalTransactionId: source === 'apple' ? (user.appleTransactionId ?? null) : null,
      subscriptionGroupId: source === 'apple' ? 'com.acmefitness.subscriptions' : null,
      periodType: eventType === 'trial_start' ? 'trial' : 'normal',
      expirationTime,
      gracePeriodExpiration: eventType === 'grace_period_start' ? addDays(eventTime, 16) : null,
      cancellationReason: eventType === 'cancellation'
        ? randomChoice(['voluntary', 'billing_failure', 'price_increase'])
        : null,
      isFamilyShare: product.name.includes('Family') && source === 'apple',
      environment: 'production',
      countryCode: randomChoice(COUNTRIES),
      idempotencyKey: `${source}_${externalEventId}_${i}`,
      rawPayload: {
        _seed: true,
        source,
        type: sourceEventTypeMap[eventType] ?? eventType,
        id: externalEventId,
      },
      processedAt: new Date(eventTime.getTime() + randomInt(100, 5000)),
      ingestedAt: new Date(eventTime.getTime() + randomInt(50, 2000)),
    });
  }

  // Sort events by time for consistent insertion
  eventRows.sort((a, b) => (a.eventTime as Date).getTime() - (b.eventTime as Date).getTime());

  for (let i = 0; i < eventRows.length; i += BATCH) {
    await db.insert(schema.canonicalEvents).values(eventRows.slice(i, i + BATCH) as any);
  }
  console.log(`  Created ${EVENT_COUNT} canonical events`);

  // ── 7. Entitlements ────────────────────────────────────────────────
  console.log('[7/9] Creating entitlements...');

  type EntitlementState = typeof schema.entitlementStateEnum.enumValues[number];

  // State distribution: ~70% active, ~10% expired, ~5% trial, ~5% grace_period, ~3% billing_retry, ~7% other
  const STATES: EntitlementState[] = [
    'active', 'expired', 'trial', 'grace_period', 'billing_retry',
    'inactive', 'past_due', 'paused', 'revoked', 'refunded',
  ];
  const STATE_WEIGHTS = [70, 10, 5, 5, 3, 2, 2, 1, 1, 1];

  const entitlementRows: Array<Record<string, unknown>> = [];

  // Track which user+product+source combos we've used (unique constraint)
  const entitlementKeys = new Set<string>();

  // We'll create one entitlement per user
  for (const user of userRecords) {
    const sub = userSubMap.get(user.id)!;
    const state = weightedChoice(STATES, STATE_WEIGHTS);
    const product = sub.product;
    const source = sub.source;

    const key = `${user.id}_${product.id}_${source}`;
    if (entitlementKeys.has(key)) continue;
    entitlementKeys.add(key);

    const periodStart = daysAgo(randomInt(1, 30));
    const periodEnd = addMonths(periodStart, product.periodMonths);

    // Find the last event for this user to reference
    const userEvents = eventRows.filter((e) => e.userId === user.id);
    const lastEvent = userEvents.length > 0 ? userEvents[userEvents.length - 1] : null;

    entitlementRows.push({
      id: uuid(),
      orgId: ORG_ID,
      userId: user.id,
      productId: product.id,
      source,
      state,
      externalSubscriptionId: sub.subId,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      cancelAt: state === 'expired' ? daysAgo(randomInt(1, 14)) : null,
      trialEnd: state === 'trial' ? addDays(NOW, randomInt(1, 14)) : null,
      lastEventId: lastEvent ? (lastEvent.id as string) : null,
      stateHistory: [
        { from: 'inactive', to: state, at: user.createdAt.toISOString(), reason: 'seed' },
      ],
      metadata: {},
    });
  }

  for (let i = 0; i < entitlementRows.length; i += BATCH) {
    await db.insert(schema.entitlements).values(entitlementRows.slice(i, i + BATCH) as any);
  }
  console.log(`  Created ${entitlementRows.length} entitlements`);

  // ── 8. Issues (the "aha moment") ───────────────────────────────────
  console.log('[8/9] Creating issues...');

  // Helper to pick N random users that match a condition
  function pickUsers(
    condition: (u: UserRecord) => boolean,
    count: number,
    usedIds: Set<string>,
  ): UserRecord[] {
    const eligible = userRecords.filter((u) => condition(u) && !usedIds.has(u.id));
    const shuffled = [...eligible].sort(() => Math.random() - 0.5);
    const picked = shuffled.slice(0, count);
    picked.forEach((u) => usedIds.add(u.id));
    return picked;
  }

  const issueRows: Array<Record<string, unknown>> = [];
  const usedIssueUserIds = new Set<string>();

  // --- Revenue impact budget ---
  // Per-user issues use the subscription's monthly price (annual / 12 for annual plans)
  // Aggregate issues (webhook gap) use a total estimated impact of $1,000-$3,000
  // Target total across all ~36 issues: $2,000-$8,000

  // 8a. payment_without_entitlement: 8 issues, P0 critical
  // Payment succeeded but entitlement state didn't transition to active
  const paidNoAccessUsers = pickUsers(
    (u) => u.stripeCustomerId !== null,
    8,
    usedIssueUserIds,
  );
  for (const user of paidNoAccessUsers) {
    const sub = userSubMap.get(user.id)!;
    const product = sub.product;
    // Revenue impact: full subscription price per month (realistic consumer pricing)
    const impactCents = product.periodMonths === 12
      ? Math.round(product.amountCents / 12)
      : product.amountCents;

    issueRows.push({
      id: uuid(),
      orgId: ORG_ID,
      userId: user.id,
      issueType: 'payment_without_entitlement',
      severity: 'critical',
      status: 'open',
      title: `Payment succeeded but entitlement is inactive for ${user.firstName} ${user.lastName}`,
      description: `Payment of $${(impactCents / 100).toFixed(2)}/mo for ${product.name} via ${sub.source} succeeded but your app did not grant the user access. Last payment was ${randomInt(1, 5)} days ago. This usually means the payment webhook was received but your server didn't update the user's access rights.`,
      estimatedRevenueCents: impactCents,
      confidence: +(0.9 + Math.random() * 0.1).toFixed(2),
      detectorId: 'payment_without_entitlement',
      evidence: {
        userId: user.id,
        subscriptionId: sub.subId,
        productId: product.id,
        source: sub.source,
        lastPaymentAmount: impactCents,
        lastPaymentDate: daysAgo(randomInt(1, 5)).toISOString(),
        entitlementState: 'inactive',
        expectedState: 'active',
      },
      createdAt: daysAgo(randomInt(0, 7)),
      updatedAt: daysAgo(randomInt(0, 2)),
    });
  }

  // 8b. refund_not_revoked: 4 issues, P0 critical
  const refundActiveUsers = pickUsers(
    (u) => u.stripeCustomerId !== null,
    4,
    usedIssueUserIds,
  );
  for (const user of refundActiveUsers) {
    const sub = userSubMap.get(user.id)!;
    const product = sub.product;
    // Revenue impact: match the subscription price (realistic refund amount)
    const impactCents = product.periodMonths === 12
      ? Math.round(product.amountCents / 12)
      : product.amountCents;

    issueRows.push({
      id: uuid(),
      orgId: ORG_ID,
      userId: user.id,
      issueType: 'refund_not_revoked',
      severity: 'warning',
      status: 'open',
      title: `Refund recorded but entitlement not revoked for ${user.firstName} ${user.lastName}`,
      description: `A refund of $${(impactCents / 100).toFixed(2)} for ${product.name} was processed in ${sub.source}, but your app still shows this user as having access. Your backend needs to revoke access when a refund is processed.`,
      estimatedRevenueCents: impactCents,
      confidence: +(0.92 + Math.random() * 0.08).toFixed(2),
      detectorId: 'refund_not_revoked',
      evidence: {
        userId: user.id,
        subscriptionId: sub.subId,
        productId: product.id,
        source: sub.source,
        refundAmount: impactCents,
        refundDate: daysAgo(randomInt(2, 14)).toISOString(),
        entitlementState: 'active',
        expectedState: 'refunded',
      },
      createdAt: daysAgo(randomInt(1, 10)),
      updatedAt: daysAgo(randomInt(0, 3)),
    });
  }

  // 8c. entitlement_without_payment: 3 issues, P0 warning
  const freeRiderUsers = pickUsers(
    (u) => u.stripeCustomerId !== null || u.appleTransactionId !== null,
    3,
    usedIssueUserIds,
  );
  for (const user of freeRiderUsers) {
    const sub = userSubMap.get(user.id)!;
    const product = sub.product;
    const impactCents = product.periodMonths === 12
      ? Math.round(product.amountCents / 12)
      : product.amountCents;

    issueRows.push({
      id: uuid(),
      orgId: ORG_ID,
      userId: user.id,
      issueType: 'entitlement_without_payment',
      severity: 'warning',
      status: 'open',
      title: `Entitlement active without payment for ${user.firstName} ${user.lastName}`,
      description: `Entitlement for ${product.name} is "active" but no successful payment events recorded in the last ${product.periodMonths === 12 ? '12' : '1'} month(s). This may indicate a missed renewal webhook or billing gap.`,
      estimatedRevenueCents: impactCents,
      confidence: +(0.75 + Math.random() * 0.15).toFixed(2),
      detectorId: 'entitlement_without_payment',
      evidence: {
        userId: user.id,
        subscriptionId: sub.subId,
        productId: product.id,
        source: sub.source,
        expectedPaymentAmount: impactCents,
        entitlementState: 'active',
        lastPaymentDate: daysAgo(randomInt(35, 90)).toISOString(),
        monthsWithoutPayment: randomInt(2, 4),
      },
      createdAt: daysAgo(randomInt(3, 21)),
      updatedAt: daysAgo(randomInt(0, 5)),
    });
  }

  // 8d. webhook_delivery_gap: 1 issue, P0 warning
  issueRows.push({
    id: uuid(),
    orgId: ORG_ID,
    userId: null,
    issueType: 'webhook_delivery_gap',
    severity: 'warning',
    status: 'open',
    title: 'Apple App Store webhook delivery gap detected',
    description: 'No Apple App Store webhooks received in the last 2+ hours. Normal webhook frequency is every 5-15 minutes. This could indicate a webhook configuration issue or Apple server-side notification failure. Events may be accumulating unprocessed.',
    estimatedRevenueCents: randomInt(120000, 250000), // $1,200-$2,500 at risk during gap
    confidence: 0.88,
    detectorId: 'webhook_delivery_gap',
    evidence: {
      source: 'apple',
      lastWebhookAt: hoursAgo(2).toISOString(),
      expectedFrequencyMinutes: 15,
      gapDurationMinutes: 120,
      estimatedMissedEvents: randomInt(15, 40),
      affectedUserEstimate: randomInt(80, 150),
    },
    createdAt: hoursAgo(1),
    updatedAt: minutesAgo(10),
  });

  // 8e. cross_platform_mismatch: 5 issues, P1 warning
  const crossPlatformUsers = pickUsers(
    (u) => u.stripeCustomerId !== null && u.appleTransactionId !== null,
    5,
    usedIssueUserIds,
  );
  for (const user of crossPlatformUsers) {
    const product = randomChoice(PRODUCTS.filter((p) => p.appleProductId !== null));
    const impactCents = product.periodMonths === 12
      ? Math.round(product.amountCents / 12)
      : product.amountCents;

    issueRows.push({
      id: uuid(),
      orgId: ORG_ID,
      userId: user.id,
      issueType: 'cross_platform_mismatch',
      severity: 'warning',
      status: 'open',
      title: `Cross-platform state mismatch for ${user.firstName} ${user.lastName}`,
      description: `Apple App Store reports active subscription for ${product.name} but Stripe shows expired/cancelled. User may be double-charged or have inconsistent access across platforms.`,
      estimatedRevenueCents: impactCents,
      confidence: +(0.80 + Math.random() * 0.15).toFixed(2),
      detectorId: 'cross_platform_mismatch',
      evidence: {
        userId: user.id,
        productId: product.id,
        appleState: 'active',
        stripeState: randomChoice(['expired', 'cancelled']),
        appleTransactionId: user.appleTransactionId,
        stripeCustomerId: user.stripeCustomerId,
        stripeSubscriptionId: stripeSubId(),
        detectedAt: daysAgo(randomInt(0, 5)).toISOString(),
      },
      createdAt: daysAgo(randomInt(1, 14)),
      updatedAt: daysAgo(randomInt(0, 3)),
    });
  }

  // 8f. silent_renewal_failure: 3 issues, P1 warning
  const silentRenewalUsers = pickUsers(
    (u) => u.stripeCustomerId !== null,
    3,
    usedIssueUserIds,
  );
  for (const user of silentRenewalUsers) {
    const sub = userSubMap.get(user.id)!;
    const product = sub.product;
    const impactCents = product.periodMonths === 12
      ? Math.round(product.amountCents / 12)
      : product.amountCents;

    issueRows.push({
      id: uuid(),
      orgId: ORG_ID,
      userId: user.id,
      issueType: 'silent_renewal_failure',
      severity: 'warning',
      status: 'open',
      title: `Silent renewal failure for ${user.firstName} ${user.lastName}`,
      description: `Expected renewal for ${product.name} did not occur. Subscription period ended ${randomInt(1, 5)} days ago but no renewal or cancellation event was received. User's entitlement may silently lapse.`,
      estimatedRevenueCents: impactCents,
      confidence: +(0.70 + Math.random() * 0.2).toFixed(2),
      detectorId: 'silent_renewal_failure',
      evidence: {
        userId: user.id,
        subscriptionId: sub.subId,
        productId: product.id,
        source: sub.source,
        expectedRenewalDate: daysAgo(randomInt(1, 5)).toISOString(),
        lastRenewalDate: daysAgo(randomInt(30, 60)).toISOString(),
        subscriptionAmount: impactCents,
      },
      createdAt: daysAgo(randomInt(0, 5)),
      updatedAt: daysAgo(randomInt(0, 2)),
    });
  }

  // 8g. trial_no_conversion: 10 issues, P2 info
  const trialUsers = pickUsers(
    (u) => true,
    10,
    usedIssueUserIds,
  );
  for (const user of trialUsers) {
    const sub = userSubMap.get(user.id)!;
    const product = sub.product;
    const impactCents = product.periodMonths === 12
      ? Math.round(product.amountCents / 12)
      : product.amountCents;

    issueRows.push({
      id: uuid(),
      orgId: ORG_ID,
      userId: user.id,
      issueType: 'trial_no_conversion',
      severity: 'info',
      status: 'open',
      title: `Trial expired without conversion: ${user.firstName} ${user.lastName}`,
      description: `User's 7-day trial of ${product.name} expired without converting to a paid subscription. Trial started ${randomInt(8, 21)} days ago.`,
      estimatedRevenueCents: impactCents,
      confidence: +(0.95 + Math.random() * 0.05).toFixed(2),
      detectorId: 'trial_no_conversion',
      evidence: {
        userId: user.id,
        productId: product.id,
        source: sub.source,
        trialStartDate: daysAgo(randomInt(8, 21)).toISOString(),
        trialEndDate: daysAgo(randomInt(1, 14)).toISOString(),
        trialDurationDays: 7,
        potentialMonthlyRevenue: impactCents,
      },
      createdAt: daysAgo(randomInt(1, 14)),
      updatedAt: daysAgo(randomInt(0, 5)),
    });
  }

  // Calculate total for summary
  const totalRevenueCents = issueRows.reduce(
    (sum, issue) => sum + ((issue.estimatedRevenueCents as number) || 0),
    0,
  );

  // Add detectionTier to all billing-only issues
  for (const issue of issueRows) {
    (issue as any).detectionTier = 'billing_only';
  }

  // Add Tier 2 (app_verified) issues
  const tier2Users = pickUsers(
    (u) => u.stripeCustomerId !== null,
    3,
    usedIssueUserIds,
  );

  if (tier2Users.length >= 2) {
    const vpnaUser = tier2Users[0];
    const vpnaSub = userSubMap.get(vpnaUser.id)!;
    const vpnaImpactCents = vpnaSub.product.periodMonths === 12
      ? Math.round(vpnaSub.product.amountCents / 12)
      : vpnaSub.product.amountCents;
    issueRows.push({
      id: uuid(),
      orgId: ORG_ID,
      userId: vpnaUser.id,
      issueType: 'verified_paid_no_access',
      severity: 'critical',
      status: 'open',
      title: `Paying customer confirmed without access: ${vpnaUser.firstName} ${vpnaUser.lastName}`,
      description: `User has an active entitlement for ${vpnaSub.product.name} but your app reported hasAccess=false. This customer is paying but cannot use the product.`,
      estimatedRevenueCents: vpnaImpactCents,
      confidence: 0.95,
      detectorId: 'verified_paid_no_access',
      detectionTier: 'app_verified',
      evidence: {
        userId: vpnaUser.id,
        entitlementState: 'active',
        hasAccess: false,
        verifiedAt: hoursAgo(1).toISOString(),
      },
      createdAt: hoursAgo(2),
      updatedAt: hoursAgo(1),
    } as any);

    const vanpUser = tier2Users[1];
    const vanpSub = userSubMap.get(vanpUser.id)!;
    const vanpImpactCents = vanpSub.product.periodMonths === 12
      ? Math.round(vanpSub.product.amountCents / 12)
      : vanpSub.product.amountCents;
    issueRows.push({
      id: uuid(),
      orgId: ORG_ID,
      userId: vanpUser.id,
      issueType: 'verified_access_no_payment',
      severity: 'warning',
      status: 'open',
      title: `User has access without active subscription: ${vanpUser.firstName} ${vanpUser.lastName}`,
      description: `Your app reported hasAccess=true for this user, but their subscription for ${vanpSub.product.name} is expired. They may be accessing the product without paying.`,
      estimatedRevenueCents: vanpImpactCents,
      confidence: 0.95,
      detectorId: 'verified_access_no_payment',
      detectionTier: 'app_verified',
      evidence: {
        userId: vanpUser.id,
        entitlementStates: ['expired'],
        hasAccess: true,
        verifiedAt: hoursAgo(1).toISOString(),
      },
      createdAt: hoursAgo(3),
      updatedAt: hoursAgo(1),
    } as any);
  }

  await db.insert(schema.issues).values(issueRows as any);
  console.log(`  Created ${issueRows.length} issues`);
  console.log(`  Total revenue at risk: $${(totalRevenueCents / 100).toFixed(2)}/mo`);

  // ── 9. Webhook Logs ────────────────────────────────────────────────
  console.log('[9/9] Creating webhook logs...');

  const webhookRows: Array<Record<string, unknown>> = [];
  const WEBHOOK_COUNT = 50;

  const stripeWebhookTypes = [
    'invoice.payment_succeeded', 'invoice.payment_failed',
    'customer.subscription.created', 'customer.subscription.updated',
    'customer.subscription.deleted', 'charge.refunded',
    'customer.subscription.trial_will_end',
  ];

  const appleWebhookTypes = [
    'SUBSCRIBED:INITIAL_BUY', 'DID_RENEW', 'DID_FAIL_TO_RENEW',
    'DID_CHANGE_RENEWAL_STATUS', 'EXPIRED', 'REFUND',
    'GRACE_PERIOD_EXPIRES', 'OFFER_REDEEMED',
  ];

  for (let i = 0; i < WEBHOOK_COUNT; i++) {
    const isStripe = i < 30; // 30 Stripe, 20 Apple
    const source: BillingSource = isStripe ? 'stripe' : 'apple';
    const eventType = isStripe
      ? randomChoice(stripeWebhookTypes)
      : randomChoice(appleWebhookTypes);

    // Recent webhooks spread over last 24 hours, with Apple gap
    let createdAt: Date;
    if (isStripe) {
      createdAt = randomDateBetween(hoursAgo(24), minutesAgo(5));
    } else {
      // Apple webhooks stop 2 hours ago (webhook gap)
      createdAt = randomDateBetween(hoursAgo(24), hoursAgo(2));
    }

    const processingStatus = randomChoice([
      'processed', 'processed', 'processed', 'processed',
      'processed', 'processed', 'processed', 'processed',
      'failed', 'skipped',
    ]);

    webhookRows.push({
      id: uuid(),
      orgId: ORG_ID,
      source,
      eventType,
      externalEventId: isStripe ? stripeEventId() : uuid(),
      httpStatus: processingStatus === 'failed' ? 500 : 200,
      processingStatus,
      errorMessage: processingStatus === 'failed'
        ? randomChoice([
          'Timeout waiting for database lock',
          'User identity resolution failed: ambiguous match',
          'Event idempotency conflict',
        ])
        : null,
      rawHeaders: {
        'content-type': 'application/json',
        'user-agent': isStripe ? 'Stripe/1.0' : 'Apple-Server-Notifications/2.0',
        ...(isStripe ? { 'stripe-signature': 't=1234567890,v1=abc123...' } : {}),
      },
      rawBody: JSON.stringify({
        _seed: true,
        type: eventType,
        id: isStripe ? stripeEventId() : uuid(),
      }),
      processedAt: processingStatus !== 'failed' ? new Date(createdAt.getTime() + randomInt(100, 3000)) : null,
      createdAt,
    });
  }

  // Sort by time
  webhookRows.sort((a, b) => (a.createdAt as Date).getTime() - (b.createdAt as Date).getTime());

  await db.insert(schema.webhookLogs).values(webhookRows as any);
  console.log(`  Created ${WEBHOOK_COUNT} webhook logs`);

  // ── 10. Access Checks ─────────────────────────────────────────────
  console.log('[10/10] Creating access checks...');

  const accessCheckRows: Array<Record<string, unknown>> = [];
  const ACCESS_CHECK_COUNT = 30;

  // Generate access checks for some users
  const accessCheckUsers = userRows.slice(0, ACCESS_CHECK_COUNT);
  for (let i = 0; i < accessCheckUsers.length; i++) {
    const user = accessCheckUsers[i];
    const sub = userSubMap.get(user.id);
    const product = sub?.product;

    accessCheckRows.push({
      id: uuid(),
      orgId: ORG_ID,
      userId: user.id,
      productId: product?.id || null,
      externalUserId: user.stripeCustomerId || user.email,
      hasAccess: i < ACCESS_CHECK_COUNT - 3, // Last 3 users report no access
      reportedAt: randomDateBetween(hoursAgo(24), minutesAgo(10)),
      metadata: {},
      createdAt: new Date(),
    });
  }

  await db.insert(schema.accessChecks).values(accessCheckRows as any);
  console.log(`  Created ${ACCESS_CHECK_COUNT} access checks`);

  // ── Summary ────────────────────────────────────────────────────────
  console.log('\n=== Seed Complete ===');
  console.log(`Organization:       Acme Fitness (${ORG_ID})`);
  console.log(`API Keys:           2 (1 active, 1 expired)`);
  console.log(`Billing Connections: 2 (Stripe + Apple)`);
  console.log(`Products:           ${PRODUCTS.length}`);
  console.log(`Users:              ${USER_COUNT}`);
  console.log(`Identities:         ${identityRows.length}`);
  console.log(`Events:             ${EVENT_COUNT}`);
  console.log(`Entitlements:       ${entitlementRows.length}`);
  console.log(`Issues:             ${issueRows.length}`);
  console.log(`  - payment_without_entitlement: ${issueRows.filter((i) => i.issueType === 'payment_without_entitlement').length}`);
  console.log(`  - refund_not_revoked:          ${issueRows.filter((i) => i.issueType === 'refund_not_revoked').length}`);
  console.log(`  - entitlement_without_payment: ${issueRows.filter((i) => i.issueType === 'entitlement_without_payment').length}`);
  console.log(`  - webhook_delivery_gap:   ${issueRows.filter((i) => i.issueType === 'webhook_delivery_gap').length}`);
  console.log(`  - cross_platform_mismatch: ${issueRows.filter((i) => i.issueType === 'cross_platform_mismatch').length}`);
  console.log(`  - silent_renewal_failure: ${issueRows.filter((i) => i.issueType === 'silent_renewal_failure').length}`);
  console.log(`  - trial_no_conversion:    ${issueRows.filter((i) => i.issueType === 'trial_no_conversion').length}`);
  console.log(`  - verified_paid_no_access: ${issueRows.filter((i) => i.issueType === 'verified_paid_no_access').length}`);
  console.log(`  - verified_access_no_payment: ${issueRows.filter((i) => i.issueType === 'verified_access_no_payment').length}`);
  console.log(`Access Checks:      ${ACCESS_CHECK_COUNT}`);
  console.log(`Webhook Logs:       ${WEBHOOK_COUNT}`);
  console.log(`Revenue at Risk:    $${(totalRevenueCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}/mo`);
  console.log('\nReady for demo!');
}

// ─── Run ─────────────────────────────────────────────────────────────

seed()
  .then(async () => {
    await client.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('Seed failed:', err);
    await client.end();
    process.exit(1);
  });
