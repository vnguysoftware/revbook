-- Add plan metadata columns to canonical_events
ALTER TABLE "canonical_events" ADD COLUMN "billing_interval" varchar(20);
ALTER TABLE "canonical_events" ADD COLUMN "plan_tier" varchar(100);
ALTER TABLE "canonical_events" ADD COLUMN "trial_started_at" timestamp;

-- Add plan metadata columns to entitlements
ALTER TABLE "entitlements" ADD COLUMN "billing_interval" varchar(20);
ALTER TABLE "entitlements" ADD COLUMN "plan_tier" varchar(100);
