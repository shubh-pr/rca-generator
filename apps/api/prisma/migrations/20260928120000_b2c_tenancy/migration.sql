-- B2C multi-tenancy (docs/B2C_PLAN.md section 3). Reverse with down.sql in this folder.
-- Runs in one transaction under `prisma migrate deploy`.

-- The immutability trigger would block the audit_log backfill below; it is replaced at the end.
DROP TRIGGER IF EXISTS audit_log_no_update ON "audit_log";

-- ---------- 1. New enums and tables ----------
CREATE TYPE "workspace_role" AS ENUM ('OWNER', 'EDITOR', 'CONTRIBUTOR', 'VIEWER');
CREATE TYPE "email_token_type" AS ENUM ('VERIFY_EMAIL', 'RESET_PASSWORD', 'CHANGE_EMAIL');

CREATE TABLE "workspaces" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "owner_id" UUID NOT NULL,
    "plan" VARCHAR(20) NOT NULL DEFAULT 'FREE',
    "is_personal" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workspace_members" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "workspace_role" NOT NULL,
    "team" "team",
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rca_collaborators" (
    "id" UUID NOT NULL,
    "rca_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "workspace_role" NOT NULL,
    "team" "team",
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "rca_collaborators_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "rca_collaborators_contributor_team_check" CHECK ("role" <> 'CONTRIBUTOR' OR "team" IS NOT NULL)
);

CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "email" VARCHAR(180) NOT NULL,
    "workspace_id" UUID,
    "rca_id" UUID,
    "role" "workspace_role" NOT NULL,
    "team" "team",
    "token_hash" VARCHAR(64) NOT NULL,
    "invited_by" UUID,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "accepted_by" UUID,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "invitations_target_check" CHECK (("workspace_id" IS NULL) <> ("rca_id" IS NULL))
);

CREATE TABLE "email_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "email_token_type" NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "new_email" VARCHAR(180),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "email_tokens_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "replaced_by_id" UUID,
    "user_agent" VARCHAR(255),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(3),
    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "usage_quotas" (
    "user_id" UUID NOT NULL,
    "storage_limit_bytes" BIGINT,
    "rca_limit" INTEGER,
    "storage_bytes_used" BIGINT NOT NULL DEFAULT 0,
    "rca_count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "usage_quotas_pkey" PRIMARY KEY ("user_id")
);

CREATE TABLE "support_grants" (
    "id" UUID NOT NULL,
    "admin_user_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "support_grants_pkey" PRIMARY KEY ("id")
);

-- ---------- 2. New nullable columns ----------
ALTER TABLE "users"
    ADD COLUMN "deleted_at" TIMESTAMPTZ(3),
    ADD COLUMN "email_verified_at" TIMESTAMPTZ(3),
    ADD COLUMN "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "google_sub" VARCHAR(255),
    ADD COLUMN "is_platform_admin" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "last_login_at" TIMESTAMPTZ(3),
    ADD COLUMN "locked_until" TIMESTAMPTZ(3),
    ADD COLUMN "onboarded_at" TIMESTAMPTZ(3),
    ADD COLUMN "purge_after" TIMESTAMPTZ(3),
    ALTER COLUMN "password_hash" DROP NOT NULL,
    ALTER COLUMN "password_hash" SET DATA TYPE VARCHAR(200);

ALTER TABLE "rca"
    ADD COLUMN "workspace_id" UUID,
    ADD COLUMN "company_name" VARCHAR(150),
    ADD COLUMN "project_name" VARCHAR(150),
    ADD COLUMN "project_owner_name" VARCHAR(120),
    ADD COLUMN "team_leader_name" VARCHAR(120),
    ADD COLUMN "prepared_by_name" VARCHAR(120),
    ADD COLUMN "reviewed_by_name" VARCHAR(120),
    ADD COLUMN "is_sample" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "rca_team_section"
    ADD COLUMN "contributor_name" VARCHAR(120),
    ADD COLUMN "verified_by_name" VARCHAR(120);

ALTER TABLE "rca_signoff" ADD COLUMN "assignee_user_id" UUID;

ALTER TABLE "audit_log"
    ADD COLUMN "category" VARCHAR(10) NOT NULL DEFAULT 'DATA',
    ADD COLUMN "workspace_id" UUID,
    ALTER COLUMN "action" SET DATA TYPE VARCHAR(30);

-- ---------- 3. Backfill existing data ----------

