# RCA Dashboard

A multi-tenant web app for root cause analysis. Anyone can sign up, record an incident, work through the 5 Whys for Dev, QA and Production, track actions, sign off, close the RCA, and export it as PDF or Word in a consistent template layout. You can do everything alone, or invite people and give each of them only the section they own.

| Document | Contents |
|---|---|
| `docs/SPEC.md` | RCA content, workflow, print and export rules |
| `docs/SPEC_B2C.md` | Accounts, workspaces, roles and limits |
| `docs/DEPLOY.md` | **Hosting guide** (domain, HTTPS, email, storage, backups, operator) |
| `docs/B2C_PLAN.md` | Audit, schema and migration plan, permission model |
| `docs/BILLING_PLAN.md` | Plans, payment provider contract, billing rules |
| `docs/STRIPE_SETUP.md` | Checklist for switching from the mock provider to Stripe |
| `docs/ASSUMPTIONS.md` | Every judgement call |
| `CLAUDE.md` | Structure, conventions and all commands |

**Stack:** PostgreSQL 16 + Prisma · Node.js/TypeScript/Express 5 + zod · React 19 + Vite + Tailwind + React Router + TanStack Query · Playwright Chromium (PDF) · `docx` · S3-compatible storage · Caddy (HTTPS) · Vitest, supertest and Playwright.

## Run it locally

### Everything in Docker (fastest look)

```bash
docker compose up --build
```

Open **http://localhost:8080**. This local stack uses development settings:

- **Email:** printed to `docker compose logs api` (look for `[email:verify-email]` and open the link).
- **Attachments:** stored on disk.
- **Demo workspace:** "Acme Payments (demo)" with two RCAs, on a demo Team plan (activated through a mock provider event) so collaboration works.

| Demo account (password `Demo-Password-2026`) | Role in the demo workspace |
|---|---|
| `jogender.kota@rca.local` | Owner |
| `lead@rca.local` | Editor |
| `dev@rca.local` / `qa@rca.local` / `prod@rca.local` | Contributor (Dev / QA / Production section) |
| `viewer@rca.local` | Viewer |
| `admin@rca.local` | Platform operator (no workspace access) |

Or sign up with any email address.

If your local database volume dates from the internal version of the app, the migrated demo accounts keep their old password `Password@123`. Run `docker compose down -v` for a fresh database with the accounts above.

### Development servers

Requires Node.js ≥ 22.22 and Docker (for Postgres).

```bash
npm install
npx playwright install chromium
cp apps/api/.env.example apps/api/.env      # NODE_ENV=development, SEED_DEMO=true, console email
docker compose up -d db                     # postgres on localhost:5433
npm run db:migrate && npm run db:seed       # the seed only runs with NODE_ENV=development and SEED_DEMO=true
npm run dev                                 # API http://localhost:4000, web http://localhost:5173
```

## Tests

```bash
npm run lint        # ESLint (0 warnings) + tsc for api and web
npm test            # API and unit tests, incl. the tenant-isolation suite (uses the rca_test DB)
npm run test:e2e    # Playwright journeys on an empty rca_e2e DB (no demo data), reading emails from the console mail log
```

To also run the S3 driver test, start an S3-compatible server and set `S3_TEST_ENDPOINT`:

```bash
docker run -d -p 9100:9090 -e COM_ADOBE_TESTING_S3MOCK_STORE_INITIAL_BUCKETS=rca-test adobe/s3mock
S3_TEST_ENDPOINT=http://localhost:9100 npm test
```

CI (`.github/workflows/ci.yml`) runs lint, all tests (the isolation suite as its own step as well), the Playwright suite and the image builds on every push and pull request.

Highlights:

| Area | Test |
|---|---|
| Tenant isolation | `apps/api/test/isolation.test.ts` attacks every `/rcas/:id` and workspace endpoint with another tenant's ids, checks lists, exports, downloads and audit logs for leaks, and fails when a new route has no case. `tenancy.test.ts` shows that queries without a scope throw. |
| Authentication | `authFlows.test.ts`: verification, single-use and expiring tokens, refresh rotation and reuse detection, CSRF, no enumeration, lockout and rate limits, Turnstile, reset and change password, email change. |
| Policy | `policy.unit.test.ts`, `sections.test.ts`, `workflow.test.ts` (solo user completes everything alone; contributors edit only their team). |
| Collaboration | `collaboration.test.ts`: workspace and RCA invitations, auto-accept after sign-up, members, transfer. |
| Quotas and hardening | `hardening.test.ts`: quotas, content checks, PDF sandbox never fetches external URLs, headers, admin and support access. |
| Lifecycle | `lifecycle.test.ts`: deletion rules, purge after the grace period, export zip. `migration.test.ts`: B2C migration up and down on legacy data. |
| Billing | `billing.test.ts`: the 3-RCA bucket, the watermark on every export, webhook idempotency and signatures, the client cannot mark anything paid, invite and seat gating, PAST_DUE/CANCELED behaviour. `stripe.unit.test.ts`: signature checks and event mapping. |
| End to end | `apps/web/e2e/`: sign up → verify → solo RCA → close → PDF/DOCX; invite a DEV contributor who edits only Dev; team workspace; reset password; onboarding sample RCA; settings; export and delete account; the free bucket, a TEST MODE unlock, Team subscribe and cancel. |

## Using it

1. **Sign up** and open the link in the verification email.
2. On the **welcome** screen, choose *Create my first RCA*, or *Create a sample RCA* to see a complete, labelled example.
3. Fill in the tabs: Header, Common, Dev, QA, Production, Closing. Each team tab auto-saves every 60 seconds; submit each section when it is done.
4. **Submit for review**, sign the five sign-off rows (the team rows first), then **Close RCA**.
5. Use **Print**, **PDF** or **Word** on any RCA. On the RCA list, **Export CSV / Excel** and **Blank template** are available.
6. **Share** an RCA, or create a team workspace under **Workspaces**, and invite people (needs the Team plan) by email with a role (and a team for contributors).
7. **Plans:** the free plan holds 3 unpaid RCAs per workspace, and their exports carry a watermark. Unlock a single RCA, or subscribe to **Solo** (unlimited, no watermark) or **Team** (adds invitations, per seat) under **Account settings → Billing**. Locally, payments use the mock provider: checkout is a **TEST MODE** page with buttons to simulate success, failure or cancel. See `docs/STRIPE_SETUP.md` to switch to Stripe.
8. **Account settings** has profile, password, sessions, usage, **Download my data**, the security log and **Delete my account**.

## Deploy

```bash
cp .env.prod.example .env.prod      # fill in every value (docs/DEPLOY.md)
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

This starts Caddy (automatic HTTPS), the API (migrations on start, non-root, sandboxed PDF), PostgreSQL and nightly verified backups. Follow `docs/DEPLOY.md` for DNS, the email provider (SPF, DKIM, DMARC), the storage bucket, backups and restore, the pre-launch checklist, and how to promote yourself to platform operator.

## Migrating from the internal version

`prisma migrate deploy` converts an existing internal-tool database:

- **Users:** each user gets a personal workspace.
- **Companies:** each company becomes a shared workspace, with every user's old role mapped (Admin/Owner → Owner, Lead → Editor, Dev/QA/Prod → Contributor for that team, Viewer → Viewer).
- **RCAs:** they move into their company's workspace.

A tested reverse script is in the migration folder. Take a `pg_dump` first. Remove the old demo accounts with `npm run purge:demo -w @rca/api -- --confirm` (a dry run without `--confirm` shows what would go).
