-- Reverse of 20261001090000_user_identities. Google identities go back to users.google_sub.
-- Microsoft identities have no place in the old schema: the script stops if any exist, so they are not
-- lost silently (unlink them, or accept the loss by deleting those rows first).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "user_identities" WHERE "provider" = 'MICROSOFT') THEN
    RAISE EXCEPTION 'user_identities has MICROSOFT rows; the previous schema cannot hold them';
  END IF;
END $$;

ALTER TABLE "users" ADD COLUMN "google_sub" VARCHAR(255);
UPDATE "users" u SET "google_sub" = i."provider_account_id" FROM "user_identities" i WHERE i."user_id" = u."id" AND i."provider" = 'GOOGLE';
CREATE UNIQUE INDEX "users_google_sub_key" ON "users"("google_sub");

DROP TABLE "user_identities";
DROP TYPE "identity_provider";
