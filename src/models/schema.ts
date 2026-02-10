import {
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
  integer,
  bigint,
  boolean,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
  real,
} from 'drizzle-orm/pg-core';

// ─── Enums ───────────────────────────────────────────────────────────

export const billingSourceEnum = pgEnum('billing_source', [
  'stripe',
  'apple',
  'google',
  'recurly',
  'braintree',
]);

export const eventTypeEnum = pgEnum('event_type', [
  'purchase',
  'renewal',
  'cancellation',
  'refund',
  'chargeback',
  'grace_period_start',
  'grace_period_end',
  'billing_retry',
  'expiration',
  'trial_start',
  'trial_conversion',
  'upgrade',
  'downgrade',
  'crossgrade',
  'pause',
  'resume',
  'revoke',
  'offer_redeemed',
  'price_change',
]);

export const eventStatusEnum = pgEnum('event_status', [
  'success',
  'failed',
  'pending',
  'refunded',
]);

export const entitlementStateEnum = pgEnum('entitlement_state', [
  'inactive',
  'trial',
  'active',
  'offer_period',
  'grace_period',
  'billing_retry',
  'on_hold',
  'past_due',
  'paused',
  'expired',
  'revoked',
  'refunded',
]);

export const issueSeverityEnum = pgEnum('issue_severity', [
  'critical',
  'warning',
  'info',
]);

export const issueStatusEnum = pgEnum('issue_status', [
  'open',
  'acknowledged',
  'resolved',
  'dismissed',
]);

// ─── Organizations (multi-tenant) ────────────────────────────────────

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  settings: jsonb('settings').default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ─── API Keys ────────────────────────────────────────────────────────

export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  name: varchar('name', { length: 255 }).notNull(),
  keyHash: varchar('key_hash', { length: 255 }).notNull().unique(),
  keyPrefix: varchar('key_prefix', { length: 10 }).notNull(),
  scopes: jsonb('scopes').default([]),
  lastUsedAt: timestamp('last_used_at'),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ─── Billing Connections ─────────────────────────────────────────────

export const billingConnections = pgTable('billing_connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  source: billingSourceEnum('source').notNull(),
  credentials: jsonb('credentials').notNull(), // encrypted via src/security/credentials.ts
  webhookSecret: varchar('webhook_secret', { length: 512 }),
  isActive: boolean('is_active').default(true).notNull(),
  lastSyncAt: timestamp('last_sync_at'),
  lastWebhookAt: timestamp('last_webhook_at'), // for webhook gap detection
  syncStatus: varchar('sync_status', { length: 50 }).default('pending'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('billing_connections_org_source_idx').on(table.orgId, table.source),
]);

// ─── Products (normalized from billing systems) ──────────────────────

export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  name: varchar('name', { length: 255 }).notNull(),
  externalIds: jsonb('external_ids').default({}).notNull(), // { stripe: "prod_xxx", apple: "com.app.premium" }
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('products_org_idx').on(table.orgId),
]);

// ─── User Identity Graph ─────────────────────────────────────────────

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  externalUserId: varchar('external_user_id', { length: 255 }),
  email: varchar('email', { length: 255 }),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('users_org_idx').on(table.orgId),
  index('users_external_id_idx').on(table.orgId, table.externalUserId),
  index('users_email_idx').on(table.orgId, table.email),
]);

export const userIdentities = pgTable('user_identities', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  source: billingSourceEnum('source').notNull(),
  externalId: varchar('external_id', { length: 512 }).notNull(), // stripe customer_id, apple original_transaction_id, etc.
  idType: varchar('id_type', { length: 50 }).notNull(), // 'customer_id', 'original_transaction_id', 'purchase_token'
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('user_identities_source_external_idx').on(table.orgId, table.source, table.externalId),
  index('user_identities_user_idx').on(table.userId),
]);

// ─── Canonical Events ────────────────────────────────────────────────
// Two-layer model per tech review: this is the enriched normalized event.
// Raw payload is preserved for audit/replay. Derived fields power the engines.

