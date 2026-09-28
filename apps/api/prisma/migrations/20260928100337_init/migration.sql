-- CreateEnum
CREATE TYPE "severity" AS ENUM ('P1', 'P2', 'P3', 'P4');

-- CreateEnum
CREATE TYPE "environment" AS ENUM ('PROD', 'UAT', 'STAGING');

-- CreateEnum
CREATE TYPE "rca_status" AS ENUM ('DRAFT', 'IN_REVIEW', 'CLOSED');

-- CreateEnum
CREATE TYPE "team" AS ENUM ('DEV', 'QA', 'PROD');

-- CreateEnum
CREATE TYPE "section_status" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED');

-- CreateEnum
CREATE TYPE "cause_category" AS ENUM ('CODE_DEFECT', 'CONFIG', 'REQUIREMENT_GAP', 'TEST_GAP', 'DEPLOYMENT', 'INFRA', 'THIRD_PARTY', 'DATA');

-- CreateEnum
CREATE TYPE "action_status" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "completion_status" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "detection_method" AS ENUM ('MONITORING', 'CLIENT_REPORT', 'QA', 'OTHER');

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('ADMIN', 'PROJECT_OWNER', 'RCA_LEAD', 'DEV', 'QA', 'PROD', 'VIEWER');

-- CreateEnum
CREATE TYPE "signoff_role" AS ENUM ('PROJECT_OWNER', 'RCA_LEAD', 'DEV_LEAD', 'QA_LEAD', 'PROD_LEAD');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(180) NOT NULL,
    "password_hash" VARCHAR(100) NOT NULL,
    "role" "user_role" NOT NULL,
    "team" "team",
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rca" (
    "id" UUID NOT NULL,
    "rca_number" VARCHAR(20) NOT NULL,
    "rca_date" DATE NOT NULL,
    "project_id" UUID NOT NULL,
    "team_leader_id" UUID NOT NULL,
    "ticket_id" VARCHAR(60),
    "severity" "severity" NOT NULL,
    "environment" "environment" NOT NULL,
    "status" "rca_status" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "incident_start" TIMESTAMPTZ(3) NOT NULL,
    "detected_at" TIMESTAMPTZ(3),
    "resolved_at" TIMESTAMPTZ(3),
    "prepared_by" UUID,
    "reviewed_by" UUID,
    "summary" TEXT NOT NULL,
    "impact_users" TEXT,
    "impact_duration" VARCHAR(80),
    "impact_data_revenue" TEXT,
    "sla_breached" BOOLEAN NOT NULL DEFAULT false,
    "detection_method" "detection_method",
    "immediate_fix" TEXT,
    "immediate_fix_by" VARCHAR(120),
    "lessons_well" TEXT,
    "lessons_not_well" TEXT,
    "lessons_key" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "closed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "rca_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rca_number_seq" (
    "year" INTEGER NOT NULL,
    "last_value" INTEGER NOT NULL,

    CONSTRAINT "rca_number_seq_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "rca_timeline" (
    "id" UUID NOT NULL,
    "rca_id" UUID NOT NULL,
    "event_time" TIMESTAMPTZ(3) NOT NULL,
    "event" TEXT NOT NULL,
    "team_or_person" VARCHAR(120),
    "sort_order" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "rca_timeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rca_team_section" (
    "id" UUID NOT NULL,
    "rca_id" UUID NOT NULL,
    "team" "team" NOT NULL,
    "contributor_id" UUID,
    "cause_category" "cause_category",
    "escape_analysis" TEXT,
    "extra_1" TEXT,
    "extra_2" TEXT,
    "prev_process" TEXT,
    "prev_automation" TEXT,
    "prev_owner_date" VARCHAR(160),
    "target_date" DATE,
    "actual_date" DATE,
    "completion_status" "completion_status" NOT NULL DEFAULT 'NOT_STARTED',
    "verified_by" UUID,
    "section_status" "section_status" NOT NULL DEFAULT 'NOT_STARTED',
    "submitted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "rca_team_section_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rca_why" (
    "id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "why_no" SMALLINT NOT NULL,
    "answer" TEXT,

    CONSTRAINT "rca_why_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rca_action" (
    "id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "seq" INTEGER,
    "action" TEXT NOT NULL,
    "owner_id" UUID NOT NULL,
    "due_date" DATE NOT NULL,
    "status" "action_status" NOT NULL DEFAULT 'NOT_STARTED',
    "completed_on" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "rca_action_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rca_followup" (
    "id" UUID NOT NULL,
    "rca_id" UUID NOT NULL,
    "risk" TEXT NOT NULL,
    "owner_id" UUID,
    "due_date" DATE,
    "action_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "rca_followup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rca_attachment" (
    "id" UUID NOT NULL,
    "rca_id" UUID NOT NULL,
    "description" VARCHAR(255),
    "kind" VARCHAR(10) NOT NULL,
    "file_path" TEXT,
    "url" TEXT,
    "file_name" VARCHAR(255),
    "mime" VARCHAR(120),
    "size" INTEGER,
    "uploaded_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rca_attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rca_signoff" (
    "id" UUID NOT NULL,
    "rca_id" UUID NOT NULL,
    "role" "signoff_role" NOT NULL,
    "user_id" UUID,
    "signed_at" TIMESTAMPTZ(3),
    "comment" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rca_signoff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "entity" VARCHAR(40) NOT NULL,
    "entity_id" UUID NOT NULL,
    "rca_id" UUID,
    "action" VARCHAR(20) NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB,
    "user_id" UUID,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "companies_name_key" ON "companies"("name");

-- CreateIndex
CREATE UNIQUE INDEX "projects_company_id_name_key" ON "projects"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "rca_rca_number_key" ON "rca"("rca_number");

-- CreateIndex
CREATE INDEX "rca_status_idx" ON "rca"("status");

-- CreateIndex
CREATE INDEX "rca_project_id_idx" ON "rca"("project_id");

-- CreateIndex
CREATE INDEX "rca_rca_date_idx" ON "rca"("rca_date");

-- CreateIndex
CREATE INDEX "rca_severity_idx" ON "rca"("severity");

-- CreateIndex
CREATE INDEX "rca_timeline_rca_id_idx" ON "rca_timeline"("rca_id");

-- CreateIndex
CREATE UNIQUE INDEX "rca_team_section_rca_id_team_key" ON "rca_team_section"("rca_id", "team");

-- CreateIndex
CREATE UNIQUE INDEX "rca_why_section_id_why_no_key" ON "rca_why"("section_id", "why_no");

-- CreateIndex
CREATE INDEX "rca_action_owner_id_status_due_date_idx" ON "rca_action"("owner_id", "status", "due_date");

-- CreateIndex
CREATE INDEX "rca_action_section_id_idx" ON "rca_action"("section_id");

-- CreateIndex
CREATE UNIQUE INDEX "rca_followup_action_id_key" ON "rca_followup"("action_id");

-- CreateIndex
CREATE INDEX "rca_followup_rca_id_idx" ON "rca_followup"("rca_id");

-- CreateIndex
CREATE INDEX "rca_attachment_rca_id_idx" ON "rca_attachment"("rca_id");

-- CreateIndex
CREATE UNIQUE INDEX "rca_signoff_rca_id_role_key" ON "rca_signoff"("rca_id", "role");

-- CreateIndex
CREATE INDEX "audit_log_rca_id_at_idx" ON "audit_log"("rca_id", "at");

-- CreateIndex
CREATE INDEX "audit_log_user_id_at_idx" ON "audit_log"("user_id", "at");

-- CreateIndex
CREATE INDEX "audit_log_at_idx" ON "audit_log"("at");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rca" ADD CONSTRAINT "rca_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rca" ADD CONSTRAINT "rca_team_leader_id_fkey" FOREIGN KEY ("team_leader_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rca" ADD CONSTRAINT "rca_prepared_by_fkey" FOREIGN KEY ("prepared_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rca" ADD CONSTRAINT "rca_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rca" ADD CONSTRAINT "rca_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rca" ADD CONSTRAINT "rca_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rca_timeline" ADD CONSTRAINT "rca_timeline_rca_id_fkey" FOREIGN KEY ("rca_id") REFERENCES "rca"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rca_timeline" ADD CONSTRAINT "rca_timeline_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rca_team_section" ADD CONSTRAINT "rca_team_section_rca_id_fkey" FOREIGN KEY ("rca_id") REFERENCES "rca"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rca_team_section" ADD CONSTRAINT "rca_team_section_contributor_id_fkey" FOREIGN KEY ("contributor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rca_team_section" ADD CONSTRAINT "rca_team_section_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rca_team_section" ADD CONSTRAINT "rca_team_section_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rca_why" ADD CONSTRAINT "rca_why_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "rca_team_section"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rca_action" ADD CONSTRAINT "rca_action_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "rca_team_section"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rca_action" ADD CONSTRAINT "rca_action_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rca_action" ADD CONSTRAINT "rca_action_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rca_followup" ADD CONSTRAINT "rca_followup_rca_id_fkey" FOREIGN KEY ("rca_id") REFERENCES "rca"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rca_followup" ADD CONSTRAINT "rca_followup_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rca_followup" ADD CONSTRAINT "rca_followup_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rca_followup" ADD CONSTRAINT "rca_followup_action_id_fkey" FOREIGN KEY ("action_id") REFERENCES "rca_action"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rca_attachment" ADD CONSTRAINT "rca_attachment_rca_id_fkey" FOREIGN KEY ("rca_id") REFERENCES "rca"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rca_attachment" ADD CONSTRAINT "rca_attachment_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rca_signoff" ADD CONSTRAINT "rca_signoff_rca_id_fkey" FOREIGN KEY ("rca_id") REFERENCES "rca"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rca_signoff" ADD CONSTRAINT "rca_signoff_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_rca_id_fkey" FOREIGN KEY ("rca_id") REFERENCES "rca"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------- Constraints Prisma cannot express ----------

-- rca_why.why_no CHECK 1..5 (spec 4.7)
ALTER TABLE "rca_why" ADD CONSTRAINT "rca_why_why_no_check" CHECK ("why_no" BETWEEN 1 AND 5);

-- rca_attachment.kind is FILE or LINK (spec 4.8)
ALTER TABLE "rca_attachment" ADD CONSTRAINT "rca_attachment_kind_check" CHECK ("kind" IN ('FILE', 'LINK'));

-- Audit rows cannot be edited or deleted (spec 8, Audit)
CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log rows cannot be modified';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
