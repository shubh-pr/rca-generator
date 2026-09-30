# Assumptions and decisions

Where the spec (`docs/SPEC.md`) was silent or ambiguous I took the simplest reasonable option and recorded it here.

## Decisions given by the product owner (Section 10 open questions)

- **Login:** local email + password accounts, bcrypt (`bcryptjs`) hashes, JWT bearer access token (8 h). All auth code lives in `apps/api/src/auth/`, so SSO can replace it later.
- **Projects:** one RCA belongs to exactly one project.
- **Production:** one Production section (team `PROD`), no separate DevOps section.
- **Sign-off:** a "Sign" button per role that records the user and the timestamp. There is no signature image.
- **Notifications:** no email notifications in v1.

## Data model

- Prisma fields use the spec's snake_case names, so API JSON matches the spec samples (`rca_date`, `project_id`) without mapping.
- **RCA number counter:** a helper table `rca_number_seq(year, last_value)` holds the yearly counter. The counter is incremented with `INSERT … ON CONFLICT DO UPDATE … RETURNING` inside the RCA insert transaction, and the row lock prevents duplicates. The year is taken from `rca_date`.
- **Audit filtering:** `audit_log` has an extra nullable `rca_id` column so the audit screen can filter by RCA even when the entity is a child row such as a section, action or sign-off. A database trigger rejects UPDATE and DELETE on `audit_log`, because the spec says audit rows cannot be edited.
- **Whys:** creating an RCA also creates the five `rca_why` rows (why_no 1–5, empty answer) for each section. This matches "rca_team_section 1 --- 5 rca_why".
- **Password storage:** `users.password_hash` is an extra column the spec does not list; login needs it.
- **Project owner:** `projects.owner_user_id` is NOT NULL, because the header must always show the Project Owner.
- **Team for Dev/QA/Prod users:** users with role DEV, QA or PROD must have the matching `team`. Other roles have no team. Section access is decided by that team.
- **Deleting users:** "deleting" a user sets `is_active = false`, because users are referenced by RCAs and audit rows. Inactive users cannot log in (401).
- **Deleting companies and projects:** deletion is refused with 409 while other rows still reference the company or project.

## RCA header, common sections and list

- **Editing a closed RCA:** header, common, closing, timeline, follow-up and attachment data can be edited while the RCA is DRAFT or IN_REVIEW. On a CLOSED RCA every edit returns 409 until the RCA is reopened.
- **prepared_by:** defaults to the user who creates the RCA. `reviewed_by` is a normal editable header field.
- **Team leader:** `team_leader_id` must be an active user. The picker lists RCA Team Leaders and Admins.
- **Read-only fields:** `rca_number`, `status`, `version`, `closed_at` and `time_to_detect_minutes` are read-only. Sending them to POST or PATCH returns 400 ("Unknown or read-only field"). Time to detect is computed on every read.
- **`team` list filter:** returns RCAs whose section for that team is not yet SUBMITTED. This matches the dashboard chart "sections pending by team", so a click on the chart opens the matching list.
- **Extra list filters:** `open` (DRAFT or IN_REVIEW), `closed_from`/`closed_to` (closed date, IST) and `overdue` (has an overdue action). The dashboard KPI cards need them so that every card opens a list showing the same number. The list, the list export and the dashboard use the same filter code.
- **Overdue action:** status is not COMPLETED, the due date is before today (IST), and the action has not been moved to follow-ups.
- **Tab badges:** Header, Common and Closing have no status column. Their badge shows "Submitted" once the RCA has left DRAFT (Closing: once CLOSED), "In progress" when something is filled, and otherwise "Not started".
- **Audit action names:** besides the spec's CREATE, UPDATE, SUBMIT, SIGN, CLOSE, REOPEN and EXPORT, the log uses `DELETE` (soft delete, removing a timeline row, attachment or action, deactivating a user) and `SEND_BACK` (IN_REVIEW to DRAFT).

## Team sections and actions

- **Version and actions:** only the section save (PUT) and submit/reopen increase the section `version`. Actions are separate rows with their own endpoints and do not increase the section version. Two people editing different actions never conflict.
- **Submit version:** POST `…/submit` accepts an optional `version`. When it is sent and stale, the API returns 409 `VERSION_CONFLICT`.
- **After submit:** the section fields and the action text, owner and due date are locked (409). Action `status` and `completed_on` stay editable by the team, Lead and Admin until the RCA is closed. Without that, the close rule ("every action is COMPLETED") could never be met, because all sections are submitted before review.
- **Unlocking a section:** a Lead or Admin can unlock a section only while the RCA is DRAFT. In IN_REVIEW the reviewer uses send-back, and a CLOSED RCA must first be reopened.
- **Whys 2–4 are optional** at submit, per "all 5 Whys (or at least Why 1 and Why 5)".
- **Action status COMPLETED** does not require `completed_on`. The spec requires dates only for the section's completion status.
- **Auto-save:** the team tab saves a draft every 60 seconds while it has unsaved edits. After a 409 it stops auto-saving until the user reloads.

## Workflow, sign-off, follow-ups, attachments, audit

