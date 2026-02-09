-- RevBack initial migration
-- Generated from src/models/schema.ts

-- ─── Enums ───────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "billing_source" AS ENUM ('stripe', 'apple', 'google', 'recurly', 'braintree');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "event_type" AS ENUM (
    'purchase', 'renewal', 'cancellation', 'refund', 'chargeback',
    'grace_period_start', 'grace_period_end', 'billing_retry', 'expiration',
    'trial_start', 'trial_conversion', 'upgrade', 'downgrade', 'crossgrade',
    'pause', 'resume', 'revoke', 'offer_redeemed', 'price_change'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "event_status" AS ENUM ('success', 'failed', 'pending', 'refunded');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "entitlement_state" AS ENUM (
    'inactive', 'trial', 'active', 'offer_period', 'grace_period',
    'billing_retry', 'on_hold', 'past_due', 'paused', 'expired',
    'revoked', 'refunded'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "issue_severity" AS ENUM ('critical', 'warning', 'info');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "issue_status" AS ENUM ('open', 'acknowledged', 'resolved', 'dismissed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- ─── Extensions ──────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Organizations ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "organizations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" varchar(255) NOT NULL,
  "slug" varchar(100) NOT NULL UNIQUE,
  "settings" jsonb DEFAULT '{}',
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- ─── API Keys ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "api_keys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "name" varchar(255) NOT NULL,
  "key_hash" varchar(255) NOT NULL UNIQUE,
  "key_prefix" varchar(10) NOT NULL,
  "scopes" jsonb DEFAULT '[]',
  "last_used_at" timestamp,
  "expires_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- ─── Billing Connections ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "billing_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "source" "billing_source" NOT NULL,
  "credentials" jsonb NOT NULL,
  "webhook_secret" varchar(512),
  "is_active" boolean DEFAULT true NOT NULL,
  "last_sync_at" timestamp,
  "last_webhook_at" timestamp,
  "sync_status" varchar(50) DEFAULT 'pending',
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "billing_connections_org_source_idx"
  ON "billing_connections" ("org_id", "source");

-- ─── Products ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "products" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "name" varchar(255) NOT NULL,
  "external_ids" jsonb DEFAULT '{}' NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "products_org_idx" ON "products" ("org_id");

-- ─── Users ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "external_user_id" varchar(255),
  "email" varchar(255),
  "metadata" jsonb DEFAULT '{}',
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "users_org_idx" ON "users" ("org_id");
CREATE INDEX IF NOT EXISTS "users_external_id_idx" ON "users" ("org_id", "external_user_id");
CREATE INDEX IF NOT EXISTS "users_email_idx" ON "users" ("org_id", "email");

-- ─── User Identities ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "user_identities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "source" "billing_source" NOT NULL,
  "external_id" varchar(512) NOT NULL,
  "id_type" varchar(50) NOT NULL,
  "metadata" jsonb DEFAULT '{}',
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_identities_source_external_idx"
  ON "user_identities" ("org_id", "source", "external_id");
CREATE INDEX IF NOT EXISTS "user_identities_user_idx"
  ON "user_identities" ("user_id");

-- ─── Canonical Events ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "canonical_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "user_id" uuid REFERENCES "users"("id"),
  "product_id" uuid REFERENCES "products"("id"),
  "source" "billing_source" NOT NULL,
  "event_type" "event_type" NOT NULL,
  "source_event_type" varchar(255),
  "event_time" timestamp NOT NULL,
  "status" "event_status" NOT NULL,
  "amount_cents" integer,
  "currency" varchar(3) DEFAULT 'USD',
  "proceeds_cents" integer,
  "external_event_id" varchar(512),
  "external_subscription_id" varchar(512),
  "original_transaction_id" varchar(512),
  "subscription_group_id" varchar(255),
  "period_type" varchar(50),
  "expiration_time" timestamp,
  "grace_period_expiration" timestamp,
  "cancellation_reason" varchar(100),
  "is_family_share" boolean DEFAULT false,
  "environment" varchar(20) DEFAULT 'production',
  "country_code" varchar(5),
  "idempotency_key" varchar(512) NOT NULL UNIQUE,
  "raw_payload" jsonb NOT NULL,
  "processed_at" timestamp,
  "ingested_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "events_org_user_idx"
  ON "canonical_events" ("org_id", "user_id");
CREATE INDEX IF NOT EXISTS "events_org_time_idx"
  ON "canonical_events" ("org_id", "event_time");
CREATE INDEX IF NOT EXISTS "events_org_type_idx"
  ON "canonical_events" ("org_id", "event_type");
CREATE INDEX IF NOT EXISTS "events_external_event_idx"
  ON "canonical_events" ("org_id", "source", "external_event_id");
CREATE INDEX IF NOT EXISTS "events_subscription_idx"
  ON "canonical_events" ("org_id", "external_subscription_id");
CREATE INDEX IF NOT EXISTS "events_original_txn_idx"
  ON "canonical_events" ("org_id", "original_transaction_id");
CREATE INDEX IF NOT EXISTS "events_environment_idx"
  ON "canonical_events" ("org_id", "environment");

-- ─── Entitlements ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "entitlements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "product_id" uuid NOT NULL REFERENCES "products"("id"),
  "source" "billing_source" NOT NULL,
  "state" "entitlement_state" NOT NULL DEFAULT 'inactive',
  "external_subscription_id" varchar(512),
  "current_period_start" timestamp,
  "current_period_end" timestamp,
  "cancel_at" timestamp,
  "trial_end" timestamp,
  "last_event_id" uuid REFERENCES "canonical_events"("id"),
  "state_history" jsonb DEFAULT '[]',
  "metadata" jsonb DEFAULT '{}',
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "entitlements_user_product_source_idx"
  ON "entitlements" ("org_id", "user_id", "product_id", "source");
CREATE INDEX IF NOT EXISTS "entitlements_org_state_idx"
  ON "entitlements" ("org_id", "state");
CREATE INDEX IF NOT EXISTS "entitlements_user_idx"
  ON "entitlements" ("user_id");

-- ─── Issues ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "issues" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "user_id" uuid REFERENCES "users"("id"),
  "issue_type" varchar(100) NOT NULL,
  "severity" "issue_severity" NOT NULL,
  "status" "issue_status" NOT NULL DEFAULT 'open',
  "title" text NOT NULL,
  "description" text NOT NULL,
  "estimated_revenue_cents" integer,
  "confidence" real,
  "detector_id" varchar(100) NOT NULL,
  "evidence" jsonb DEFAULT '{}' NOT NULL,
  "resolved_at" timestamp,
  "resolved_by" varchar(255),
  "resolution" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "issues_org_status_idx"
  ON "issues" ("org_id", "status");
CREATE INDEX IF NOT EXISTS "issues_org_severity_idx"
  ON "issues" ("org_id", "severity");
CREATE INDEX IF NOT EXISTS "issues_org_type_idx"
  ON "issues" ("org_id", "issue_type");
CREATE INDEX IF NOT EXISTS "issues_user_idx"
  ON "issues" ("user_id");
CREATE INDEX IF NOT EXISTS "issues_created_idx"
  ON "issues" ("org_id", "created_at");

-- ─── Webhook Logs ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "webhook_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "source" "billing_source" NOT NULL,
  "event_type" varchar(255),
  "external_event_id" varchar(512),
  "http_status" integer,
  "processing_status" varchar(50) NOT NULL DEFAULT 'received',
  "error_message" text,
  "raw_headers" jsonb,
  "raw_body" text,
  "processed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "webhook_logs_org_source_idx"
  ON "webhook_logs" ("org_id", "source");
CREATE INDEX IF NOT EXISTS "webhook_logs_created_idx"
  ON "webhook_logs" ("org_id", "created_at");

-- ─── Alert Channel Enum ──────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "alert_channel" AS ENUM ('slack', 'email');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- ─── Alert Configurations ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "alert_configurations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "channel" "alert_channel" NOT NULL,
  "config" jsonb NOT NULL,
  "severity_filter" text[] NOT NULL DEFAULT ARRAY['critical', 'warning', 'info'],
  "issue_types" text[],
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "alert_configs_org_idx"
  ON "alert_configurations" ("org_id");
CREATE INDEX IF NOT EXISTS "alert_configs_org_channel_idx"
  ON "alert_configurations" ("org_id", "channel");

-- ─── Alert Delivery Logs ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "alert_delivery_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "alert_config_id" uuid NOT NULL REFERENCES "alert_configurations"("id"),
  "issue_id" uuid REFERENCES "issues"("id"),
  "channel" "alert_channel" NOT NULL,
  "status" varchar(50) NOT NULL,
  "error_message" text,
  "sent_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "alert_delivery_org_idx"
  ON "alert_delivery_logs" ("org_id");
CREATE INDEX IF NOT EXISTS "alert_delivery_config_idx"
  ON "alert_delivery_logs" ("alert_config_id");
CREATE INDEX IF NOT EXISTS "alert_delivery_sent_idx"
  ON "alert_delivery_logs" ("org_id", "sent_at");

-- ─── Issue Deduplication Index ─────────────────────────────────────────
-- Partial unique index: only one open issue per org/user/type at a time.
-- This enforces dedup at the DB level and enables the 23505 catch in engine.ts.

CREATE UNIQUE INDEX IF NOT EXISTS "issues_dedup_idx"
  ON "issues" ("org_id", "user_id", "issue_type")
  WHERE "status" = 'open';
