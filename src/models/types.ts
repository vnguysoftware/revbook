import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import * as schema from './schema.js';

// ─── Select types (reading from DB) ─────────────────────────────────

export type Organization = InferSelectModel<typeof schema.organizations>;
export type ApiKey = InferSelectModel<typeof schema.apiKeys>;
export type BillingConnection = InferSelectModel<typeof schema.billingConnections>;
export type Product = InferSelectModel<typeof schema.products>;
export type User = InferSelectModel<typeof schema.users>;
export type UserIdentity = InferSelectModel<typeof schema.userIdentities>;
export type CanonicalEvent = InferSelectModel<typeof schema.canonicalEvents>;
export type Entitlement = InferSelectModel<typeof schema.entitlements>;
export type Issue = InferSelectModel<typeof schema.issues>;
export type WebhookLog = InferSelectModel<typeof schema.webhookLogs>;

// ─── Insert types (writing to DB) ───────────────────────────────────

export type NewOrganization = InferInsertModel<typeof schema.organizations>;
export type NewCanonicalEvent = InferInsertModel<typeof schema.canonicalEvents>;
export type NewEntitlement = InferInsertModel<typeof schema.entitlements>;
export type NewIssue = InferInsertModel<typeof schema.issues>;
export type NewUser = InferInsertModel<typeof schema.users>;
export type NewUserIdentity = InferInsertModel<typeof schema.userIdentities>;
export type NewWebhookLog = InferInsertModel<typeof schema.webhookLogs>;
export type AlertConfiguration = InferSelectModel<typeof schema.alertConfigurations>;
export type NewAlertConfiguration = InferInsertModel<typeof schema.alertConfigurations>;
export type AlertDeliveryLog = InferSelectModel<typeof schema.alertDeliveryLogs>;
export type NewAlertDeliveryLog = InferInsertModel<typeof schema.alertDeliveryLogs>;
export type AccessCheck = InferSelectModel<typeof schema.accessChecks>;
export type NewAccessCheck = InferInsertModel<typeof schema.accessChecks>;

// ─── Domain types ───────────────────────────────────────────────────

export type BillingSource = 'stripe' | 'apple' | 'google' | 'recurly' | 'braintree';

export type EventType =
  | 'purchase'
  | 'renewal'
  | 'cancellation'
  | 'refund'
  | 'chargeback'
  | 'grace_period_start'
  | 'grace_period_end'
  | 'billing_retry'
  | 'expiration'
  | 'trial_start'
  | 'trial_conversion'
  | 'upgrade'
  | 'downgrade'
  | 'crossgrade'
  | 'pause'
  | 'resume'
  | 'revoke'
  | 'offer_redeemed'
  | 'price_change';

export type EventStatus = 'success' | 'failed' | 'pending' | 'refunded';

export type EntitlementState =
  | 'inactive'
  | 'trial'
  | 'active'
  | 'grace_period'
  | 'billing_retry'
  | 'past_due'
  | 'paused'
  | 'expired'
  | 'revoked'
  | 'refunded';

export type IssueSeverity = 'critical' | 'warning' | 'info';
export type IssueStatus = 'open' | 'acknowledged' | 'resolved' | 'dismissed';

/** Raw webhook payload before normalization */
export interface RawWebhookEvent {
  source: BillingSource;
  headers: Record<string, string>;
  body: string;
  receivedAt: Date;
}

/** Normalized event ready for storage */
export interface NormalizedEvent {
  orgId: string;
  userId?: string;
  productId?: string;
  source: BillingSource;
  eventType: EventType;
  eventTime: Date;
  status: EventStatus;
  amountCents?: number;
  currency?: string;
  externalEventId?: string;
  externalSubscriptionId?: string;
  billingInterval?: string;
  planTier?: string;
  trialStartedAt?: Date;
  idempotencyKey: string;
  rawPayload: Record<string, unknown>;
  identityHints: IdentityHint[];
}

/** Hints for resolving user identity from raw events */
export interface IdentityHint {
  source: BillingSource;
  idType: string;
  externalId: string;
  metadata?: Record<string, unknown>;
}

/** State transition in the entitlement engine */
export interface StateTransition {
  from: EntitlementState;
  to: EntitlementState;
  eventType: EventType;
  eventId: string;
  timestamp: Date;
}

export type DetectionTier = 'billing_only' | 'app_verified';

/** Issue detection result */
export interface DetectedIssue {
  issueType: string;
  severity: IssueSeverity;
  title: string;
  description: string;
  userId?: string;
  estimatedRevenueCents?: number;
  confidence: number;
  evidence: Record<string, unknown>;
  detectionTier?: DetectionTier;
}

// ─── Alert types ────────────────────────────────────────────────────

export type AlertChannel = 'slack' | 'email';

export interface SlackAlertConfig {
  webhookUrl: string;
  channelName?: string;
}

export interface EmailAlertConfig {
  recipients: string[];
}

export type AlertConfig = SlackAlertConfig | EmailAlertConfig;