- **"Header and common sections complete" before review** means summary, detected_at, resolved_at, impact_users, detection_method and immediate_fix are filled. The optional descriptive fields (impact duration, revenue, applied by) are not required.
- **Sign-off timing:** sign-off is possible only while the RCA is IN_REVIEW (409 otherwise). Following "all three team lead sign-offs are done … Then Project Owner and RCA Team Leader sign off", the PROJECT_OWNER and RCA_LEAD sign-offs return 422 until DEV_LEAD, QA_LEAD and PROD_LEAD have signed.
- **Who signs which role:** a DEV user signs DEV_LEAD, QA signs QA_LEAD, PROD signs PROD_LEAD, and Project Owner and RCA Team Leader sign their own roles. Matching is by role, so any user holding the role may sign. Admin may sign any role, as the matrix gives Admin "Y", and the record shows the admin's name.
- **Send back:** the body is `{ comment, teams: [...] }`. Only the named sections return to IN_PROGRESS. All sign-offs are cleared, because the content will change. The comment is stored in the SEND_BACK audit row.
- **Reopen:** CLOSED goes to DRAFT, `version + 1`, `closed_at` is cleared, and sign-offs are cleared. Sections stay SUBMITTED; the Lead or Admin can unlock the ones that need changes.
- **Moving an action to follow-ups:** `rca_followup` has an extra nullable `action_id`. POST `/followups` with `action_id` requires an owner and a due date, and marks that action as moved. The close rule treats an action as done when it is COMPLETED, or when it has a follow-up with an owner and a due date.
- **Follow-up edit and delete:** the spec lists only GET/POST for follow-ups. PATCH/DELETE `/rcas/{id}/followups/{fid}` (Lead+) were added because the Closing tab's follow-ups table needs inline editing (SPEC 6.2).
- **Attachments:** `.jpeg` is accepted as the same type as `.jpg`. The served Content-Type comes from the file extension, never from the client. Downloads are always `Content-Disposition: attachment` with `nosniff`. Files are stored under `UPLOAD_DIR` with a random UUID name, and the database stores only that name. A GET list endpoint `/rcas/{id}/attachments` was added next to the spec's POST.
- **Global audit endpoint:** the Audit log screen (Owner and Admin, filters by RCA, user and date) needs a cross-RCA query, so `GET /api/v1/audit` was added. It also accepts `action`, `entity` and `rca_number` filters.
- **Seed samples** are written directly with Prisma: RCA-2026-0001 is CLOSED and satisfies every close rule, and RCA-2026-0002 is DRAFT with Dev submitted, QA in progress and Production not started. They are skipped when any RCA already exists.

## Print, PDF, DOCX and list export

- **No RCA_Template.docx was supplied.** The section order and fields come from the spec: title and header grid; 1 Common (1.1 Problem, 1.2 Impact, 1.3 Detection, 1.4 Timeline, 1.5 Immediate fix); 2 Dev, QA and Production (contributor, cause category, 5 Whys, escape analysis and the two team prompts, actions, prevention, completion); 3 Closing (3.1 Lessons, 3.2 Follow-ups, 3.3 Attachments, 3.4 Sign-off). Print, PDF and DOCX are all built from one export model (`apps/api/src/export/model.ts`), so they cannot drift apart.
- **Blank template:** `GET /templates/rca-blank.docx` is generated from that same model with every value empty, instead of a static file. Swap in the approved RCA_Template.docx here if it must match byte for byte.
- **Where the PDF comes from:** it is produced by loading the exact HTML returned by `GET /rcas/{id}/print` into headless Chromium (Playwright `setContent`, print media, `preferCSSPageSize`). The HTML is rendered in-process rather than fetched over HTTP, so the API never calls itself with a user token.
- **Header and footer:** the header line and "Confidential / Page X of Y / Generated …" footer use CSS `@page` margin boxes, which Chromium 131+ supports for both browser print and PDF. Other browsers may print without them; the PDF always has them.
- **Team section pages:** each team section starts on a new page. The "2. Team sections" heading sits at the top of the Dev page so it is never stranded on the page before.
- **Empty rows for handwriting:** empty fields print as empty boxes, and tables are padded with blank rows (timeline 5, actions 3, follow-ups 3, attachments 2).
- **DRAFT marking:** the print and PDF show a diagonal DRAFT watermark on every page until CLOSED (IN_REVIEW RCAs are also marked DRAFT). The spec requires the watermark only for print and PDF. The `docx` library has no watermark support, so the Word file shows a red "DRAFT" in the page header instead.
- **Export audit:** opening the print view counts as a print export and writes `EXPORT {format: "print"}`, because the browser's own print dialog cannot be observed. List export and blank-template downloads are audited with `entity = rca_list` or `template` and a nil UUID `entity_id`.
- **List export:** CSV or XLSX with the same filters as the list, one row per RCA by default, or `rows=actions` for one row per action. CSV cells starting with `= + - @` are prefixed with `'` to prevent formula injection. The export is capped at 50,000 rows.

## Dashboard and My tasks

- **KPI definitions:**
  - Open RCAs: DRAFT plus IN_REVIEW.
  - In review: IN_REVIEW.
  - Closed this month: `closed_at` in the current IST calendar month.
  - Overdue actions: the number of overdue actions. The card also shows how many RCAs they belong to, and clicking it opens the list filtered to those RCAs.
  - Average time to resolve: the mean of `resolved_at − incident_start`, in hours, over the filtered RCAs that have `resolved_at`.
