# RCA Admin Dashboard

A web dashboard for Root Cause Analysis records. Dev, QA and Production each fill their own section of an
RCA, the RCA goes through review, sign-off and closing, and any RCA can be printed or downloaded as PDF and
Word in the template layout. It is built from `docs/SPEC.md` (the design spec). Decisions the spec left
open are recorded in `docs/ASSUMPTIONS.md`.

**Stack:** PostgreSQL 16 + Prisma · Node.js/TypeScript/Express 5 + zod (REST under `/api/v1`) · React 19 +
Vite + Tailwind + React Router + TanStack Query · Playwright Chromium (PDF) · `docx` (Word) · Vitest,
supertest and Playwright (tests).

## Quick start (Docker)

```bash
docker compose up --build
```

Open **http://localhost:8080**. On every start the API applies migrations and runs the idempotent seed.

| Service | Port | Notes |
|---|---|---|
| web (nginx + built React app, proxies `/api`) | 8080 | `WEB_PORT=… docker compose up` to change |
| api | internal 4000 | health: `/api/v1/health` |
| db (postgres) | 5433 on the host | `DB_PORT=…` to change |

Set `JWT_SECRET` in the environment for anything beyond local use.

## Seeded logins

All seeded users have the password **`Password@123`**.

| Role | Email | Name | Lands on |
|---|---|---|---|
| Admin | `admin@rca.local` | System Admin | Dashboard |
| Project Owner | `jogender.kota@rca.local` | Jogender Kota | Dashboard |
| RCA Team Leader | `lead@rca.local` | Priya Sharma | Dashboard |
| Dev | `dev@rca.local` | Arjun Mehta | My tasks |
| QA | `qa@rca.local` | Neha Gupta | My tasks |
| Production | `prod@rca.local` | Vikram Singh | My tasks |
| Viewer | `viewer@rca.local` | Asha Rao | Dashboard |

The seed also creates the company **Acme Payments Pvt Ltd**, the project **Payment Gateway** (owner Jogender
Kota), and two sample RCAs:

- **RCA-2026-0001** is CLOSED and fully signed.
- **RCA-2026-0002** is DRAFT: the Dev section is submitted, QA is in progress, Production is not started, and one QA action is overdue.

## Local development (without Docker for api/web)

Requires Node.js ≥ 22.22 and Docker for Postgres.

```bash
npm install                          # installs both workspaces, runs prisma generate
npx playwright install chromium      # headless browser for PDF export and e2e tests
cp apps/api/.env.example apps/api/.env
docker compose up -d db              # postgres on localhost:5433
npm run db:migrate                   # apply migrations
npm run db:seed                      # seed users, company, project, sample RCAs
npm run dev                          # API http://localhost:4000, web http://localhost:5173
```

## Tests and lint

```bash
npm run lint        # ESLint (0 warnings allowed) + tsc --noEmit for api and web
npm test            # Vitest: API tests (supertest) against rca_test + web unit tests
npm run test:e2e    # Playwright: full RCA flow and one login per seeded role
```

- `npm test` creates the `rca_test` database if it is missing, applies migrations, and truncates tables between test files.
- `npm run test:e2e` prepares a separate `rca_e2e` database (migrate, wipe, seed) and starts its own API on port 4100 and web app on 5174. Postgres must be running (`docker compose up -d db`).
- Neither command touches the development database.

How the tests cover the acceptance criteria in SPEC 9.2:

| Acceptance criterion | Test |
|---|---|
| Dev can edit Dev, gets 403 on QA and Production | `apps/api/test/sections.test.ts` "section permissions" |
| Parallel saves of different sections never lose data | `sections.test.ts` "acceptance: … never lose each other's data" and the same-section 409 race |
| No IN_REVIEW until 3 sections submitted; no close until all sign-offs | `workflow.test.ts` "acceptance: …" (both rules) |
| PDF shows all template fields in order, repeated table headers, page numbers | `exports.test.ts` "PDF export: acceptance …" (parses the PDF per page) |
| Word export is a valid package that matches the template structure | `exports.test.ts` "DOCX export: acceptance …" |
| DRAFT watermark on print and PDF until closed | `exports.test.ts` print and PDF tests (draft vs closed) |
| Every status change and export is visible in the audit log | `workflow.test.ts` "acceptance: every status change …", `exports.test.ts` "every export is audited" |
| Dashboard numbers match the RCA list filters | `dashboard.test.ts` "acceptance: every dashboard number matches …" |
| End-to-end flow | `apps/web/e2e/full-flow.spec.ts` (create, 3 teams submit, review, 5 sign-offs, close, PDF download) |

Other suites cover the role permission matrix, validation (400), 401, 404, 409 and 422 cases, RCA
number generation (format, yearly reset, 12 concurrent creates), attachments, the seed data, and the
performance targets (list under 2 s with 10,000 RCAs, PDF under 10 s).

## Printing and exporting

Open any RCA (**RCA list → click a row**). The read-only view and the tabbed form both have these buttons:

- **Print** opens the print preview (`/rcas/{id}/print`). It shows the server's print HTML: A4 portrait, a header line with RCA number, project and severity, a footer with "Confidential · Page X of Y · generated time", each team section on a new page, and a DRAFT watermark until the RCA is CLOSED. Click **Print** in the top bar and use Chrome or Edge for the page header and footer.
- **PDF** downloads `RCA-YYYY-NNNN_Project_vN.pdf`. The server renders the same print HTML with headless Chromium.
- **Word** downloads an editable `.docx` with the same section order and tables.

On the **RCA list**, **Export CSV** and **Export Excel** download the list with the current filters, one row per RCA or one row per action. **Blank template** downloads an empty `RCA_Template.docx` for offline use.

The same features over the API (bearer token from `POST /api/v1/auth/login`):

```bash
TOKEN=$(curl -s -X POST localhost:8080/api/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"lead@rca.local","password":"Password@123"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
curl -OJ -H "Authorization: Bearer $TOKEN" "localhost:8080/api/v1/rcas/<id>/export?format=pdf"
curl -OJ -H "Authorization: Bearer $TOKEN" "localhost:8080/api/v1/rcas/<id>/export?format=docx"
curl -OJ -H "Authorization: Bearer $TOKEN" "localhost:8080/api/v1/rcas/export?format=xlsx&status=CLOSED"
curl -OJ -H "Authorization: Bearer $TOKEN" "localhost:8080/api/v1/templates/rca-blank.docx"
```

Every print and export is written to the audit log with action `EXPORT`.

## Workflow in short

1. **Draft.** An Admin, Project Owner or RCA Team Leader creates the RCA. The number RCA-YYYY-NNNN, the 3 team sections and the 5 sign-off rows are created automatically.
2. **Team sections.** Each team fills its own tab: 5 Whys, escape analysis, actions, prevention and completion. The tab auto-saves every 60 s and has a Submit button. Saves carry the section version, and a stale save gets 409 with a Reload prompt.
3. **Review.** A manager clicks **Submit for review** once the header and common sections are complete and all 3 sections are submitted. A reviewer can **Send back** with a comment, which unlocks only the named team sections.
4. **Sign-off.** The Dev, QA and Production leads sign first, then the Project Owner and the RCA Team Leader.
5. **Close.** An Admin or Project Owner closes the RCA once every sign-off is done and every action is completed or moved to follow-ups with an owner and date. **Reopen** needs a reason and increases the version by 1.

## Repository layout

See `CLAUDE.md` for the folder structure, naming conventions and every command. Phase plans are in `docs/PLAN.md`.
