-- Phase 8 billing (docs/BILLING_PLAN.md). Reverse with down.sql in this folder.
-- CreateEnum
CREATE TYPE "billing_plan" AS ENUM ('NONE', 'SOLO', 'TEAM');

-- CreateEnum
CREATE TYPE "subscription_status" AS ENUM ('NONE', 'ACTIVE', 'PAST_DUE', 'CANCELED');

-- AlterTable
ALTER TABLE "rca" ADD COLUMN     "paid_at" TIMESTAMPTZ(3),
ADD COLUMN     "payment_reference" VARCHAR(120);

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "current_period_end" TIMESTAMPTZ(3),
ADD COLUMN     "payment_customer_ref" VARCHAR(120),
ADD COLUMN     "seats" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "subscription_ref" VARCHAR(120),
ADD COLUMN     "subscription_status" "subscription_status" NOT NULL DEFAULT 'NONE';

-- plan: VARCHAR ('FREE') -> enum. Nobody had a paid plan before billing existed, so every value maps to NONE.
-- A paid plan is only ever set by a verified provider event, never by migration.
ALTER TABLE "workspaces" ALTER COLUMN "plan" DROP DEFAULT;
ALTER TABLE "workspaces" ALTER COLUMN "plan" TYPE "billing_plan" USING ('NONE'::"billing_plan");
ALTER TABLE "workspaces" ALTER COLUMN "plan" SET DEFAULT 'NONE';

-- CreateTable
CREATE TABLE "checkout_sessions" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(20) NOT NULL,
    "provider_session_id" VARCHAR(200),
    "kind" VARCHAR(20) NOT NULL,
    "workspace_id" UUID NOT NULL,
    "rca_id" UUID,
    "plan" "billing_plan",
    "seats" INTEGER,
    "amount_cents" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'OPEN',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "checkout_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_events" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(20) NOT NULL,
    "provider_event_id" VARCHAR(200) NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "payload" JSONB NOT NULL,
    "workspace_id" UUID,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),
    "result" VARCHAR(200),

    CONSTRAINT "billing_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_history" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "rca_id" UUID,
    "kind" VARCHAR(20) NOT NULL,
    "description" VARCHAR(200) NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "status" VARCHAR(10) NOT NULL,
    "reference" VARCHAR(200),
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "checkout_sessions_workspace_id_idx" ON "checkout_sessions"("workspace_id");

-- CreateIndex
CREATE INDEX "checkout_sessions_provider_provider_session_id_idx" ON "checkout_sessions"("provider", "provider_session_id");

-- CreateIndex
CREATE INDEX "billing_events_workspace_id_received_at_idx" ON "billing_events"("workspace_id", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "billing_events_provider_provider_event_id_key" ON "billing_events"("provider", "provider_event_id");

-- CreateIndex
CREATE INDEX "billing_history_workspace_id_occurred_at_idx" ON "billing_history"("workspace_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_rca_id_fkey" FOREIGN KEY ("rca_id") REFERENCES "rca"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_history" ADD CONSTRAINT "billing_history_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_history" ADD CONSTRAINT "billing_history_rca_id_fkey" FOREIGN KEY ("rca_id") REFERENCES "rca"("id") ON DELETE SET NULL ON UPDATE CASCADE;

