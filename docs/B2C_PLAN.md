# B2C plan: from internal tool to multi-tenant web app

This document is the Step 0 audit and the build plan. Decisions that are judgement calls are also recorded in
`docs/ASSUMPTIONS.md` under "B2C". The product spec for the B2C version is `docs/SPEC_B2C.md`.

## 1. What exists today

| Area | Today |
|---|---|
| Users | `users` table with a global `role` (ADMIN, PROJECT_OWNER, RCA_LEAD, DEV, QA, PROD, VIEWER) and `team`. Admin creates every account. |
| Auth | `POST /auth/login` (bcrypt, 8 h JWT in `Authorization` header, stored in `localStorage`), `GET /me`. No signup, refresh, logout, verification or reset. |
| Permissions | `src/lib/permissions.ts`: a role matrix called from each route (`ensure(can.x(user))`). The web app mirrors it in `src/lib/permissions.ts`. |
| Tenancy | None. Every logged-in user sees every RCA. |
| Masters | Global `companies` and `projects`, where a project has an `owner_user_id`. `rca.project_id`, `team_leader_id`, `prepared_by` and `reviewed_by` are user and project foreign keys. |
| RCA data | `rca` plus child tables (`rca_timeline`, `rca_team_section`, `rca_why`, `rca_action`, `rca_followup`, `rca_attachment`, `rca_signoff`) and `audit_log`, which is append-only via a trigger. `rca_number` is globally unique and comes from `rca_number_seq(year)`. |
| Workflow | DRAFT to IN_REVIEW to CLOSED and reopen. Section submit, lock and unlock. Optimistic locking with 409. Sign-off per fixed user role, team leads first. Close requires every action completed or moved to follow-ups. |
| Files | Local disk (`UPLOAD_DIR`), random names, 10 MB limit, allowed types. |
| Export | Shared export model feeding print HTML, PDF (Playwright `setContent`) and DOCX. CSV/XLSX list export and blank template. |
| UI | Login, Dashboard, RCA list, tabbed form, read-only view, print, My tasks, audit log, and admin masters. |
| Seed | Seven role users, a company, a project and two RCAs, run on every container start. |
| Ops | `docker-compose.yml` (db, api, web), Dockerfiles running as root, no CI, no health or readiness split, no helmet. |
| Tests | 99 Vitest API tests, 5 web unit tests, and 2 Playwright end-to-end tests. |

## 2. What must change

1. **Tenancy.** Every RCA belongs to a workspace, and every query on tenant data is scoped automatically, with no opt-in.
2. **Identity.** Global roles are removed. Access comes from workspace membership and RCA collaboration, and team assignment is per RCA. `is_platform_admin` is kept only for the operator.
3. **Auth.** Adds self-service signup, email verification, reset, refresh-token sessions, CSRF, rate limits, lockout, CAPTCHA hook, argon2id and email providers.
4. **Policy.** A single `can(ctx, action, resource)` module replaces `permissions.ts`. The server sends the evaluated permission flags with each RCA, so the web app stops mirroring role logic.
5. **Master data.** Companies and projects become free-text labels on the RCA with per-workspace suggestions. Project Owner, RCA Team Leader, Prepared by, Reviewed by, contributor and Verified by become text fields.
6. **Sign-off.** The 5 sign-off rows become labels the owner can assign to a person. Unassigned rows can be signed by an OWNER or EDITOR, so a solo user signs everything.
7. **Seed and demo data.** Demo data runs only when `NODE_ENV=development` and `SEED_DEMO=true`. A purge script removes it.
8. **Production.** Adds validated config, S3-compatible storage, quotas, helmet, strict CORS, structured logs, a sandboxed PDF renderer, health and readiness endpoints, graceful shutdown, non-root images, Caddy, CI, backups and a deploy guide.
9. **Lifecycle.** Adds data export, soft then hard account deletion, ownership transfer, a security-event log and legal pages.

## 3. New schema

New tables (all `snake_case`, UUID keys, timestamps):

| Table | Key columns |
|---|---|
| `workspaces` | `name`, `owner_id` (primary owner, the user whose quota is charged), `plan` (`FREE`, the extension point for billing), `is_personal` |
| `workspace_members` | `workspace_id`, `user_id`, `role` (OWNER, EDITOR, CONTRIBUTOR, VIEWER), `team` (for workspace-level CONTRIBUTOR; nullable), UNIQUE(workspace_id, user_id) |
| `rca_collaborators` | `rca_id`, `user_id`, `role`, `team` (nullable; required for CONTRIBUTOR), UNIQUE(rca_id, user_id) |
| `invitations` | `email`, `workspace_id` or `rca_id` (CHECK exactly one), `role`, `team`, `token_hash` (unique), `invited_by`, `expires_at`, `accepted_at`, `revoked_at` |
| `email_tokens` | `user_id`, `type` (VERIFY_EMAIL, RESET_PASSWORD, CHANGE_EMAIL), `token_hash` (unique), `new_email` (CHANGE_EMAIL only), `expires_at`, `used_at` |
| `refresh_tokens` | `user_id`, `family_id` (one login session), `token_hash` (unique), `expires_at`, `revoked_at`, `replaced_by_id`, `user_agent`, `last_used_at` |
| `usage_quotas` | `user_id` (PK), `storage_limit_bytes` and `rca_limit` (nullable overrides of the env defaults, the billing extension point), `storage_bytes_used` and `rca_count` (snapshot, recomputed in the quota module) |
| `support_grants` | `admin_user_id`, `workspace_id`, `reason`, `expires_at`. The audited "support access" action gives a platform admin time-limited read-only access. |