- **Dashboard filters:** the summary accepts the same filters as the RCA list (the UI exposes the project). Every count except cause category is computed with the list's filter code and returns the filter that reproduces it, so a click opens a list with the same total.
- **Cause-category chart:** it counts team sections (one RCA can have up to 3 causes). The list has no cause filter, so these bars do not link to the list.
- **My tasks:** "sections waiting for me" are sections of the user's own team, or sections where the user is the named contributor, that are not submitted on DRAFT RCAs. They are sorted by target date, falling back to the RCA date. "Actions I own" are the user's actions that are not completed and not moved to follow-ups on RCAs that are not closed, sorted by due date.
- **Landing page after login:** Dev, QA and Production users land on My tasks; everyone else lands on the Dashboard.

## Not built in v1 (out of scope per the spec or the product owner)

- Email or Slack notifications, SSO, Jira or ServiceNow integration, multi-language support, and signature images.
- Backups (SPEC 8, "daily database backup … restore tested") are an operations task and are not part of the application. The `pgdata` and `uploads` Docker volumes are what need backing up.
- HTTPS (SPEC 8): the app serves plain HTTP on localhost. Terminate TLS at a reverse proxy or load balancer in front of the `web` container.

---

# B2C (multi-tenant) decisions

Plan and schema are in `docs/B2C_PLAN.md`. These entries record the judgement calls.

## Phase 1: tenancy and authorization

- **Phase order.** The prompt's Phase 1 (schema) and Phase 3 (authorization) were delivered together. Dropping the global roles removes what the old permission code depended on, so neither could be committed alone with passing tests (see B2C_PLAN section 5).
- **Effective role on an RCA.** A user's role is the highest of their workspace membership role and their direct RCA-collaborator role. A contributor's teams are the union of the workspace-level team and the per-RCA team. An active support grant adds read-only VIEWER access for platform admins.
- **No access means 404.** An RCA the user cannot see returns 404 everywhere, never 403. Users who can see an RCA but lack the permission for an action get 403.
- **Creating an RCA in a workspace you are not in** returns 400 "Workspace not found", so workspace IDs can't be probed.
- **Numbering.** RCA numbers are per workspace (`RCA-YYYY-NNNN` restarts in each workspace). A global sequence would reveal how many RCAs other customers have.
- **Labels instead of master data.** Company, Project, Project Owner, RCA Team Leader, Prepared by, Reviewed by, section contributor and Verified by are free text; the name fields default to the creator's name. Suggestions come from names already used in the workspace (`GET /workspaces/:id/labels`). The list filter `project_id` was replaced by `project` (case-insensitive exact match).
- **People pickers.** Action owners, follow-up owners and sign-off assignees must be people with access to the RCA (`GET /rcas/:id/participants`), so a user cannot attach someone outside the RCA.
- **Sign-off.** The five rows are labels. An OWNER or EDITOR may assign a row to a participant; then only that person can sign it. Unassigned rows can be signed by any OWNER or EDITOR, so a solo user signs everything. The rule that the three team rows are signed before Project Owner and RCA Team Leader is kept.
- **Who may do what.** RCA history is visible to everyone who can see the RCA. The workspace audit log screen is for OWNER and EDITOR. Deleting an RCA is OWNER only. Closing and reopening are OWNER and EDITOR.
- **Section contributors.** A CONTRIBUTOR may upload attachments and add timeline events, and may delete only their own uploads.
- **My tasks for owners and editors** lists every unsubmitted section of DRAFT RCAs in their workspaces, since they can fill any of them. It also lists sign-offs assigned to the user.
- **Support access.** Platform admins get read-only access to one workspace through a `support_grants` row that expires. The grant is created by the audited admin endpoint in Phase 5. Support access can view and read history but cannot export. Without a grant, platform admins see nothing.
- **How scoping is enforced.** A Prisma client extension (`src/tenancy/prismaScope.ts`) injects the visibility filter into every query on a tenant model. Code that must cross tenants (auth flows, jobs, scripts, seeding) opts out explicitly with `unscoped(reason, fn)`. A tenant query outside any scope throws. Raw SQL (`$queryRaw`) is not filtered, so it is used only for the number counter and maintenance.
- **Migrated legacy data.** Existing users count as email-verified. Each old company became one shared workspace owned by the first Admin (else the first Project Owner). Every active user joined it with their old role mapped (ADMIN/PROJECT_OWNER → OWNER, RCA_LEAD → EDITOR, DEV/QA/PROD → CONTRIBUTOR with the same team, VIEWER → VIEWER). Every user also got a personal workspace. Existing bcrypt password hashes keep working.
- **Down migration.** `down.sql` is best-effort. Workspace OWNER maps back to ADMIN. Names typed as free text are matched back to users by name, or left empty. Numbers that clash across workspaces are renumbered. A `pg_dump` taken before the upgrade is the real rollback.
- **Demo data.** Demo data now lives in its own workspace, "Acme Payments (demo)", owned by Jogender Kota, and is seeded only with `NODE_ENV=development` and `SEED_DEMO=true`. The demo password is `Demo-Password-2026`. `admin@rca.local` is the demo platform operator with no workspace access. `npm run purge:demo -- --confirm` deletes every `@rca.local` user and everything they own.

## Phase 2: authentication

