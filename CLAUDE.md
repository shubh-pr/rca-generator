# RCA Admin Dashboard

Web dashboard for Root Cause Analysis (RCA) records. Dev, QA and Production teams each fill
their own section of an RCA, and any RCA can be printed or exported as PDF/DOCX.

- **Source of truth:** `docs/SPEC.md` (generated from `docs/RCA_Admin_Dashboard_Design_Spec.docx`).
- **Decisions and ambiguities:** `docs/ASSUMPTIONS.md`. Add an entry for every judgement call.
- **Phase plans:** `docs/PLAN.md`.

## Stack

| Layer    | Tech |
|----------|------|
| Database | PostgreSQL 16, Prisma 6 (migrations + seed) |
| API      | Node.js 22, TypeScript, Express 5, zod, JWT (jsonwebtoken), bcryptjs, multer |
| Web      | React 19, TypeScript, Vite 8, Tailwind CSS 4, React Router 8 (data router), TanStack Query 5 |
| Export   | Playwright Chromium (PDF from the `/print` HTML), `docx` (Word), `exceljs` (xlsx) |
| Tests    | Vitest + supertest (API), Vitest (web unit), Playwright (end-to-end) |
| Run      | `docker-compose.yml` (local: db, api, web) and `docker-compose.prod.yml` (Caddy with auto HTTPS, api, db, backup) |
| Storage  | `src/storage/`: S3-compatible (production) or local disk (development) |

## Folder structure

```
apps/api/                 Express API (npm workspace "@rca/api")
  prisma/schema.prisma    Data model (tables and columns are snake_case, as in the spec)
  prisma/migrations/      SQL migrations (incl. CHECK constraints and the audit_log no-update trigger)
  prisma/seed.ts          Demo seed, only with NODE_ENV=development and SEED_DEMO=true (demo workspace + 2 RCAs)
  prisma/migrations/*/down.sql  Hand-written reverse migration where the up migration moves data
  scripts/purge-demo-data.ts    Deletes all @rca.local demo data; needs --confirm
  scripts/promote-admin.ts      Sets/clears the platform-operator flag (dist/scripts/promote-admin.js in the image)
  scripts/run-jobs.ts           Runs the scheduled jobs once (account purge), for an external cron
  src/app.ts              Express app factory (used by server.ts and tests)
  src/server.ts           HTTP entry point
  src/auth/               ALL auth code: passwords, JWT, sessions, CSRF cookies, rate limits, Google sign-in (google.ts)
  src/tenancy/            Request scope (AsyncLocalStorage) + Prisma extension that filters every tenant query
  src/policy/             policy.ts: can()/authorize() for every action; access.ts: resolves a user's RCA access
  src/lib/                errors, validation helpers, audit, pagination, dates
  src/routes/             Collection routes (rcas, workspaces, audit, dashboard, exports)
  src/routes/rca/         Every /rcas/:id/... route, mounted behind rcaAccessMiddleware
  src/services/           Business logic (RCA number, workflow rules, queries)
  src/export/             print HTML, PDF (sandboxed renderer), DOCX, CSV/XLSX
  src/services/lifecycle.ts  Account soft delete and the purge job; dataExport.ts: "export my data" zip
  src/jobs/               In-process scheduler (JOBS_ENABLED) for the purge job
  src/email/              Email providers (console, smtp, resend) and templates
  test/                   Vitest API tests (supertest), run against the rca_test database
  scripts/prepareE2eDb.ts Creates/migrates/re-seeds the rca_e2e database for Playwright
apps/web/                 React app (npm workspace "@rca/web")
  src/api/                fetch client + TanStack Query hooks
  src/components/         Shared UI (chips, badges, layout, form fields)
  src/pages/              One file per screen
  src/lib/                Labels, date helpers (IST display), permissions mirror
  e2e/                    Playwright end-to-end tests
apps/web/Caddyfile        Static files, /api proxy, security headers, automatic HTTPS
ops/backup/               pg_dump backup/restore image; ops/seccomp/chromium.json: Chromium sandbox profile
.github/workflows/ci.yml  Lint, tests (incl. isolation + S3), e2e, image builds
docs/                     SPEC.md, SPEC_B2C.md, B2C_PLAN.md, ASSUMPTIONS.md, DEPLOY.md
```

## Naming conventions

