-- Sign-in provider accounts move from users.google_sub into their own table, so one user can have a
-- password, Google and Microsoft linked at the same time.

-- CreateEnum
CREATE TYPE "identity_provider" AS ENUM ('GOOGLE', 'MICROSOFT');

-- CreateTable
CREATE TABLE "user_identities" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" "identity_provider" NOT NULL,
    "provider_account_id" VARCHAR(255) NOT NULL,
    "email" VARCHAR(180),
    "linked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(3),

    CONSTRAINT "user_identities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_identities_provider_provider_account_id_key" ON "user_identities"("provider", "provider_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_identities_user_id_provider_key" ON "user_identities"("user_id", "provider");

-- AddForeignKey
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing Google links (Phase 7) become identities. The link date is not known; the account's creation date is used.
INSERT INTO "user_identities" ("id", "user_id", "provider", "provider_account_id", "email", "linked_at")
SELECT gen_random_uuid(), "id", 'GOOGLE', "google_sub", "email", "created_at" FROM "users" WHERE "google_sub" IS NOT NULL;

-- DropIndex
DROP INDEX "users_google_sub_key";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "google_sub";