- **Tokens.** The access token is a 15-minute HS256 JWT carrying `sub` and `sid` (session id). The web app keeps it in memory only. Every request also checks that the session (refresh-token family) is still active, so logout and "log out of all devices" take effect immediately rather than when the token expires.
- **Refresh tokens.** Refresh tokens are 256-bit random values stored as SHA-256 hashes, valid for 30 days, and rotated on every use. Presenting a token that has already been rotated is treated as theft and revokes the whole session.
- **Cookies.** The refresh cookie `rca_rt` is httpOnly, SameSite=Lax, limited to Path=/api/v1/auth, and Secure in production (`COOKIE_SECURE`). CSRF uses a double-submit `rca_csrf` cookie plus an `X-CSRF-Token` header, and an Origin check, on the two cookie-authenticated endpoints (`/auth/refresh`, `/auth/logout`). All other endpoints use the bearer header, which browsers never attach on their own.
- **No account enumeration.**
  - Signup always returns 202 with the same message. A new address gets a verification link; an already-registered address gets an "account already exists" email instead. The password is hashed in both cases so the timing matches.
  - Login answers 401 "Invalid email or password" for unknown and wrong alike, and runs a dummy argon2 check for unknown emails.
  - Forgot-password and resend-verification always return 202.
  - Emails are sent in the background so response time does not depend on them.
- **Passwords.**
  - Hashing is argon2id with m=19 MiB, t=2, p=1.
  - A password must be 10–128 characters, must not be in a list of about 9,000 common passwords, must not be one repeated character, and must not be the email address or its local part.
  - The common-password list is the 10+ character subset of the NCSC top-100k list (SecLists), shipped in `src/auth/data/`.
  - Legacy bcrypt hashes from the internal tool are upgraded to argon2id on the next login.
- **Rate limits.** Counters are in memory and per process:

  | Endpoint | Limit |
  |---|---|
  | Login | 30 per IP and 10 per account, per 15 minutes |
  | Signup | 10 per IP per hour |
  | Forgot-password, resend-verification | 10 per IP and 3 per account, per hour |

  All limits are configurable. Running more than one API instance needs sticky sessions or a shared store.
- **Lockout.** After 10 wrong passwords an account is locked for 15 minutes, stored in the database so it survives restarts. During the lock even the correct password gets 429.
- **Email verification and change.** Unverified users can log in and view data shared with them, but creating an RCA returns 403 `EMAIL_NOT_VERIFIED`. Changing the login email needs the current password; the change applies only after the link sent to the new address is used (24 h). No mail is sent when the new address is already taken, and the response is identical either way.
- **Password reset.** A reset link (1 h, single use) signs out every session and also marks the email verified, since following it proves the user controls the inbox. Changing the password signs out every other device.
- **Email.**
  - The provider is chosen by `EMAIL_PROVIDER`: `console` (development only; refused in production), `smtp` (nodemailer) or `resend` (HTTP API).
  - The console provider also appends each message as JSON to `MAIL_LOG_FILE`. The Playwright tests read verification and reset links from that file.
  - An extra template, "account already exists", is needed for enumeration-safe signup. Email-change confirmation reuses the verify page.
- **CAPTCHA.** Turnstile runs on signup and forgot-password only when `TURNSTILE_ENABLED=true`, and fails closed if Cloudflare cannot be reached. The site key reaches the web app at runtime via `GET /config/public`, so no rebuild is needed.
- **Terms acceptance.** Signup requires `accept_terms: true`; no timestamp is stored for it.
- **Delivered in Phase 6.** `DELETE /me` and `GET /me/export` are part of the account-lifecycle phase.
- **Security events stored.** SIGNUP, LOGIN, LOGIN_FAILED, LOGOUT, LOGOUT_ALL, EMAIL_VERIFIED, PASSWORD_CHANGE, PASSWORD_RESET and EMAIL_CHANGE are written as `category = SECURITY` rows. They store the user agent but no IP address.

## Phase 3: onboarding and UX

- **Welcome screen.** It appears once, the first time an un-onboarded user reaches the dashboard. "Create my first RCA" opens the new-RCA form, "Create a sample RCA" creates a complete, closed example, and "Skip for now" goes to the dashboard. Any of the three sets `users.onboarded_at`. Direct links such as invitations bypass the welcome screen.
- **Sample RCA.** It is marked `is_sample` and shown as "Sample RCA" in the view and "Sample" in the list. It lives in the user's personal workspace with the user in every role, needs a verified email (it is an RCA), and is deleted like any other RCA.
- **Legal and contact pages.** Terms, Privacy and Contact are structured drafts written with GDPR and the India DPDP Act 2023 in mind. Every legal detail is a highlighted `[REPLACE BEFORE LAUNCH: …]` marker that must be filled before going public.
- **Cookie notice.** No cookie banner is shown, because only essential sign-in cookies are used (`rca_rt` and `rca_csrf`) and there is no analytics or advertising. The site footer says so.
- **Landing page.** It uses dashed placeholder boxes instead of real screenshots.

## Phase 4: collaboration

- **Who can invite.**
  - Workspace invitations: only workspace OWNERs can invite, revoke and manage members.
  - RCA invitations: only OWNERs of the RCA's workspace can invite to an RCA. An EDITOR or a direct RCA collaborator cannot.
  - Direct RCA invitations may grant EDITOR, CONTRIBUTOR or VIEWER, but not OWNER.