Changed tables:

- `users`: adds `email_verified_at`, `last_login_at`, `deleted_at`, `purge_after`, `is_platform_admin`, `failed_login_count`, `locked_until` and `google_sub` (Phase 7). Drops `role` and `team`.
- `rca`: adds `workspace_id` (NOT NULL, indexed) and the text fields `company_name`, `project_name`, `project_owner_name`, `team_leader_name`, `prepared_by_name` and `reviewed_by_name`. Drops `project_id`, `team_leader_id`, `prepared_by` and `reviewed_by`. The unique key becomes (`workspace_id`, `rca_number`), so numbers are per workspace and do not leak other tenants' volume. `rca_number_seq` is keyed by (`workspace_id`, `year`).
- `rca_team_section`: `contributor_id` becomes `contributor_name`, and `verified_by` becomes `verified_by_name`. `updated_by` is kept for "last edited by".
- `rca_signoff`: adds `assignee_user_id` (nullable). `user_id` is the person who signed.
- `audit_log`: adds `workspace_id` and `category` (`DATA` or `SECURITY`). Security events (login, password change, email change, invitation, export, delete) have `category = SECURITY` and `user_id` = the subject. The immutability trigger now allows exactly two things: nulling `user_id` (anonymisation) and deletes inside a transaction that sets `app.audit_purge = on` (hard-deleting a workspace or account).
- `companies` and `projects` are dropped after backfilling the text columns.

Child tables stay scoped through `rca_id` (derivable), so there is no denormalised `workspace_id` on them.

### Migration steps (`prisma/migrations/2026…_b2c_tenancy`)

The migration is written by hand and runs in one transaction:

1. Create the new tables and enums, and add the new nullable columns.
2. For every existing user, create a personal workspace ("{name}'s workspace") with an OWNER membership. Mark existing users as email-verified, because an admin created them.
3. For every existing company, create a shared workspace "{company}" owned by the first ADMIN (else the first PROJECT_OWNER, else the first user). Every existing user joins it with the role mapped from the old global role:

   | Old role | New workspace role |
   |---|---|
   | ADMIN, PROJECT_OWNER | OWNER |
   | RCA_LEAD | EDITOR |
   | DEV, QA, PROD | CONTRIBUTOR with the same team |
   | VIEWER | VIEWER |

   This keeps exactly the access people had.
4. Move each RCA into its company's workspace. Backfill the text fields from the old project, company and user rows, and renumber the sequence per workspace. Existing numbers are kept because they are unique within the new workspace.
5. Map the old sign-offs: `assignee_user_id` = the user who signed, if any.
6. Make `workspace_id` NOT NULL, drop the old foreign keys and columns, drop `companies`, `projects`, `users.role` and `users.team`, and replace the trigger.

**Reversibility:** `down.sql` in the same folder recreates the dropped tables, columns and roles and back-fills them from the text columns and memberships. Workspace OWNER maps to ADMIN and CONTRIBUTOR maps back to its team role. Then it drops the new tables. It is tested by `test/migration.test.ts`, which builds a database at the pre-B2C schema with legacy data, applies the up migration, checks the mapping, applies `down.sql`, and checks the legacy schema and data are back. A `pg_dump` before deploying remains the primary rollback (see `docs/DEPLOY.md`).

`scripts/purge-demo-data.ts` deletes the seeded demo users (`@rca.local`) and every workspace, RCA and file they own, including the migrated demo company workspace. It prints what it would delete and refuses to run without `--confirm`.

## 4. Permission model

The effective role on an RCA is the highest of:

- the user's `workspace_members.role` for the RCA's workspace;
- the user's `rca_collaborators.role` for the RCA;
- `VIEWER` while a platform admin has an active `support_grant` for the workspace.

A CONTRIBUTOR's teams are the union of the workspace-level `team` and the per-RCA collaborator `team`.

