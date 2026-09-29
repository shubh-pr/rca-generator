-- Reverse of the Phase 8 billing migration. Billing data (events, history, checkouts, paid flags) is dropped.
DROP TABLE IF EXISTS "billing_history";
DROP TABLE IF EXISTS "billing_events";
DROP TABLE IF EXISTS "checkout_sessions";
ALTER TABLE "rca" DROP COLUMN IF EXISTS "paid_at", DROP COLUMN IF EXISTS "payment_reference";
ALTER TABLE "workspaces"
  DROP COLUMN IF EXISTS "current_period_end",
  DROP COLUMN IF EXISTS "payment_customer_ref",
  DROP COLUMN IF EXISTS "seats",
  DROP COLUMN IF EXISTS "subscription_ref",
  DROP COLUMN IF EXISTS "subscription_status";
ALTER TABLE "workspaces" ALTER COLUMN "plan" DROP DEFAULT;
ALTER TABLE "workspaces" ALTER COLUMN "plan" TYPE VARCHAR(20) USING ('FREE');
ALTER TABLE "workspaces" ALTER COLUMN "plan" SET DEFAULT 'FREE';
DROP TYPE IF EXISTS "subscription_status";
DROP TYPE IF EXISTS "billing_plan";