- **Contributor teams.** A CONTRIBUTOR invited to one RCA must be given a team. A workspace-level contributor may have a default team (every RCA in the workspace) or none (access per RCA only).
- **Accepting.** An invitation can only be accepted by a verified account whose email matches the invited address, because the link could be forwarded. A new user signs up with that address; when they verify it, every pending invitation for the address is applied automatically. Invitations expire after 7 days, are single-use, can be revoked, and are stored as hashes.
- **Re-inviting and existing access.** Re-inviting the same address to the same target replaces the pending invitation. Inviting someone who already has access returns 409.
- **Invitation content.** The invitation email and the public lookup (`GET /invitations/lookup`) show the inviter's name, the role, the team and a masked email. They never show the RCA or workspace name or any RCA content.
- **Protected owners.** A workspace always keeps at least one OWNER. The primary owner (whose quota the workspace uses) cannot be demoted or removed until they transfer primary ownership to another member.
- **Leaving and removal.** Members may leave a workspace themselves. When a member or collaborator is removed, unsigned sign-off rows assigned to them go back to "any owner or editor".
- **Workspaces.**
  - Users can create shared team workspaces, and rename and delete them.
  - Deleting a workspace requires typing its name and permanently removes every RCA, file and audit row in it.
  - A personal workspace cannot be deleted on its own; it goes with the account.
  - A personal workspace keeps a single OWNER and cannot be transferred.
- **Last edited by.** Each team section shows who last edited it (`updated_by` and `updated_at`), in the tab header and in the read-only view.
- **Security events.** INVITE, INVITE_ACCEPT, INVITE_REVOKE, MEMBER_REMOVE and ROLE_CHANGE are stored as SECURITY events of the acting user.

## Phase 5: production hardening

- **Configuration** is validated with zod at start-up and fails fast. Production refuses the dev JWT secret (it needs 32 or more characters), the console email provider, and local-disk storage.
- **Storage.**
  - Uploads are held in memory (up to `MAX_UPLOAD_MB`), checked for extension, content signature (PDF/PNG/JPEG/ZIP-based formats, and UTF-8 text without NUL bytes) and quota, and only then written to storage.
  - Keys are `ws/<workspace>/rca/<rca>/<uuid>.<ext>`, and anything else is rejected, so no path traversal is possible. Legacy flat keys from the internal tool still resolve on local disk.
  - Downloads are streamed through the authenticated API with `Content-Disposition: attachment`, `nosniff` and a sandbox CSP. Signed URLs are not needed: the bucket stays private and permissions are checked on every request.
- **Quotas.** A workspace's usage counts against its *primary owner* (the `owner_id` column). Limits are 200 MB and 500 RCAs by default, set via env or overridden per user in `usage_quotas`. Usage is computed from the data inside the same transaction as the change, under a per-user advisory lock, so concurrent uploads cannot overshoot. The `usage_quotas` counters are a snapshot for display. Soft-deleted RCAs no longer count toward the RCA limit, but their files count toward storage until purged. Going over a limit returns 422 `QUOTA_EXCEEDED`. `src/services/quota.ts` is the single place to add paid plans later, together with `workspaces.plan`.
- **PDF sandbox.**
  - The export request renders the print HTML after the permission check and stores it under a one-time, 60-second token.
  - Chromium loads only `http://127.0.0.1:<api port>/internal/print/<token>`, which answers only on loopback and is not under `/api`, so Caddy never forwards it. Every other request, including images and styles, is aborted.
  - JavaScript is off, service workers are blocked, renders time out (`PDF_TIMEOUT_MS`), and at most `PDF_CONCURRENCY` run at once, with up to 20 more queued; beyond that the API returns 503.
  - In docker-compose.prod.yml Chromium keeps its own sandbox, running as the non-root `pwuser` with the Playwright seccomp profile. On PaaS hosts that do not allow it, set `PDF_CHROMIUM_SANDBOX=false`.
- **Headers.**
  - The API sends helmet headers with CSP `default-src 'none'`, HSTS in production, and CORS reflected only for `APP_URL`, with credentials.
  - The web app gets its CSP, HSTS, X-Frame-Options DENY, Referrer-Policy and Permissions-Policy from Caddy. The CSP allows only Cloudflare Turnstile as a third party.
  - Body limits: JSON 1 MB, forms 100 KB, uploads `MAX_UPLOAD_MB` (Caddy caps request bodies at 12 MB).