| Action | OWNER | EDITOR | CONTRIBUTOR | VIEWER |
|---|---|---|---|---|
| View RCA, print, PDF, DOCX | Y | Y | Y | Y |
| Create RCA in workspace (email verified, within quota) | Y | Y | - | - |
| Edit header, common, closing, timeline, follow-ups | Y | Y | timeline add only | - |
| Edit, submit or add actions to team section X | Y | Y | only if X is in their teams | - |
| Unlock a section, submit for review, send back, close, reopen | Y | Y | - | - |
| Sign a sign-off row | assigned to me, or unassigned | assigned to me, or unassigned | assigned to me | assigned to me |
| Assign sign-off rows | Y | Y | - | - |
| Upload attachment / delete own | Y | Y | Y | - |
| Delete any attachment | Y | Y | - | - |
| Soft-delete RCA | Y | - | - | - |
| View RCA change history | Y | Y | Y | Y |
| Invite, revoke, remove members or collaborators, change roles | Y (workspace) | - | - | - |
| Delete or rename workspace, transfer ownership | Y | - | - | - |

- **Visibility:** users with no role on an RCA get **404**, never 403. Users who can see the RCA but lack the action get 403.
- **State rules stay as in the spec:** header and common edits are blocked when CLOSED, sections lock on submit, versions give 409, and the review, close and reopen gates apply.
- **Solo relaxation:** an OWNER can act for every team and sign every unassigned row, so no second person is needed. The rule that team-lead rows are signed before the Project Owner and RCA Team Leader rows stays.
- **Implementation:** the policy lives in `apps/api/src/policy/`: `policy.ts` holds `can()` and the action list, and `access.ts` loads the membership context. Routes call `authorize(req, action, resource)` and hold no role logic.

### Tenant scoping (cannot be forgotten)

- `apps/api/src/tenancy/` exports a Prisma client extension. Every read or write on a tenant model (`rca`, `rcaTimeline`, `rcaTeamSection`, `rcaWhy`, `rcaAction`, `rcaFollowup`, `rcaAttachment`, `rcaSignoff`, `rcaCollaborator`, `auditLog`, `invitation`, `workspaceMember`) automatically gets the current user's visibility filter injected.
- The filter comes from an `AsyncLocalStorage` context that the auth middleware sets per request.
- A tenant query **outside** a request context throws. Background jobs, auth flows and scripts must opt out explicitly with `unscoped('reason', fn)`.
- Creates on child tables verify the parent RCA is visible.
- The isolation suite also checks every registered `/rcas/:id…` route against a coverage table, so a new endpoint without an isolation test fails CI.

## 5. Phases (adjusted)

The prompt's Phase 1 (schema) and Phase 3 (authorization) cannot be committed separately with passing tests: dropping the global roles removes what the old permission code depends on. They are therefore delivered together as Phase 1. The remaining phases keep their content and order.

| # | Phase | Content |
|---|---|---|
| 1 | **Schema, tenancy and authorization** | Prompt Phases 1 and 3: the new tables and migration (up and down, with test), the purge script, the tenancy extension, the policy module, all routes refactored, sign-off assignment, text labels, per-workspace numbering, the API returning `permissions` per RCA, the web app on server-evaluated permissions, a workspace switcher, and the **tenant-isolation suite**. |
| 2 | **Authentication** | Signup, verification, login, refresh rotation with reuse detection, logout and logout-all, forgot, reset and change password, email change, argon2id with legacy bcrypt rehash, common-password check, rate limits and lockout, Turnstile hook, email providers (console, SMTP, Resend) and templates, and `GET`/`PATCH /me`. |
| 3 | **Onboarding and UX** | Demo seed gated, landing and public pages, auth pages, onboarding (first or sample RCA), empty states, account settings (profile, password, sessions). |
| 4 | **Collaboration** | Invitations to a workspace or RCA (existing and new users), accept, revoke, members page, role changes, per-RCA contributors with a team, "last edited by", emails without RCA content. |
| 5 | **Production hardening** | Zod-validated env, storage interface (local and S3), quotas, helmet, CORS and limits, JSON logs, sandboxed PDF (one-time internal print URL, request allow-list, timeout, concurrency), `/healthz` and `/readyz`, graceful shutdown, pooling, non-root multi-stage images, `docker-compose.prod.yml` with Caddy, CI workflow, backup and restore scripts, index review, `docs/DEPLOY.md`. |
| 6 | **Compliance and lifecycle** | `DELETE /me` (soft, then hard after the grace period via a job), ownership-transfer rule, `GET /me/export` zip, security-event log in settings, Terms and Privacy placeholders, cookie notice (none needed: only essential cookies). |
| 7 | **Google sign-in** (optional) | OAuth code flow with PKCE. Links to an existing account only if Google reports `email_verified`. |

Every phase ends with lint, unit and API tests, the isolation suite and Playwright passing, then a commit.

## 6. Status

All seven phases are implemented and committed, one commit per phase, including the optional Google sign-in. See `README.md` for the test overview and `docs/DEPLOY.md` for hosting.