export const canonicalEvents = pgTable('canonical_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  userId: uuid('user_id').references(() => users.id),
  productId: uuid('product_id').references(() => products.id),
  source: billingSourceEnum('source').notNull(),
  eventType: eventTypeEnum('event_type').notNull(),
  sourceEventType: varchar('source_event_type', { length: 255 }), // original type from provider (e.g., "SUBSCRIBED:INITIAL_BUY")
  eventTime: timestamp('event_time').notNull(),
  status: eventStatusEnum('status').notNull(),
  amountCents: integer('amount_cents'), // stored in cents to avoid float issues
  currency: varchar('currency', { length: 3 }).default('USD'),
  proceedsCents: integer('proceeds_cents'), // net after platform cut
  externalEventId: varchar('external_event_id', { length: 512 }),
  externalSubscriptionId: varchar('external_subscription_id', { length: 512 }),
  originalTransactionId: varchar('original_transaction_id', { length: 512 }), // Apple's primary sub identity
  subscriptionGroupId: varchar('subscription_group_id', { length: 255 }), // Apple subscription group
  periodType: varchar('period_type', { length: 50 }), // trial | intro | normal | promotional
  expirationTime: timestamp('expiration_time'), // when current period ends
  gracePeriodExpiration: timestamp('grace_period_expiration'),
  cancellationReason: varchar('cancellation_reason', { length: 100 }), // voluntary | billing_failure | refund | price_increase
  isFamilyShare: boolean('is_family_share').default(false),
  environment: varchar('environment', { length: 20 }).default('production'), // sandbox | production
  countryCode: varchar('country_code', { length: 5 }),
  billingInterval: varchar('billing_interval', { length: 20 }), // month, year, week, day
  planTier: varchar('plan_tier', { length: 100 }), // extracted from price nickname or product ID
  trialStartedAt: timestamp('trial_started_at'),
  idempotencyKey: varchar('idempotency_key', { length: 512 }).notNull().unique(),
  rawPayload: jsonb('raw_payload').notNull(),
  processedAt: timestamp('processed_at'),
  ingestedAt: timestamp('ingested_at').defaultNow().notNull(), // when OUR system received it
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('events_org_user_idx').on(table.orgId, table.userId),
  index('events_org_time_idx').on(table.orgId, table.eventTime),
  index('events_org_type_idx').on(table.orgId, table.eventType),
  index('events_external_event_idx').on(table.orgId, table.source, table.externalEventId),
  index('events_subscription_idx').on(table.orgId, table.externalSubscriptionId),
  index('events_original_txn_idx').on(table.orgId, table.originalTransactionId),
  index('events_environment_idx').on(table.orgId, table.environment),
]);

// ─── Entitlements ────────────────────────────────────────────────────

export const entitlements = pgTable('entitlements', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  productId: uuid('product_id').notNull().references(() => products.id),
  source: billingSourceEnum('source').notNull(),
  state: entitlementStateEnum('state').notNull().default('inactive'),
  externalSubscriptionId: varchar('external_subscription_id', { length: 512 }),
  currentPeriodStart: timestamp('current_period_start'),
  currentPeriodEnd: timestamp('current_period_end'),
  cancelAt: timestamp('cancel_at'),
  trialEnd: timestamp('trial_end'),
  billingInterval: varchar('billing_interval', { length: 20 }),
  planTier: varchar('plan_tier', { length: 100 }),
  lastEventId: uuid('last_event_id').references(() => canonicalEvents.id),
  stateHistory: jsonb('state_history').default([]),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('entitlements_user_product_source_idx').on(table.orgId, table.userId, table.productId, table.source),
  index('entitlements_org_state_idx').on(table.orgId, table.state),
  index('entitlements_user_idx').on(table.userId),
]);

// ─── Issues ──────────────────────────────────────────────────────────

export const issues = pgTable('issues', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  userId: uuid('user_id').references(() => users.id),
  issueType: varchar('issue_type', { length: 100 }).notNull(),
  severity: issueSeverityEnum('severity').notNull(),
  status: issueStatusEnum('status').notNull().default('open'),
  title: text('title').notNull(),
  description: text('description').notNull(),
  estimatedRevenueCents: integer('estimated_revenue_cents'),
  confidence: real('confidence'), // 0.0 - 1.0
  detectorId: varchar('detector_id', { length: 100 }).notNull(),
  detectionTier: varchar('detection_tier', { length: 20 }).notNull().default('billing_only'),
  evidence: jsonb('evidence').default({}).notNull(), // relevant event IDs, state snapshots
  resolvedAt: timestamp('resolved_at'),
  resolvedBy: varchar('resolved_by', { length: 255 }),
  resolution: text('resolution'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('issues_org_status_idx').on(table.orgId, table.status),
  index('issues_org_severity_idx').on(table.orgId, table.severity),
  index('issues_org_type_idx').on(table.orgId, table.issueType),
  index('issues_user_idx').on(table.userId),
  index('issues_created_idx').on(table.orgId, table.createdAt),
]);