- **Logs.** Logs are JSON lines. Access logs record method, path without the query string, status and duration. Fields named like password, token, secret, cookie, email or authorization are redacted. Errors are logged with stack traces server-side, while clients receive `{ error: 'INTERNAL' }` only.
- **Health.** `/healthz` is liveness; `/readyz` checks the database and storage. Both live outside `/api` and are not proxied publicly. On SIGTERM the server stops accepting connections, stops jobs, flushes emails, closes Chromium and disconnects Prisma (forced exit after 15 s). The connection pool is sized by `DATABASE_POOL_SIZE`, added as `connection_limit` to the URL.
- **Single instance.** Rate-limit counters and one-time print tokens live in the API process, so the supported topology is one API instance, which the prod compose file uses. Scaling out needs a shared store (for example Redis) for both.
- **Operator (platform admin).** The operator sees user and workspace metadata (email, dates, counts) and can disable or enable accounts; the admin routes answer 404 to everyone else. Support access is a grant of at most 4 hours with a reason, written as `SUPPORT_ACCESS` into the workspace's own audit log so its owners can see it. The grant is read-only and does not allow export. `scripts/promote-admin.ts` (compiled to `dist/scripts/promote-admin.js` in the image) sets or clears the flag, and only for verified accounts.
- **Backups.** The `backup` container runs `pg_dump -Fc` on a cron schedule, verifies each dump with `pg_restore --list`, keeps 14 days locally and optionally copies to an S3-compatible bucket with the aws CLI. Attachments are protected by bucket versioning or replication, which is configured at the storage provider (docs/DEPLOY.md). Backup and restore were exercised against the local production stack.
- **Index review.** Tenant queries filter on `rca.workspace_id` (indexed together with `is_deleted, rca_date` and `status`) or on `rca.id`, and child tables join via their indexed `rca_id` / `section_id`. Added indexes: `rca_signoff(assignee_user_id)`, `rca_attachment(uploaded_by)` (purge), `audit_log(user_id)` (anonymisation), `invitations(email, accepted_at, revoked_at)` (auto-accept), `refresh_tokens(expires_at)`, `email_tokens(expires_at)`, `support_grants(workspace_id)`. The 10,000-RCA list test still answers in under 2 s with half the rows belonging to another tenant.
- **MinIO.** The `minio/minio` image is no longer published on Docker Hub. CI and local tests use `adobe/s3mock` as the S3-compatible server; the driver itself is the standard AWS SDK and works with MinIO, R2, B2 and S3.

## Phase 6: compliance and account lifecycle

- **Soft delete.** `DELETE /me` needs the current password (unless the account has none, e.g. Google-only) and the typed word `DELETE`. It sets `deleted_at` and `purge_after = now + ACCOUNT_DELETION_GRACE_DAYS` (default 14), signs out every session, revokes the invitations the user sent, and emails a notice. Login is refused from that moment. The operator can restore an account during the grace period by clearing `deleted_at` and `purge_after` in the database (docs/DEPLOY.md).
- **Workspace ownership at deletion.** Deletion is refused (409) while the user is the only OWNER of a shared workspace that has other members; they must transfer ownership or delete the workspace first (`GET /me/deletion-check` lists these). A shared workspace with another OWNER is handed to that owner immediately. Workspaces with no other members are deleted with the account.
- **Hard delete (purge).** The job `purge-deleted-accounts` runs in the API every `JOBS_INTERVAL_MINUTES` when `JOBS_ENABLED=true`, or once via `node dist/scripts/run-jobs.js` from an external cron. It is serialised with a transaction-scoped advisory lock. For each due account it:
  - deletes every workspace the user still primarily owns (RCAs, sections, attachments and their stored files, audit rows);
  - reassigns actions the user owned in other workspaces to that workspace's primary owner;
  - deletes the user's security log;
  - anonymises the user's remaining audit rows (`user_id = NULL`) using the narrow exception in the audit trigger;
  - deletes the user row, which cascades sessions, tokens, memberships, collaborations, quotas and grants, and nulls `created_by`, `uploaded_by`, signer and assignee references;
  - also removes expired tokens and old support grants.
- **Content in other tenants' workspaces.** RCA text and files the user added to someone else's workspace stay with that workspace, because they are the workspace owner's record. They are no longer linked to the account. Names typed as free text into RCA fields (e.g. "Prepared by") are content controlled by that workspace's owner and are not rewritten. The Privacy Policy template states this.
- **Data export.** `GET /me/export` streams a zip containing: README, `account.json` (profile, workspaces with role, direct RCA access, active sessions), `security-log.json`, every non-deleted RCA in workspaces the user primarily owns as JSON and PDF, and every file the user uploaded anywhere. RCAs in other people's workspaces are exported by their owners. The export is limited to 3 per hour and is recorded as a `DATA_EXPORT` security event.
- **Security log.** `GET /me/security-events` and the "Security log" table in Account settings list the user's own security events. They contain the user agent and no IP address.
- **Cookies.** No consent banner is used, because only strictly necessary cookies are set (`rca_rt` for the session and `rca_csrf` for CSRF protection); there is no analytics or advertising. Adding any non-essential cookie later requires adding a consent notice.
- **GDPR and DPDP.** Access and portability are covered by the export, rectification by the profile and RCA editing, and erasure by account deletion. The grievance officer or DPO contact, legal bases, processors and transfer safeguards are placeholders in the Privacy Policy that the operator must fill in. They are legal decisions, not code.

## Phase 7: Google sign-in (optional, implemented)

_Superseded where it differs by "Sign in with Google and Microsoft" below: `users.google_sub` moved to `user_identities`, and passwords can now be set from Account settings._