- DB tables/columns and API JSON fields: `snake_case`, exactly as in the spec (`rca_number`, `team_leader_id`).
  Prisma models are PascalCase with `@@map` to the spec table names; Prisma fields are snake_case so API
  payloads need no mapping.
- Enum values: UPPER_SNAKE (`IN_REVIEW`, `CODE_DEFECT`).
- TypeScript variables/functions: `camelCase`; types/components: `PascalCase`; files: `camelCase.ts`,
  React components/pages `PascalCase.tsx`.
- Routes live under `/api/v1`. Errors are `{ error: CODE, message, fields? }` with codes
  `VALIDATION` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404),
  `CONFLICT`/`VERSION_CONFLICT` (409), `BUSINESS_RULE` (422).
- Date-only columns are sent as `YYYY-MM-DD`; timestamps as ISO 8601 UTC. The UI displays IST (Asia/Kolkata).
- **Tenancy:** every RCA belongs to a workspace. Tenant queries are filtered automatically by the Prisma extension in
  `src/tenancy/prismaScope.ts` using the request scope set by `requireAuth`. Outside a request, wrap work in
  `unscoped('reason', fn)`; never import the raw PrismaClient. Unknown or invisible RCAs are 404, never 403.
- **Authorization:** only `src/policy/policy.ts` decides (`authorize(ctx, action, resource)`); routes hold no role logic.
  New `/rcas/:id/...` routes go in `src/routes/rca/` (mounted behind `rcaAccessMiddleware`) and need a case in
  `test/isolation.test.ts` (its coverage check fails otherwise). The web app reads `rca.permissions`; it never re-derives roles.
- Every create/update/submit/sign/close/reopen/export writes `audit_log` via `src/lib/audit.ts`, in the same transaction.

## Commands (run from the repo root)

```bash
npm install                          # install all workspaces
npx playwright install chromium      # browser for PDF export + e2e (once)
cp apps/api/.env.example apps/api/.env
docker compose up -d db              # start postgres only (host port 5433; override with DB_PORT)
npm run db:migrate                   # prisma migrate deploy (dev DB)
npm run db:seed                      # demo data (needs NODE_ENV=development SEED_DEMO=true in apps/api/.env)
npm run dev                          # api on :4000, web on :5173 (proxies /api)
npm run lint                         # eslint + tsc --noEmit for both apps
npm test                             # API tests on rca_test (created/migrated automatically) + web unit tests
npm run test:e2e                     # Playwright: re-seeds rca_e2e, starts api :4100 + web :5174 itself
docker compose up --build            # local stack with demo data: http://localhost:8080
S3_TEST_ENDPOINT=http://localhost:9100 npm test   # also runs the S3 driver test (docker run -p 9100:9090 -e COM_ADOBE_TESTING_S3MOCK_STORE_INITIAL_BUCKETS=rca-test adobe/s3mock)
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build   # production (docs/DEPLOY.md)
npm run admin:promote -w @rca/api -- you@example.com  # platform operator flag
```

New migration during development: `npm run db:migrate:dev -- --name <name>` (runs `prisma migrate dev`).

## Notes for working in this repo

- Never run `prisma migrate reset` (Prisma blocks it for AI agents). Test databases are prepared by
  `migrate deploy` + TRUNCATE; the scripts refuse any database not named `*_test` / `*_e2e`.
- Tests share one database and run serially (`fileParallelism: false`); each file calls `resetDb()`.
  Use `createUser()` / `createTeam()` from `test/helpers.ts`; read or write fixtures directly with `raw(() => db...)`.
- `/rcas/export` must stay registered before `/rcas/:id` routes (see `src/app.ts`).
- The print HTML (`src/export/printHtml.ts`) and DOCX (`src/export/docx.ts`) both render
  `src/export/model.ts`; change the template order there, not in each renderer.
- Docker Desktop on macOS cannot bind-mount from ~/Documents here, so the local compose uses named volumes only.
- Never log personal data or tokens; use `logger` from `src/lib/logger.ts`, not console.
- Quota-limited writes go through `withinQuota(workspaceId, add, (tx) => …)` and must write through `tx`.
- Personal data is erased by `purgeAccount()`; new tables holding user data must be handled there (or cascade).
- Auth responses must never reveal whether an email exists (generic messages, background email sending).
