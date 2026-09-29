-- DropIndex
DROP INDEX "invitations_email_idx";

-- CreateIndex
CREATE INDEX "audit_log_user_id_idx" ON "audit_log"("user_id");

-- CreateIndex
CREATE INDEX "email_tokens_expires_at_idx" ON "email_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "invitations_email_accepted_at_revoked_at_idx" ON "invitations"("email", "accepted_at", "revoked_at");

-- CreateIndex
CREATE INDEX "rca_attachment_uploaded_by_idx" ON "rca_attachment"("uploaded_by");

-- CreateIndex
CREATE INDEX "rca_signoff_assignee_user_id_idx" ON "rca_signoff"("assignee_user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "support_grants_workspace_id_idx" ON "support_grants"("workspace_id");