- **Flow.** The server runs the OAuth 2.0 authorization-code flow with PKCE (S256). `state`, the PKCE verifier and the post-login target are kept in a 10-minute httpOnly cookie bound to the browser, which prevents login CSRF and code injection. The redirect URI is `APP_URL/api/v1/auth/google/callback`. The ID token is verified with Google's JWKS (RS256), and the issuer, the audience (our client ID) and the expiry are checked.
- **Account matching.** A returning user is matched by `google_sub`. An existing account with the same email is linked **only if** Google reports `email_verified: true`; linking also marks the local email verified and applies pending invitations. An unverified Google email is refused. A new user is created with no password, a verified email and a personal workspace, and pending invitations are applied. Deleted or disabled accounts are refused.
- **Login after Google.** After the callback the server sets the normal refresh and CSRF cookies and redirects to the app, which obtains an access token with the refresh cookie, exactly like a returning visitor.
- **Accounts without a password.** Users who signed up with Google can set a password later with "Forgot password". Settings hides "Change password" until one exists, and account deletion then asks only for the typed confirmation.
- **Terms.** Using "Continue with Google" on the sign-up page counts as accepting the Terms; the button says so.
- **Tests.** They use a locally generated RSA key and mocked Google endpoints. A real Google project is needed only in production (docs/DEPLOY.md).

## Phase 8: billing

Where the brief was open, the option that protects revenue integrity was chosen.

- **Only verified provider events change billing state.** `paid_at`, `payment_reference`, `plan` and `subscription_status` are written only by `handleBillingEvent()` after the webhook signature (or, for the mock, the server acting as provider) is verified. A success redirect (`?checkout=done`) only shows a message. The client cannot send `paid_at`.
- **The mock provider is refused in production** unless `ALLOW_MOCK_PAYMENTS=true`, and a server running the mock must set its own `MOCK_WEBHOOK_SECRET`. Otherwise anyone could "pay" with the TEST MODE page.
- **Only the checkout's creator can complete a mock session**, and each session has one outcome. A failed attempt needs a new checkout.
- **Sample RCAs count toward the free bucket.** They are real, exportable RCAs. A user can delete the sample to free the slot.
- **Soft-deleted RCAs do not count.** Deleting an unpaid RCA frees its slot, as the brief says. Restoring is not offered, so this cannot be used to bypass the cap.
- **The bucket is per workspace**, as the brief says. So that extra workspaces cannot multiply it without limit, a user may own at most `QUOTA_OWNED_WORKSPACES` workspaces (default 5, the personal one included; 422 `QUOTA_EXCEEDED`). The check runs under the user's quota lock, so parallel requests cannot overshoot. A workspace transfer is accepted by the recipient and is not counted against their limit.
- **Only the primary owner (workspace.owner_id) manages billing.** Co-owners see the plan but cannot subscribe, cancel or open the portal. Billing decisions stay with the account that pays.
- **Without an active Team plan, everyone except the primary owner is capped to Viewer**, including co-owners and editors. That covers PAST_DUE, CANCELED and Solo alike. Nobody is removed; access returns when the plan is active again. The primary owner keeps full access to their own workspace.
- **Solo allows no invitations** (403 `SUBSCRIPTION_REQUIRED`), neither to the workspace nor to single RCAs.
- **Seats count members other than the primary owner, RCA collaborators and pending invitations.** An invitation reserves a seat, so a Team with N seats cannot send more than N invitations in advance. New seat counts below the seats in use are refused.
- **An unlock can be bought even when the workspace is subscribed.** It keeps that RCA unlocked if the subscription ends later. Buying an unlock for an already paid RCA is refused (409).
- **Entitlement also needs `current_period_end` in the future.** If a cancellation or renewal event is lost, the subscription still stops at the end of the paid period rather than running forever.
- **Out-of-order or stale events are ignored.** Renewal, past-due and cancellation events must name the workspace's current subscription; events for an older subscription are recorded with result `ignored`.
- **Data-export PDFs are watermarked too.** The "Download my data" archive uses the same watermark rule as print, PDF and DOCX, so the export is not a way around it.
- **Prices shown come from env vars, and Stripe charges its own prices.** `docs/STRIPE_SETUP.md` says to keep them equal. The amount stored in the checkout session and in the history is the one shown to the buyer.
- **Currency.** One currency per installation (`BILLING_CURRENCY`, default USD). There is no tax handling; Stripe Tax can be enabled in the Stripe dashboard later.
- **The demo seed activates a Team plan** for the demo workspace through `handleBillingEvent()` with a mock event (1-year period), because the demo shows collaborators. The seed only runs in development.

## Sign in with Google and Microsoft

Setup: `docs/OAUTH_SETUP.md`. Where the brief was open, the option that best protects accounts was chosen.

- **Identities table.** Provider accounts live in `user_identities` (user_id, provider, provider_account_id, email, linked_at, last_used_at). The table is unique on (provider, provider_account_id) and on (user_id, provider): one Google and one Microsoft account per user, next to an optional password. The migration moves existing `users.google_sub` values across. Its down script restores them, and refuses to run while Microsoft identities exist so they are not lost silently.
- **Matching.** A returning user is found by the provider's `sub`, never by email, so a changed email at the provider does not matter. For Microsoft, `sub` is specific to the app registration: a new registration produces new `sub` values. Users are then matched again by verified email, or they reconnect in settings.
- **When an email counts as verified.**
  - Google: `email_verified: true`.
  - Microsoft does not send `email_verified`. A personal account (tenant `9188040d-…`) is trusted, because its email is the verified sign-in address. A work or school account is trusted only with the `xms_edov` optional claim, because a tenant administrator can set the email attribute to any address (the "nOAuth" issue).
  - Everything else counts as unverified.
