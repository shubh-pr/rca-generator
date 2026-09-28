-- Reverse of migration.sql (B2C multi-tenancy). Best-effort data restore; a pg_dump taken before the
-- up migration is the primary rollback (docs/DEPLOY.md). Run inside a transaction:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f down.sql
-- then: DELETE FROM _prisma_migrations WHERE migration_name = '20260928120000_b2c_tenancy';

DROP TRIGGER IF EXISTS audit_log_no_update ON "audit_log";

-- ---------- 1. Global roles back on users ----------
CREATE TYPE "user_role" AS ENUM ('ADMIN', 'PROJECT_OWNER', 'RCA_LEAD', 'DEV', 'QA', 'PROD', 'VIEWER');
ALTER TABLE "users" ADD COLUMN "role" "user_role", ADD COLUMN "team" "team";

-- Highest role across shared (non-personal) workspaces; users with only a personal workspace become PROJECT_OWNER.
WITH ranked AS (
  SELECT m."user_id", m."role", m."team",
         ROW_NUMBER() OVER (PARTITION BY m."user_id"
                            ORDER BY CASE m."role" WHEN 'OWNER' THEN 0 WHEN 'EDITOR' THEN 1 WHEN 'CONTRIBUTOR' THEN 2 ELSE 3 END) AS rn
  FROM "workspace_members" m JOIN "workspaces" w ON w."id" = m."workspace_id"
  WHERE NOT w."is_personal"
)
UPDATE "users" u SET
  "role" = (CASE r."role"
              WHEN 'OWNER' THEN 'ADMIN'
              WHEN 'EDITOR' THEN 'RCA_LEAD'
              WHEN 'VIEWER' THEN 'VIEWER'
              ELSE COALESCE(r."team"::text, 'DEV')
            END)::"user_role",
  "team" = CASE WHEN r."role" = 'CONTRIBUTOR' THEN COALESCE(r."team", 'DEV') END
FROM ranked r WHERE r."user_id" = u."id" AND r.rn = 1;
UPDATE "users" SET "role" = 'PROJECT_OWNER' WHERE "role" IS NULL;
UPDATE "users" SET "password_hash" = '!' WHERE "password_hash" IS NULL;
ALTER TABLE "users" ALTER COLUMN "role" SET NOT NULL, ALTER COLUMN "password_hash" SET NOT NULL;

-- ---------- 2. Companies and projects rebuilt from the text labels ----------
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

CREATE TEMP TABLE "_co" ON COMMIT DROP AS
SELECT gen_random_uuid() AS "id", x."company_name"
FROM (SELECT DISTINCT COALESCE(NULLIF(r."company_name", ''), w."name") AS "company_name"
      FROM "rca" r JOIN "workspaces" w ON w."id" = r."workspace_id") x;
INSERT INTO "companies" ("id", "name", "updated_at") SELECT "id", LEFT("company_name", 150), now() FROM "_co";

CREATE TEMP TABLE "_pr" ON COMMIT DROP AS
SELECT gen_random_uuid() AS "id", c."id" AS "company_id", x."company_name", x."project_name", x."owner_id"
FROM (SELECT DISTINCT COALESCE(NULLIF(r."company_name", ''), w."name") AS "company_name",
                      COALESCE(NULLIF(r."project_name", ''), 'General') AS "project_name",
                      w."owner_id"
      FROM "rca" r JOIN "workspaces" w ON w."id" = r."workspace_id") x
JOIN "_co" c ON c."company_name" = x."company_name";
INSERT INTO "projects" ("id", "company_id", "name", "owner_user_id", "updated_at")
SELECT "id", "company_id", LEFT("project_name", 150), "owner_id", now() FROM "_pr";

-- ---------- 3. RCA references ----------
ALTER TABLE "rca"
  ADD COLUMN "project_id" UUID,
  ADD COLUMN "team_leader_id" UUID,
  ADD COLUMN "prepared_by" UUID,
  ADD COLUMN "reviewed_by" UUID;

UPDATE "rca" r SET
  "project_id" = p."id",
  "team_leader_id" = COALESCE((SELECT u."id" FROM "users" u WHERE u."name" = r."team_leader_name" LIMIT 1), w."owner_id"),
  "prepared_by" = (SELECT u."id" FROM "users" u WHERE u."name" = r."prepared_by_name" LIMIT 1),
  "reviewed_by" = (SELECT u."id" FROM "users" u WHERE u."name" = r."reviewed_by_name" LIMIT 1)
FROM "workspaces" w, "_pr" p
WHERE w."id" = r."workspace_id"
  AND p."company_name" = COALESCE(NULLIF(r."company_name", ''), w."name")
  AND p."project_name" = COALESCE(NULLIF(r."project_name", ''), 'General')
  AND p."owner_id" = w."owner_id";

-- Numbers were unique per workspace; make them globally unique again by renumbering later duplicates.
WITH dups AS (
  SELECT "id", split_part("rca_number", '-', 2) AS yr,
         ROW_NUMBER() OVER (PARTITION BY "rca_number" ORDER BY "created_at", "id") AS rn
  FROM "rca"
), maxes AS (
  SELECT split_part("rca_number", '-', 2) AS yr, MAX(split_part("rca_number", '-', 3)::int) AS mx
  FROM "rca" WHERE "rca_number" ~ '^RCA-[0-9]{4}-[0-9]+$' GROUP BY 1
), renum AS (
  SELECT d."id", d.yr, m.mx + ROW_NUMBER() OVER (PARTITION BY d.yr ORDER BY d."id") AS n
  FROM dups d JOIN maxes m ON m.yr = d.yr WHERE d.rn > 1
)
UPDATE "rca" r SET "rca_number" = 'RCA-' || renum.yr || '-' || LPAD(renum.n::text, 4, '0')
FROM renum WHERE renum."id" = r."id";

