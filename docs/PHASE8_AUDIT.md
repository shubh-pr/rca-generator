# Phase 8 billing audit

Scope: branch `phase-8-billing` (PR #1). Every item has evidence: a `file:line` reference, quoted code, or a passing test. The API tests were run with `npm test` and the browser tests with `npm run test:e2e`. Everything uses the mock provider, and nothing calls Stripe.

**Changes made during the audit:**
- One real bug found and fixed (1.4).
- 11 API tests added (`apps/api/test/billingAudit.test.ts`).
- 6 Playwright journeys added (`apps/web/e2e/billingAudit.spec.ts`).

| # | Section | Result |
|---|---|---|
| 1 | Webhook trust boundary | **PASS** (1 bug fixed, 3 notes) |
| 2 | Idempotency | **PASS** |
| 3 | Full flow, automated in the browser | **PASS** (6/6 new journeys, 17/17 overall) |
| 4 | Workspace quota | **PASS** (1 documented exception) |
| 5 | GitHub token scope | **Rotation recommended** (not a merge blocker) |
| 6 | CI on the PR merge commit | See section 6 |

---

## 1. Webhook trust boundary

### 1.1 `/webhooks/payment` verifies the provider before processing anything: PASS

The route is mounted **before** CORS and the JSON parser, so the raw bytes reach the signature check (`apps/api/src/app.ts:76-79`):

```ts
// Payment webhooks need the raw body for signature checks: mounted before the JSON parser and CORS.
app.use('/api/v1', webhookRouter);
app.use(cors(...));
app.use(express.json({ limit: '1mb' }));
```

The route handler is `apps/api/src/routes/billing.ts:34-49`. Verification happens in `parseWebhook`. Nothing reaches `handleBillingEvent` unless it returns, and a failure answers 400:

```ts
webhookRouter.post('/webhooks/payment', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  const provider = paymentProvider();
  let events;
  try {
    events = await provider.parseWebhook(Buffer.isBuffer(req.body) ? req.body : Buffer.from(''), req.headers ...);
  } catch (err) {
    if (err instanceof WebhookVerificationError || err instanceof SyntaxError) {
      ...
      res.status(400).json({ error: 'INVALID_WEBHOOK', message: 'Webhook signature or payload is invalid' });
      return;
    }
    throw err;
  }
  ...
  for (const e of events) results.push({ id: e.id, type: e.type, ...(await handleBillingEvent(provider.name, e)) });
```

Only the **active** provider verifies requests (`apps/api/src/billing/providers/index.ts:9-11`). With `PAYMENT_PROVIDER=stripe`, a mock-signed request is rejected.

**What "authenticity" means for the mock provider** (`apps/api/src/billing/providers/mock.ts:53-55`) is an HMAC-SHA256 of the exact raw body with `MOCK_WEBHOOK_SECRET`, compared in constant time:

```ts
const signature = headers['x-mock-signature'] ?? '';
if (!signature || !safeEqual(signature, signMockWebhook(rawBody.toString('utf8')))) throw new WebhookVerificationError('bad mock signature');
```

An arbitrary unauthenticated request cannot fake a payment for another workspace unless it knows the secret. In production:
- the mock is refused outright unless `ALLOW_MOCK_PAYMENTS=true` (`apps/api/src/config.ts:131`);
- if the mock *is* allowed (staging), the public default secret is refused (`apps/api/src/config.ts:135`).

Stripe events are verified with the `Stripe-Signature` scheme: HMAC of `t.body` with a 300 s tolerance (`apps/api/src/billing/providers/stripe.ts`, `verifySignature`).

**Tests (all pass):**

| Test | Proves |
|---|---|
| `billingAudit.test.ts:42` "an unauthenticated request cannot fake a payment for any workspace: no signature, wrong secret, or a signature over another body" | 400 `INVALID_WEBHOOK` in all 3 cases, 0 `billing_events` rows, victim's RCA unpaid and workspace `NONE` |
| `billingAudit.test.ts:76` "with PAYMENT_PROVIDER=stripe, mock-signed webhooks are rejected and the TEST MODE routes are 404" | Only the active provider is trusted; the mock routes disappear |
| `billingAudit.test.ts:64` "TEST MODE checkout and portal routes need a login, the buyer, and the paying owner" | The mock complete and portal routes answer 401 without a login and 404 for a stranger |
| `billing.test.ts:185` "rejects unsigned or tampered webhooks (400) without changing anything" | |
| `billing.test.ts:207` "only the buyer can complete a mock checkout; events for a mismatched session are ignored" | An event naming a checkout session for a different RCA or workspace is `ignored` (`events.ts:56-58`) |
| `billing.test.ts:228` "refuses the mock provider in production unless explicitly allowed (staging)" | |
| `stripe.unit.test.ts` | Stripe signature: valid, wrong secret, expired timestamp |

**Note A:** the mock's default secret, `mock-webhook-secret-for-tests`, is in the repository. That is acceptable only because production refuses it (`config.ts:135`). A server started with `NODE_ENV=development` and exposed to the internet would accept forged mock events. `docs/DEPLOY.md` requires `NODE_ENV=production`.

### 1.2 Every write of `paid_at` and `subscription_status`: PASS, with the entry points listed

Grep command: `grep -rnE "paid_at|payment_reference|subscription_status|current_period_end|subscription_ref|payment_customer_ref"` over `apps/api/src`, `prisma/seed.ts`, `scripts` and `test`, plus every `workspace.update/create` and `rca.update/create` call.

**Production writes: all in one function, `apply()` in `apps/api/src/billing/events.ts`, called only from `handleBillingEvent()` (`events.ts:18-49`):**

| Field | Write | Line |
|---|---|---|
| `rca.paid_at`, `rca.payment_reference` | `tx.rca.update({ ... data: { paid_at: occurred, payment_reference: ... } })`, only if `!rca.paid_at` | `events.ts:74` |
| `workspaces.subscription_status` (with plan, seats, refs, period end) | SUBSCRIPTION_ACTIVATED | `events.ts:113-123` |
| `workspaces.subscription_status` | SUBSCRIPTION_RENEWED | `events.ts:137` |
| `workspaces.subscription_status` | SUBSCRIPTION_PAST_DUE / SUBSCRIPTION_CANCELED | `events.ts:147` |

There is one write path per field: `handleBillingEvent → apply`. `subscription_status` has three statements inside that one function, one per event type.

**Other RCA and workspace writes checked; none can set a billing field:**
- `PATCH /rcas/:id` spreads the body (`apps/api/src/routes/rca/core.ts:38`), but the body passes `z.object(rcaEditableFields).partial().strict()` (`core.ts:17`). `rcaEditableFields` has no billing field, and `.strict()` rejects unknown keys. Test `billing.test.ts:193` sends `{ paid_at }` and gets 400.
- `POST /rcas` uses a `.strict()` schema without billing fields (`apps/api/src/routes/rcas.ts:24`).
- These write only name, owner or status fields: `workspaces.ts:54` (create), `:62` (rename), `:140` (transfer), `lifecycle.ts:49,79` (owner handover), `accounts.ts:10` (personal workspace), `workflow.ts` and `core.ts:49` (RCA status and soft delete).
- The migration sets `plan` to `NONE` for existing rows and never grants a plan (`prisma/migrations/20260930090000_phase8_billing/migration.sql:19-23`).

**Entry points into `handleBillingEvent`**, the only writer:

| Caller | When it exists | Guard |
|---|---|---|
| `routes/billing.ts:48`, `POST /webhooks/payment` | Always | Provider signature (1.1) |
| `billing/mockActions.ts:17` via `POST /billing/mock/sessions/:sid/complete` and `POST /billing/mock/portal/:wid` (`routes/billing.ts:141,149`) | **Mock provider only**; `requireMock()` returns 404 otherwise (`routes/billing.ts:128-130`, test `billingAudit.test.ts:76`) | Logged in; only the checkout's creator (`mockActions.ts:24`); portal only for the paying owner (`assertBillingOwner`) |
| `prisma/seed.ts` (demo Team plan) | Development seed only | `NODE_ENV=development` and `SEED_DEMO=true` |
| `test/helpers.ts` `subscribe()` and `subscriptionEvent()` | Tests | n/a |

These mock and test callers skip the HTTP webhook, but they go through the same handler, the same dedupe and the same audit. They never write the columns directly. The mock routes are the stand-in for "the provider says it was paid", which is the purpose of TEST MODE. Production cannot run the mock (1.1).

**Flagged, as requested (test-only direct write):** `apps/api/test/billing.test.ts:120` writes `current_period_end` directly:

```ts
await raw(() => db.workspace.update({ where: { id: ws }, data: { current_period_end: new Date(Date.now() - 1000) } }));
```

It simulates the passage of time for the test "an expired period ends the subscription even without a cancellation event". It is not a production path, and it sets neither `paid_at` nor `subscription_status`. No other test or helper writes billing columns directly.

### 1.3 The success redirect only reads state: PASS

- The server builds the redirect URLs as plain web routes (`apps/api/src/billing/service.ts:36-37, 68-69`): `/rcas/:id?checkout=done` and `/settings/billing?checkout=done`. No API route reads a `checkout` query parameter (grep for `checkout=` finds only these four lines).
- In the web app, the `?checkout=` parameter is handled only by `CheckoutNotice` (`apps/web/src/components/BillingBits.tsx:17-37`). It reads the parameter, shows a message, and its only side effect is removing the parameter from the URL:

  ```tsx
  const [params, setParams] = useSearchParams();
  const result = params.get('checkout');
  ...
  params.delete('checkout');
  setParams(params, { replace: true });
  ```

  The pages it renders on (RCA view and Billing) only issue GET queries on load. Writes happen only from buttons the user clicks.
- Test `billing.test.ts:193` shows that starting a checkout and never completing it changes nothing. That is exactly the situation of a user who opens the success URL by hand.
- The TEST MODE checkout page (`apps/web/src/pages/billing/TestCheckoutPage.tsx:31`) does POST. It plays the role of the provider's hosted checkout, not the redirect, and it only exists with the mock provider.

### 1.4 Bug found and fixed: a double-clicked TEST MODE payment was recorded twice

`completeMockCheckout` checked `status === 'OPEN'` outside the transaction and gave each event a random id (`mockActions.ts:25` before the fix). Two concurrent "success" requests both passed the check and produced two distinct events, so two PAID history rows and two audit rows.

**Fix:** the event ids now derive from the checkout session (`apps/api/src/billing/mockActions.ts:29`, ``const eventId = (what: string) => `mock_evt_${s.id}_${what}` ``). The second request produces the same ids, and the `billing_events` unique constraint makes it a no-op.

**Proof:** test `billingAudit.test.ts:88` "a double-clicked TEST MODE success (two concurrent completes) records the payment once". It **failed 3 of 3 runs against the pre-fix code** (`expected 2 to be 1`) and passes with the fix.

Stripe is not affected: it uses Stripe's unique event id (`stripe.ts`, `mapStripeEvent`: `base = { id: event.id }`).

**Note B (for the Stripe swap-in, not a merge blocker):** two unlock checkouts for the same RCA can be opened before either is paid. If both are paid, the second payment is recorded as "rca already paid; payment recorded" (`events.ts:80`), so the customer paid twice and needs a manual refund. A later fix: refuse a new unlock checkout while one is OPEN, or expire the older Stripe session.

---

## 2. Idempotency

### 2.1 Dedupe mechanism: PASS

The schema (`apps/api/prisma/schema.prisma:635-649`) and the migration (`migration.sql:86`):

```prisma
/** Append-only log of every provider event; UNIQUE(provider, provider_event_id) makes replays no-ops. */
model BillingEvent {
  ...
  provider_event_id String    @db.VarChar(200)
  ...
  @@unique([provider, provider_event_id])
}
```
```sql
CREATE UNIQUE INDEX "billing_events_provider_provider_event_id_key" ON "billing_events"("provider", "provider_event_id");
```

Insert-first, inside the same transaction as the state change (`apps/api/src/billing/events.ts:20-34`):

```ts
prisma.$transaction(async (tx) => {
  // ON CONFLICT DO NOTHING: a replay (or a concurrent duplicate) inserts nothing and changes nothing.
  const inserted = await tx.billingEvent.createMany({ data: [{ provider, provider_event_id: evt.id, ... }], skipDuplicates: true });
  if (inserted.count === 0) return { status: 'duplicate' as const, result: 'already processed' };
```

This is not a lookup-before-write, so there is no read-then-insert race. A concurrent duplicate waits on the unique index and then inserts nothing. If applying the event throws, the whole transaction rolls back, including the `billing_events` row, so the provider's retry is processed (`events.ts:40`).

### 2.2 Replay tests for each event type: PASS (written and run)

Each test delivers the same event several times, both sequentially and **concurrently** (`Promise.all`). It asserts exactly one `processed` result, and `duplicate` for the rest. It checks the effect columns, the `billing_events` row count and the `audit_log` row count. Where it matters, the test replays the event *after a later state change* to show a replay cannot roll state back.

| Event type | Test (`apps/api/test/billingAudit.test.ts`) | Asserts | Result |
|---|---|---|---|
| PAYMENT_SUCCEEDED | `:99` "PAYMENT_SUCCEEDED: one unlock, one history row, one audit row; paid_at is not rewritten" | 3 concurrent replays → `duplicate`; `paid_at` unchanged; 1 event row, 1 history row, 1 audit row | PASS |
| SUBSCRIPTION_ACTIVATED | `:112` "SUBSCRIPTION_ACTIVATED: a replay after cancellation does not re-activate; one audit row" | Concurrent pair → `[duplicate, processed]`; a replay after CANCELED leaves it CANCELED; 1 event row, 1 audit row | PASS |
| SUBSCRIPTION_PAST_DUE | `:123` "SUBSCRIPTION_PAST_DUE: a replay after renewal does not flip the workspace back to past due" | Concurrent pair; a replay after RENEWED stays ACTIVE; 1 event row, 1 audit row | PASS |
| SUBSCRIPTION_CANCELED | `:136` "SUBSCRIPTION_CANCELED: replays write no further audit rows and a re-subscription is not undone by them" | 3 concurrent → 1 processed; a replay after re-subscribing stays ACTIVE; 1 event row, 1 audit row | PASS |

These existed before and still pass: `billing.test.ts:169` "replaying the same webhook event does not double-process it", and `billingAudit.test.ts:88` (the double-click in 1.4).

---

## 3. Full flow, automated in the browser (Playwright, mock provider buttons)

Every step goes through the UI and the TEST MODE **Simulate successful payment / Simulate failed payment / Cancel** buttons, plus the TEST MODE portal. No API shortcuts. "Watermark on the export" is checked on two formats: the downloaded **Word** file (JSZip, header XML contains `FREE PLAN`) and the **print page**, which is the HTML the PDF is rendered from (`[data-billing-watermark]` inside the print iframe). The helper asserts that both agree. The PDF itself is covered by the API watermark matrix (`billing.test.ts:127`, every combination across print, PDF and DOCX).

Run: `npm run test:e2e`, **17 passed, 0 failed** (11 before the audit, plus 6 new).

| Requirement | Test (`apps/web/e2e/billingAudit.spec.ts`) | Result |
|---|---|---|
| 3 RCAs, the 4th blocked with BUCKET_FULL, delete one, creation allowed again | `:80` "bucket: 3 RCAs fill it, the 4th is blocked with BUCKET_FULL; deleting one allows creation again" | PASS |
| Unlock one RCA: its export loses the watermark, and the bucket still shows the other 2 unpaid | `:101` "unlock: a simulated payment removes the watermark from that RCA only; the other 2 unpaid RCAs still count". Checks the export before (watermarked) and after (clean), a second RCA still watermarked, and "2 of 3 unpaid RCAs" | PASS |
| Solo: cap and watermark gone workspace-wide, invite still blocked | `:119` "Solo: removes the cap and the watermark workspace-wide, but invitations stay blocked". A 4th RCA is created past the free cap, the export is clean, and inviting shows `blocked-SUBSCRIPTION_REQUIRED` | PASS |
| Team: subscribe, invite a collaborator, they can access | `:142` "Team: subscribe, invite a collaborator, and they can open and edit their section" | PASS |
| Payment failure and mid-checkout cancel leave the state unchanged | `:162` "failed and canceled checkouts leave the workspace unchanged (no partial activation or unlock)". Four steps: Team failure, Team cancel, unlock failure then cancel, then invites still blocked and the history shows only "Failed". After each step: plan Free, status "No subscription", no billing account, "1 of 3 unpaid", watermark present, no paid badge | PASS |
| PAST_DUE: cap and watermark return, the individually paid RCA stays unlocked, the collaborator is read-only (not removed), the owner banner appears | `:218` step "SUBSCRIPTION_PAST_DUE". Checks: owner `billing-alert` says "past due"; paid RCA keeps its badge and a clean export; the other RCAs are watermarked; the contributor sees `read-only-banner` and their Dev field is disabled; they are still listed in the Share panel; new invites are blocked; the bucket shows "2 of 3" (the paid RCA not counted), one more RCA fits, the next gets BUCKET_FULL | PASS |
| CANCELED after PAST_DUE | `:218` step "SUBSCRIPTION_CANCELED after PAST_DUE". Status "Canceled", banner says "canceled", the same checks as above, bucket "3 of 3" and still blocked | PASS |

These existed before and still pass: `billing.spec.ts:4` and `:53`, and `collaboration.spec.ts:4` and `:43`, which now subscribe to Team through the TEST MODE checkout before inviting.

---

## 4. Workspace quota (`QUOTA_OWNED_WORKSPACES=5`)

### 4.1 Where it is enforced; env-only: PASS

- **Definition:** `apps/api/src/config.ts:76`, `QUOTA_OWNED_WORKSPACES: int(5, 1)` (an integer ≥ 1, default 5). It is exposed as `config.quota.ownedWorkspaces` (`config.ts:204`).
- **Enforcement:** `withinWorkspaceQuota` (`apps/api/src/services/quota.ts:45-55`). It takes the user's advisory lock (`:48`), counts `workspace` rows with `owner_id = user`, and throws `422 QUOTA_EXCEEDED` when `owned >= limit` (`:51`).
- **Used by:** `POST /workspaces` (`apps/api/src/routes/workspaces.ts:54`). This is the only route that creates a workspace for an existing user.
- **Configured in:** `apps/api/.env.example:30`, `docs/DEPLOY.md:91`. No code change is needed: test `billingAudit.test.ts:162` shows `loadConfig` reads the variable (default 5, `8` gives 8, `0` is rejected at startup), and that the route reads the loaded value on each request (limit 2 enforced at the 3rd workspace).

**Not counted, by design (documented in `docs/ASSUMPTIONS.md`, Phase 8):**
- The personal workspace created at sign-up (`accounts.ts:10`) is always #1.
- **Ownership transfer** (`workspaces.ts:140`) and the owner handover when an account is deleted (`lifecycle.ts:49,79`) can put the recipient above the limit. This creates no new bucket (the workspace already existed), so it cannot be used to gain free RCAs beyond what extra accounts would give anyway.

### 4.2 The 6th workspace gets a clear, correctly coded rejection: PASS

Test `billingAudit.test.ts:153` "the 6th owned workspace is refused with 422 QUOTA_EXCEEDED and a clear message" creates workspaces 2 to 5 (201 each), then the 6th:

```json
{ "error": "QUOTA_EXCEEDED", "message": "You can own up to 5 workspaces. Delete one you no longer need.", "details": { "limit": 5, "used": 5 } }
```

It returns HTTP 422, not 500, and the owner still owns exactly 5 workspaces. The concurrent version (5 parallel creates → four 201s and one 422, never 6 owned) is `billing.test.ts:110`.

### 4.3 Invitations are not affected: PASS

The count is `workspace.count({ where: { owner_id: userId } })` (`quota.ts:49-51`), so membership never counts. Test `billingAudit.test.ts:177` "only OWNED workspaces count: a user at the limit can still be invited to other workspaces and RCAs":
- the user owns 5 workspaces;
- they accept an invitation to another user's workspace and another to a single RCA (both `accepted: true`);
- they can open the RCA and are a member of 6 workspaces;
- they still own 5, and still cannot create a 6th (422).

---

## 5. GitHub token scope

This was checked without printing the token. The credential was read through `git credential fill` and sent only to `GET https://api.github.com/user`. From the response headers:

| Check | Result |
|---|---|
| Remote | `https://github.com/shubh-pr/rca-generator.git` (HTTPS, not SSH) |
| Credential helpers | `osxkeychain` (system gitconfig) **and** `store` (`~/.gitconfig`) |
| Token type | Prefix `gho_` = **OAuth app token**. Not a classic PAT (`ghp_`), not a fine-grained PAT (`github_pat_`), not SSH. OAuth client id `01ab8ac9400c4e429b23`; the app that created it is listed at github.com/settings/applications |
| `x-oauth-scopes` | `read:user, repo, user:email, workflow` |
| Expiration header | None. OAuth app tokens do not expire until revoked |
| Account | `shubh-pr` (User) |

**Plain answer:** this is an **OAuth app token**. It has **no** `admin:org`, `delete_repo`, `admin:repo_hook` or `write:packages`. It is still broader than this project needs:
- `repo` gives full read and write access to **every** public and private repository of the account, not just `rca-generator`;
- `workflow` lets it change GitHub Actions workflow files in any of them.

**Plaintext copy on disk:** `~/.git-credentials` exists (mode 600) and holds a `github.com` entry, written by the `store` helper, so a token is stored unencrypted on disk. Comparing it with the keychain token would have meant reading the secret, and that check was blocked. Whether it is the same token is unverified.

**Recommendation: rotate.**
1. Revoke this OAuth authorization at github.com/settings/applications.
2. Create a **fine-grained PAT** limited to `shubh-pr/rca-generator`, with an expiry:
   - Contents: read and write
   - Pull requests: read and write
   - Actions: read
   - Workflows: read and write, only while `.github/workflows` changes are needed
3. Remove the plaintext store: run `git config --global --unset credential.helper store` and delete `~/.git-credentials`, keeping the keychain helper only.

---

## 6. CI on the PR merge commit

The workflow triggers are `push` to `main` and `pull_request` (`.github/workflows/ci.yml:3-6`). There are no push runs for feature branches, so every run of this branch is a `pull_request` run. GitHub runs that event on the PR's merge commit (`refs/pull/1/merge`).

_Filled in after the audit commit's CI run completes; see below._

---

## Overall verdict

_See the end of section 6._