- **Unverified email: nothing happens.** A new identity with an unverified email is refused, whether an account with that email exists or not (`email_not_verified`). It neither links nor creates an account.
- **Pre-registration takeover.** Someone may have registered an email with a password and never verified it. If the real owner later signs in with a provider that verifies the email, the identity is linked, the email is marked verified, and the **unproven password is removed** and all sessions are signed out. The owner can set a password later.
- **Explicit linking from settings** does not require a matching or verified email. The user is already signed in and chose the account at the provider, and later sign-ins match by `sub` only.
  - **Link claim:** the link intent is a signed, 10-minute claim naming the user, kept in the flow cookie. It is never in a URL, and a browser cannot rewrite its cookie to point at another user.
  - **Conflicts:** an identity already linked to another user is refused (`identity_linked_elsewhere`). A second account of the same provider is refused (`provider_already_linked`).
- **Last sign-in method.** Unlinking is refused with 409 `LAST_LOGIN_METHOD` when the identity is the only method left (no password, no other provider). The check runs under a row lock on the user, so two parallel unlinks cannot remove both methods. The UI disables the button and explains why.
- **Passwordless accounts** can set a password in Account settings (`POST /me/password`; the usual strength rules apply). "Forgot password" still works too. An account that already has a password must use Change password.
- **Flow security.**
  - Authorization-code flow with PKCE (S256), `state` and a `nonce` checked in the ID token.
  - The ID token must have an RS256 signature from the provider's JWKS, our client ID as audience, and must not be expired.
  - Issuer: Google must be `accounts.google.com`. Microsoft's issuer must be `login.microsoftonline.com/<tid>/v2.0` for the token's own tenant, restricted further by `MICROSOFT_TENANT` (`consumers`, `organizations` or a tenant GUID).
  - The flow cookie is httpOnly, lasts 10 minutes, and is limited to the provider's callback path.
- **`OAUTH_REDIRECT_BASE_URL`** defaults to `APP_URL` and must have the same origin, because the callback sets the session cookie that the app then uses. It must be https in production.
- **Terms.** Signing up through a provider counts as accepting the Terms; the text under the buttons says so.
- **No silent links.** Every new identity on an existing account sends the account holder an email at the account's address (template `identity-linked`, same `layout()`/`sendEmail()` pattern as the other account emails). It covers links by verified email and from settings, and says:
  - which provider and which provider email;
  - when, in UTC and IST;
  - how it happened, and whether an unconfirmed password was removed;
  - how to disconnect it.

  The notice is informational and cannot be turned off. The link itself is not held for confirmation: the provider has already proven control of the address, and that mailbox could reset the password anyway. The email makes a wrong link visible. A new account, a returning sign-in, a refused attempt and re-linking an identity already on the account send nothing.
- **Audit and data export.** Linking and unlinking write the `IDENTITY_LINK` and `IDENTITY_UNLINK` security events (detail: provider, provider email, `via` = `verified_email` or `settings`, `password_removed`), and setting a password writes `PASSWORD_SET`. The Security log in Account settings labels them per provider ("Google account linked", "Microsoft account disconnected"), separate from "Logged in with Google". Connected accounts are included in "Download my data". Identities are deleted with the account (cascade).
- **Missing claims are never "verified".** Only an explicit true value counts as verified (`true`, `"true"`, `"1"` or `1`). A missing `email_verified`, or `false`, `"false"`, `null`, `0` or `""`, counts as unverified. For Microsoft, an `email_verified` claim is ignored, because Microsoft does not define it; a work account needs `xms_edov`. A missing `email` claim is refused.
- **Tests.** API tests run the real flow against the real endpoint URLs with `fetch` mocked. The Playwright tests use a local fake OpenID provider (`apps/web/e2e/mockOidc.mjs`), selected by `OAUTH_TEST_PROVIDER_URL`, which production refuses. No test contacts Google or Microsoft.

## Word export and blank template gating

Details and reasons: `docs/BILLING_PLAN.md`, section 9.

- **Word export needs payment.** It is available for a paid RCA or a subscribed workspace only (403 `PAYMENT_REQUIRED` otherwise), because a watermark in an editable `.docx` can simply be deleted. Print and PDF stay open, watermarked when unpaid.
- **The blank template needs any account.** Unverified accounts are fine. Signup still never starts a session (no account enumeration), so a logged-out visitor signs up and then logs in once, after which the download starts by itself.

## Section saves and version conflicts

- **One writer per section per tab.** Save draft, the 60-second auto-save, Submit section and Unlock are queued per RCA section in the browser (`apps/web/src/pages/rca/sectionWriter.ts`). They run one at a time, and each sends the newest version the tab knows, including the version the previous write returned. A tab can never conflict with itself. As a safety net, a 409 that names a version this tab produced is retried once, silently.
- **A real conflict says who.** A 409 `VERSION_CONFLICT` comes from another tab or another person. It includes `changed_by_self` and `changed_by_name`, and the message reads "This section was saved from another tab or window since you opened it here" or "<name> changed this section since you opened it". Reload takes the server version and drops local edits; that is its purpose.
- **Refetched values merge; they don't overwrite.** When a form receives new server values, fields the user has not touched take the server value and fields edited locally keep the edit (`useDirtyForm`). This applies to every RCA form. Before this, text typed while a save was in flight was silently replaced by the server's copy.