// ─── Alert Configurations ────────────────────────────────────────────

export const alertChannelEnum = pgEnum('alert_channel', ['slack', 'email', 'webhook', 'pagerduty']);

export const alertConfigurations = pgTable('alert_configurations', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  channel: alertChannelEnum('channel').notNull(),
  config: jsonb('config').notNull(), // Slack: { webhookUrl, channelName }, Email: { recipients: string[] }
  severityFilter: text('severity_filter').array().notNull().default(['critical', 'warning', 'info']),
  issueTypes: text('issue_types').array(), // null = all types
  enabled: boolean('enabled').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('alert_configs_org_idx').on(table.orgId),
  index('alert_configs_org_channel_idx').on(table.orgId, table.channel),
]);

// ─── Alert Delivery Logs ────────────────────────────────────────────

export const alertDeliveryLogs = pgTable('alert_delivery_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  alertConfigId: uuid('alert_config_id').notNull().references(() => alertConfigurations.id),
  issueId: uuid('issue_id').references(() => issues.id),
  channel: alertChannelEnum('channel').notNull(),
  status: varchar('status', { length: 50 }).notNull(), // 'sent', 'failed', 'rate_limited'
  errorMessage: text('error_message'),
  sentAt: timestamp('sent_at').defaultNow().notNull(),
}, (table) => [
  index('alert_delivery_org_idx').on(table.orgId),
  index('alert_delivery_config_idx').on(table.alertConfigId),
  index('alert_delivery_sent_idx').on(table.orgId, table.sentAt),
]);

// ─── Webhook Logs ────────────────────────────────────────────────────

export const webhookLogs = pgTable('webhook_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  source: billingSourceEnum('source').notNull(),
  eventType: varchar('event_type', { length: 255 }),
  externalEventId: varchar('external_event_id', { length: 512 }),
  httpStatus: integer('http_status'),
  processingStatus: varchar('processing_status', { length: 50 }).notNull().default('received'), // received, processed, failed, skipped
  errorMessage: text('error_message'),
  rawHeaders: jsonb('raw_headers'),
  rawBody: text('raw_body'),
  processedAt: timestamp('processed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('webhook_logs_org_source_idx').on(table.orgId, table.source),
  index('webhook_logs_created_idx').on(table.orgId, table.createdAt),
]);

// ─── Access Checks ───────────────────────────────────────────────────

export const accessChecks = pgTable('access_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  userId: uuid('user_id').references(() => users.id),
  productId: uuid('product_id').references(() => products.id),
  externalUserId: varchar('external_user_id', { length: 512 }).notNull(),
  hasAccess: boolean('has_access').notNull(),
  reportedAt: timestamp('reported_at').notNull(),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('access_checks_org_idx').on(table.orgId),
  index('access_checks_org_user_idx').on(table.orgId, table.userId),
  index('access_checks_org_reported_idx').on(table.orgId, table.reportedAt),
  index('access_checks_external_user_idx').on(table.orgId, table.externalUserId),
]);

// ─── Audit Logs ─────────────────────────────────────────────────────

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  actorType: varchar('actor_type', { length: 50 }).notNull(), // 'api_key', 'system', 'user'
  actorId: varchar('actor_id', { length: 255 }).notNull(),
  action: varchar('action', { length: 100 }).notNull(),
  resourceType: varchar('resource_type', { length: 100 }).notNull(),
  resourceId: varchar('resource_id', { length: 255 }),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('audit_logs_org_idx').on(table.orgId),
  index('audit_logs_org_action_idx').on(table.orgId, table.action),
  index('audit_logs_org_created_idx').on(table.orgId, table.createdAt),
]);