-- 3a. Every existing user gets a personal workspace and is treated as verified (an admin created them).
INSERT INTO "workspaces" ("id", "name", "owner_id", "is_personal", "created_at", "updated_at")
SELECT gen_random_uuid(), LEFT(u."name" || '''s workspace', 120), u."id", true, u."created_at", now()
FROM "users" u;

INSERT INTO "workspace_members" ("id", "workspace_id", "user_id", "role", "created_at", "updated_at")
SELECT gen_random_uuid(), w."id", w."owner_id", 'OWNER', now(), now()
FROM "workspaces" w WHERE w."is_personal";

UPDATE "users" SET "email_verified_at" = "created_at";

-- 3b. Each company becomes a shared workspace owned by the first ADMIN (else PROJECT_OWNER, else any user).
CREATE TEMP TABLE "_company_ws" ON COMMIT DROP AS
SELECT c."id" AS "company_id", gen_random_uuid() AS "workspace_id", c."name" AS "name"
FROM "companies" c
WHERE EXISTS (SELECT 1 FROM "users");

INSERT INTO "workspaces" ("id", "name", "owner_id", "is_personal", "created_at", "updated_at")
SELECT cw."workspace_id", LEFT(cw."name", 120),
       (SELECT u."id" FROM "users" u
        ORDER BY CASE u."role" WHEN 'ADMIN' THEN 0 WHEN 'PROJECT_OWNER' THEN 1 ELSE 2 END, u."created_at"
        LIMIT 1),
       false, now(), now()
FROM "_company_ws" cw;

-- Active users join with their old global role mapped, so everyone keeps the access they had.
INSERT INTO "workspace_members" ("id", "workspace_id", "user_id", "role", "team", "created_at", "updated_at")
SELECT gen_random_uuid(), cw."workspace_id", u."id",
       (CASE u."role"
          WHEN 'ADMIN' THEN 'OWNER'
          WHEN 'PROJECT_OWNER' THEN 'OWNER'
          WHEN 'RCA_LEAD' THEN 'EDITOR'
          WHEN 'VIEWER' THEN 'VIEWER'
          ELSE 'CONTRIBUTOR'
        END)::"workspace_role",
       CASE WHEN u."role" IN ('DEV', 'QA', 'PROD') THEN u."team" END,
       now(), now()
FROM "_company_ws" cw CROSS JOIN "users" u
WHERE u."is_active"
   OR u."id" = (SELECT w."owner_id" FROM "workspaces" w WHERE w."id" = cw."workspace_id");

-- 3c. RCAs move into their company's workspace; user/project references become text labels.
UPDATE "rca" r SET
    "workspace_id" = cw."workspace_id",
    "company_name" = c."name",
    "project_name" = p."name",
    "project_owner_name" = (SELECT u."name" FROM "users" u WHERE u."id" = p."owner_user_id"),
    "team_leader_name" = (SELECT u."name" FROM "users" u WHERE u."id" = r."team_leader_id"),
    "prepared_by_name" = (SELECT u."name" FROM "users" u WHERE u."id" = r."prepared_by"),
    "reviewed_by_name" = (SELECT u."name" FROM "users" u WHERE u."id" = r."reviewed_by")
FROM "projects" p
JOIN "companies" c ON c."id" = p."company_id"
JOIN "_company_ws" cw ON cw."company_id" = c."id"
WHERE p."id" = r."project_id";

UPDATE "rca_team_section" s SET
    "contributor_name" = (SELECT u."name" FROM "users" u WHERE u."id" = s."contributor_id"),
    "verified_by_name" = (SELECT u."name" FROM "users" u WHERE u."id" = s."verified_by");

-- Whoever signed an existing sign-off is recorded as its assignee.
UPDATE "rca_signoff" SET "assignee_user_id" = "user_id" WHERE "user_id" IS NOT NULL;

-- Audit rows of an RCA get its workspace.
UPDATE "audit_log" a SET "workspace_id" = r."workspace_id" FROM "rca" r WHERE r."id" = a."rca_id";

-- 3d. The number counter becomes per workspace and year.
ALTER TABLE "rca_number_seq" DROP CONSTRAINT "rca_number_seq_pkey";
DELETE FROM "rca_number_seq";
ALTER TABLE "rca_number_seq" ADD COLUMN "workspace_id" UUID NOT NULL;
ALTER TABLE "rca_number_seq" ADD CONSTRAINT "rca_number_seq_pkey" PRIMARY KEY ("workspace_id", "year");
INSERT INTO "rca_number_seq" ("workspace_id", "year", "last_value")
SELECT "workspace_id", split_part("rca_number", '-', 2)::int, MAX(split_part("rca_number", '-', 3)::int)
FROM "rca"
WHERE "rca_number" ~ '^RCA-[0-9]{4}-[0-9]+$'
GROUP BY "workspace_id", split_part("rca_number", '-', 2)::int;

-- ---------- 4. Drop the old structures ----------
ALTER TABLE "rca" DROP CONSTRAINT "rca_prepared_by_fkey";
ALTER TABLE "rca" DROP CONSTRAINT "rca_project_id_fkey";
ALTER TABLE "rca" DROP CONSTRAINT "rca_reviewed_by_fkey";
ALTER TABLE "rca" DROP CONSTRAINT "rca_team_leader_id_fkey";
ALTER TABLE "rca_team_section" DROP CONSTRAINT "rca_team_section_contributor_id_fkey";
ALTER TABLE "rca_team_section" DROP CONSTRAINT "rca_team_section_verified_by_fkey";
DROP INDEX "rca_project_id_idx";
DROP INDEX "rca_rca_number_key";

ALTER TABLE "rca"
    DROP COLUMN "prepared_by",
    DROP COLUMN "project_id",
    DROP COLUMN "reviewed_by",
    DROP COLUMN "team_leader_id",
    ALTER COLUMN "workspace_id" SET NOT NULL;

ALTER TABLE "rca_team_section" DROP COLUMN "contributor_id", DROP COLUMN "verified_by";
ALTER TABLE "users" DROP COLUMN "role", DROP COLUMN "team";
DROP TABLE "projects";
DROP TABLE "companies";
DROP TYPE "user_role";

-- ---------- 5. Indexes and foreign keys ----------
CREATE INDEX "workspaces_owner_id_idx" ON "workspaces"("owner_id");
CREATE INDEX "workspace_members_user_id_idx" ON "workspace_members"("user_id");
CREATE UNIQUE INDEX "workspace_members_workspace_id_user_id_key" ON "workspace_members"("workspace_id", "user_id");
CREATE INDEX "rca_collaborators_user_id_idx" ON "rca_collaborators"("user_id");
CREATE UNIQUE INDEX "rca_collaborators_rca_id_user_id_key" ON "rca_collaborators"("rca_id", "user_id");
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");
CREATE INDEX "invitations_email_idx" ON "invitations"("email");
CREATE INDEX "invitations_workspace_id_idx" ON "invitations"("workspace_id");
CREATE INDEX "invitations_rca_id_idx" ON "invitations"("rca_id");
CREATE UNIQUE INDEX "email_tokens_token_hash_key" ON "email_tokens"("token_hash");
CREATE INDEX "email_tokens_user_id_type_idx" ON "email_tokens"("user_id", "type");
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");
CREATE INDEX "support_grants_admin_user_id_expires_at_idx" ON "support_grants"("admin_user_id", "expires_at");
CREATE INDEX "audit_log_workspace_id_at_idx" ON "audit_log"("workspace_id", "at");
CREATE INDEX "audit_log_category_user_id_at_idx" ON "audit_log"("category", "user_id", "at");
CREATE INDEX "rca_workspace_id_is_deleted_rca_date_idx" ON "rca"("workspace_id", "is_deleted", "rca_date");
CREATE INDEX "rca_workspace_id_status_idx" ON "rca"("workspace_id", "status");
CREATE UNIQUE INDEX "rca_workspace_id_rca_number_key" ON "rca"("workspace_id", "rca_number");
CREATE UNIQUE INDEX "users_google_sub_key" ON "users"("google_sub");

ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rca_collaborators" ADD CONSTRAINT "rca_collaborators_rca_id_fkey" FOREIGN KEY ("rca_id") REFERENCES "rca"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rca_collaborators" ADD CONSTRAINT "rca_collaborators_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_rca_id_fkey" FOREIGN KEY ("rca_id") REFERENCES "rca"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "email_tokens" ADD CONSTRAINT "email_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "usage_quotas" ADD CONSTRAINT "usage_quotas_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_grants" ADD CONSTRAINT "support_grants_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_grants" ADD CONSTRAINT "support_grants_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rca" ADD CONSTRAINT "rca_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rca_signoff" ADD CONSTRAINT "rca_signoff_assignee_user_id_fkey" FOREIGN KEY ("assignee_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------- 6. Audit immutability with two narrow exceptions ----------
-- (a) anonymising a deleted user: only user_id may change, and only to NULL;
-- (b) the account/workspace purge job, which sets `app.audit_purge = on` for its own transaction.
CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.audit_purge', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD."user_id" IS NOT NULL AND NEW."user_id" IS NULL
     AND NEW."id" = OLD."id" AND NEW."entity" = OLD."entity" AND NEW."entity_id" = OLD."entity_id"
     AND NEW."rca_id" IS NOT DISTINCT FROM OLD."rca_id"
     AND NEW."workspace_id" IS NOT DISTINCT FROM OLD."workspace_id"
     AND NEW."category" = OLD."category" AND NEW."action" = OLD."action"
     AND NEW."old_value" IS NOT DISTINCT FROM OLD."old_value"
     AND NEW."new_value" IS NOT DISTINCT FROM OLD."new_value"
     AND NEW."at" = OLD."at" THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'audit_log rows cannot be modified';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