DROP INDEX IF EXISTS "rca_workspace_id_rca_number_key";
DROP INDEX IF EXISTS "rca_workspace_id_is_deleted_rca_date_idx";
DROP INDEX IF EXISTS "rca_workspace_id_status_idx";
ALTER TABLE "rca" DROP CONSTRAINT IF EXISTS "rca_workspace_id_fkey";
ALTER TABLE "rca"
  ALTER COLUMN "project_id" SET NOT NULL,
  ALTER COLUMN "team_leader_id" SET NOT NULL,
  DROP COLUMN "workspace_id",
  DROP COLUMN "company_name",
  DROP COLUMN "project_name",
  DROP COLUMN "project_owner_name",
  DROP COLUMN "team_leader_name",
  DROP COLUMN "prepared_by_name",
  DROP COLUMN "reviewed_by_name",
  DROP COLUMN "is_sample";
CREATE UNIQUE INDEX "rca_rca_number_key" ON "rca"("rca_number");
CREATE INDEX "rca_project_id_idx" ON "rca"("project_id");

ALTER TABLE "rca_team_section" ADD COLUMN "contributor_id" UUID, ADD COLUMN "verified_by" UUID;
UPDATE "rca_team_section" s SET
  "contributor_id" = (SELECT u."id" FROM "users" u WHERE u."name" = s."contributor_name" LIMIT 1),
  "verified_by" = (SELECT u."id" FROM "users" u WHERE u."name" = s."verified_by_name" LIMIT 1);
ALTER TABLE "rca_team_section" DROP COLUMN "contributor_name", DROP COLUMN "verified_by_name";

ALTER TABLE "rca_signoff" DROP CONSTRAINT IF EXISTS "rca_signoff_assignee_user_id_fkey";
ALTER TABLE "rca_signoff" DROP COLUMN "assignee_user_id";

-- Yearly counter back to global.
CREATE TEMP TABLE "_seq" ON COMMIT DROP AS
SELECT split_part("rca_number", '-', 2)::int AS "year", MAX(split_part("rca_number", '-', 3)::int) AS "last_value"
FROM "rca" WHERE "rca_number" ~ '^RCA-[0-9]{4}-[0-9]+$' GROUP BY 1;
DROP TABLE "rca_number_seq";
CREATE TABLE "rca_number_seq" ("year" INTEGER NOT NULL, "last_value" INTEGER NOT NULL, CONSTRAINT "rca_number_seq_pkey" PRIMARY KEY ("year"));
INSERT INTO "rca_number_seq" SELECT "year", "last_value" FROM "_seq";

-- ---------- 4. Foreign keys of the legacy schema ----------
ALTER TABLE "projects" ADD CONSTRAINT "projects_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "companies_name_key" ON "companies"("name");
CREATE UNIQUE INDEX "projects_company_id_name_key" ON "projects"("company_id", "name");
ALTER TABLE "rca" ADD CONSTRAINT "rca_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rca" ADD CONSTRAINT "rca_team_leader_id_fkey" FOREIGN KEY ("team_leader_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rca" ADD CONSTRAINT "rca_prepared_by_fkey" FOREIGN KEY ("prepared_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "rca" ADD CONSTRAINT "rca_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "rca_team_section" ADD CONSTRAINT "rca_team_section_contributor_id_fkey" FOREIGN KEY ("contributor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "rca_team_section" ADD CONSTRAINT "rca_team_section_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------- 5. Audit log and users back to the legacy shape ----------
ALTER TABLE "audit_log" DROP CONSTRAINT IF EXISTS "audit_log_workspace_id_fkey";
DROP INDEX IF EXISTS "audit_log_workspace_id_at_idx";
DROP INDEX IF EXISTS "audit_log_category_user_id_at_idx";
ALTER TABLE "audit_log" DROP COLUMN "workspace_id", DROP COLUMN "category";

DROP INDEX IF EXISTS "users_google_sub_key";
ALTER TABLE "users"
  DROP COLUMN "deleted_at", DROP COLUMN "email_verified_at", DROP COLUMN "failed_login_count",
  DROP COLUMN "google_sub", DROP COLUMN "is_platform_admin", DROP COLUMN "last_login_at",
  DROP COLUMN "locked_until", DROP COLUMN "onboarded_at", DROP COLUMN "purge_after";

-- ---------- 6. Drop the B2C tables ----------
DROP TABLE "support_grants";
DROP TABLE "usage_quotas";
DROP TABLE "refresh_tokens";
DROP TABLE "email_tokens";
DROP TABLE "invitations";
DROP TABLE "rca_collaborators";
DROP TABLE "workspace_members";
DROP TABLE "workspaces";
DROP TYPE "email_token_type";
DROP TYPE "workspace_role";

-- ---------- 7. Original immutability trigger ----------
CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log rows cannot be modified';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
