# Build plan

Phases follow Section 9.1 of `SPEC.md`. Each phase is finished, tested and committed before the next starts.

## Phase 1: Foundation

Deliverable: database migration scripts, login, roles, masters (users, projects, companies).

- **Workspace:** root `package.json` (npm workspaces `apps/api`, `apps/web`), shared ESLint flat config, `.gitignore`, `docker-compose.yml` (db only for now).
- **Database (`apps/api/prisma`):** the full schema from Section 4 (all 11 enums, every table and column, uniques, indexes from 4.9) in one initial migration, so later phases only add code. Raw SQL adds `CHECK (why_no BETWEEN 1 AND 5)`, `CHECK (kind IN ('FILE','LINK'))` and a trigger that blocks UPDATE/DELETE on `audit_log`. There is also a `rca_number_seq` table for the yearly RCA counter.
- **API:** `src/app.ts`, error handler, zod `validate()` helper, JSON replacer for date-only columns.
  - `src/auth/`: bcrypt passwords, JWT sign/verify, `requireAuth`, `POST /auth/login`, `GET /me`.
  - `src/lib/permissions.ts`: role matrix from Section 2 as pure functions.
  - `src/lib/audit.ts`: `writeAudit(tx, …)`.
  - `src/lib/pagination.ts`: page, page_size, sort parsing.
  - Masters: `GET/POST/PATCH/DELETE /users`, `/companies`, `/projects` (Admin only; GET of companies/projects/users lists is open to logged-in users because every role needs the pickers).
- **Seed:** one user per role, company, project (owner Jogender Kota). The sample RCAs are added in Phase 4, when all workflow code exists.
- **Web:** Vite + Tailwind + Router + Query scaffold, auth context, login screen (redirect by role), app layout (nav, blameless note component), Admin masters screens (Users, Projects, Companies).
- **Tests:** login OK/bad/inactive (401), `/me`, 401 without a token, masters 403 for non-admin, 400 validation, 409 on a duplicate email or company name, 404 for unknown ids, permission matrix unit tests.

## Phase 2: Core RCA

- **API:** `POST /rcas` (number RCA-YYYY-NNNN generated in the insert transaction; creates 3 sections, 15 whys and 5 sign-offs), `GET /rcas` (filters status, project_id, severity, environment, team, date_from, date_to, q; page/page_size/sort), `GET /rcas/{id}`, `PATCH /rcas/{id}`, `DELETE /rcas/{id}` (soft delete), timeline CRUD. Validation: incident_start <= detected_at <= resolved_at; time to detect is computed.
- **Web:** RCA list (filters, search, chips, progress chips), New RCA, and the tabbed form with Header and Common tabs (company and owner auto-fill, timeline add row and inline edit).
- **Tests:** number format, uniqueness under concurrency, yearly reset, 3 + 5 child rows, validation, permissions, filters, soft delete gives 404.

## Phase 3: Team sections

- **API:** `GET/PUT /rcas/{id}/sections/{team}` (version required, 409 on mismatch), submit (422 if incomplete, 409 if already submitted), reopen (Lead/Admin), action CRUD (owner, due date >= rca_date).
- **Web:** Dev/QA/Production tabs with team-specific labels, 5 stacked whys (Why 5 = Root cause), actions table (overdue in red), Save draft plus 60 s auto-save, Submit, Unlock, 409 reload message, unsaved-changes warning, greyed-out read-only fields.
- **Tests:** Dev 403 on QA/PROD, version conflict, parallel saves on different sections keep both, submit rules, lock/unlock.

## Phase 4: Workflow

- **API:** submit-review (all rules in 3.1), send-back (unlock named sections), close (all sign-offs, actions completed or moved to follow-ups), reopen (reason, version + 1), sign-offs (own role only), follow-ups, attachments (multipart and link, 10 MB, allowed types, random storage name), per-RCA audit and the global audit log.
- **Web:** Closing tab (lessons, follow-ups, attachments with drag and drop, sign-off table), workflow buttons, read-only view page, Audit log screen.
- **Seed:** two sample RCAs (one DRAFT, one CLOSED).
- **Tests:** each transition's allowed/denied cases, sign-off role matching, audit rows for each event type.

## Phase 5: Output

- **API:** `GET /rcas/{id}/print` (A4 HTML, @page margin boxes for the header line and Page X of Y, DRAFT watermark, empty boxes, repeated thead), `GET /rcas/{id}/export?format=pdf|docx`, `GET /rcas/export?format=csv|xlsx`, `GET /templates/rca-blank.docx`. Every export writes EXPORT to audit_log.
- **Web:** Print page, PDF/Word buttons, Export list button, blank template link.
- **Tests:** PDF text contains every template heading in order and "Page 1 of", watermark on/off, DOCX parses and contains the section order, CSV/XLSX rows equal the filtered list, EXPORT audit rows.

## Phase 6: Dashboard

- **API:** `GET /dashboard/summary`, `GET /my-tasks`.
- **Web:** KPI cards linking to filtered lists, charts, My tasks, overdue highlighting.
- **Tests:** dashboard numbers equal list totals for the same filter; my-tasks content; Playwright full flow (create, 3 teams submit, review, sign-off, close, download PDF).
- **Docker:** full `docker compose up` (migrate + seed on start), README.
