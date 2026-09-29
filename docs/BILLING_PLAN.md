# Billing plan (Phase 8)

This plan adds monetization to the multi-tenant RCA app: a free bucket of 3 unpaid RCAs per workspace, per-RCA one-time unlocks, and Solo/Team subscriptions. All of it sits behind a payment-provider interface, so the whole flow runs and is tested with a **mock provider** and Stripe can be switched in later without touching business logic.

Branch: `phase-8-billing`. Judgement calls are recorded in `docs/ASSUMPTIONS.md` under "Phase 8"; the Stripe checklist is in `docs/STRIPE_SETUP.md`.

## 1. Architecture

```
routes (billing.ts, webhooks.ts)
   │  create checkout / portal                      verified callback → internal events
   ▼                                                 ▼
PaymentProvider (interface)  ──────────────►  billing/events.ts  handleBillingEvent()
   ├─ MockPaymentProvider (default)                  │  dedupe (billing_events), apply, audit, history
   └─ StripePaymentProvider                          ▼
                                             workspaces.subscription_*, rca.paid_at, billing_history
                                                     │
entitlements.ts (single source of truth) ◄───────────┘
   used by: RCA create (bucket), access (collaborator read-only), invites (Team + seats),
            export/print (watermark), UI flags
```

**Rules of the design:**

- **Only verified events change state.** Payment state (`paid_at`, `subscription_status`, `plan`, `current_period_end`, `seats`) changes **only** inside `handleBillingEvent()`, which accepts **only internal events** from a provider's verified callback. Checkout "success" redirects change nothing.
- **Providers translate, they don't decide.** A provider converts its own payloads into internal events. Business rules read only from `src/billing/entitlements.ts`.

## 2. Provider interface (contract)

```ts
interface PaymentProvider {
  readonly name: 'mock' | 'stripe';
  readonly testMode: boolean;
  createOneTimeCheckout(input: { rcaId; workspaceId; sessionId; amount: Money; customerRef?; customerEmail; successUrl; cancelUrl }): Promise<{ url; providerSessionId }>;
  createSubscriptionCheckout(input: { workspaceId; plan: 'SOLO'|'TEAM'; seats; sessionId; customerRef?; customerEmail; successUrl; cancelUrl }): Promise<{ url; providerSessionId }>;
  createBillingPortalSession(input: { workspaceId; customerRef; returnUrl }): Promise<{ url }>;
  /** Verify authenticity (signature) and translate the provider payload into internal events. Throws on bad signature. */
  parseWebhook(rawBody: Buffer, headers: Record<string, string | undefined>): Promise<InternalBillingEvent[]>;
}

type InternalBillingEvent = {
  id: string;                   // provider event id; dedupe key together with the provider name
  type: 'PAYMENT_SUCCEEDED' | 'PAYMENT_FAILED' | 'SUBSCRIPTION_ACTIVATED'
      | 'SUBSCRIPTION_RENEWED' | 'SUBSCRIPTION_PAST_DUE' | 'SUBSCRIPTION_CANCELED';
  workspaceId: string;
  checkoutSessionId?: string;   // our checkout_sessions.id (sent to the provider as metadata)
  rcaId?: string;               // RCA unlock payments
  kind?: 'RCA_UNLOCK' | 'SUBSCRIPTION';
  plan?: 'SOLO' | 'TEAM'; seats?: number;
  subscriptionRef?: string; customerRef?: string;
  periodEnd?: string;           // ISO timestamp
  amountCents?: number; currency?: string;
  reference?: string;           // payment / invoice id shown in billing history
  occurredAt: string;
};
```

- **Choosing the provider:** `PAYMENT_PROVIDER=mock|stripe`, default `mock`. The **mock provider is refused when `NODE_ENV=production`** unless `ALLOW_MOCK_PAYMENTS=true` (for staging only). Otherwise anyone could unlock paid features for free.

### MockPaymentProvider

- **Checkout:** the checkout URL is an internal web page, `/billing/test-checkout/:sessionId`, with a prominent **TEST MODE** banner. It offers *Pay (simulate success)*, *Simulate failure* and *Cancel*. The page calls `POST /api/v1/billing/mock/sessions/:id/complete {outcome}`. The server (acting as the provider) builds the internal events and runs them through the **same** `handleBillingEvent()` path as a real webhook.
- **Portal:** `/billing/test-portal/:workspaceId` offers *Renew*, *Change seats*, *Simulate payment failure (past due)* and *Cancel subscription*. These actions emit `SUBSCRIPTION_RENEWED`, `SUBSCRIPTION_ACTIVATED`, `PAYMENT_FAILED` + `SUBSCRIPTION_PAST_DUE`, and `SUBSCRIPTION_CANCELED`.
- **Webhook:** `POST /api/v1/webhooks/payment` accepts mock events signed with `MOCK_WEBHOOK_SECRET` (HMAC-SHA256 in `x-mock-signature`). Tests use it to replay events and prove idempotency.
- **Isolation:** no external calls and no API keys. The mock-only endpoints return 404 unless the mock provider is active.

### StripePaymentProvider

Everything below is implemented with `fetch` against the Stripe REST API, so no SDK dependency is needed. The API calls are marked `TODO(stripe-verify)` until they have been run against a Stripe test-mode account. Signature verification and event mapping are unit-tested with fixture payloads.

- **Checkout:** Stripe Checkout Sessions in `mode=payment` with `STRIPE_PRICE_RCA_UNLOCK`, and in `mode=subscription` with `STRIPE_PRICE_SOLO_MONTHLY`, or `STRIPE_PRICE_TEAM_BASE` + `STRIPE_PRICE_TEAM_SEAT` × seats. `metadata` and `client_reference_id` carry `workspace_id`, `rca_id`, `checkout_session_id` and `plan`.
- **Portal:** `POST /v1/billing_portal/sessions`.
- **Webhook signature:** the `Stripe-Signature` header (`t=…,v1=…`) is checked as HMAC-SHA256 over `"${t}.${rawBody}"` with `STRIPE_WEBHOOK_SECRET`, with a 5-minute tolerance and a constant-time comparison.
- **Event mapping:**

  | Stripe event | Internal event |
  |---|---|
  | `checkout.session.completed` (payment, `payment_status=paid`) | `PAYMENT_SUCCEEDED` |
  | `checkout.session.async_payment_succeeded` | `PAYMENT_SUCCEEDED` |
  | `checkout.session.async_payment_failed` | `PAYMENT_FAILED` |
  | `checkout.session.completed` (subscription) | `SUBSCRIPTION_ACTIVATED` |
  | `invoice.paid` (`billing_reason=subscription_cycle`) | `SUBSCRIPTION_RENEWED` |
  | `invoice.payment_failed` | `PAYMENT_FAILED` |
  | `customer.subscription.updated` (active) | `SUBSCRIPTION_ACTIVATED` |
  | `customer.subscription.updated` (past_due / unpaid) | `SUBSCRIPTION_PAST_DUE` |
  | `customer.subscription.updated` (canceled) | `SUBSCRIPTION_CANCELED` |
  | `customer.subscription.deleted` | `SUBSCRIPTION_CANCELED` |

  Every other event type is acknowledged and ignored.

## 3. Business rules → implementation

| Rule | Where |
|---|---|
| **Entitled** = `subscription_status = ACTIVE` and `current_period_end > now` | `entitlements.ts` `isSubscribed(ws)` |
| **Unpaid RCA** = `paid_at IS NULL`, not soft-deleted, and the workspace is not entitled | `unpaidRcaCount()` |
| **Bucket:** creating an RCA (including the onboarding sample) when the workspace is not entitled and has ≥ `FREE_RCA_LIMIT` (3) unpaid RCAs gives 422 `BUCKET_FULL` | `assertBucketRoom(tx, ws)` inside the existing quota transaction (per-owner advisory lock, so parallel creates cannot overshoot) |
| **Delete frees a slot:** soft-deleted RCAs are not counted. A paid RCA never counts, and there is no clawback on deletion | count query |
| **Per-RCA unlock:** the `PAYMENT_SUCCEEDED` event with `kind=RCA_UNLOCK` sets `paid_at` and `payment_reference` once and never unsets them | `events.ts` |
| **Solo:** removes the bucket cap and watermark for the workspace while entitled. Invites are not allowed | entitlements |
| **Team:** Solo plus invites. Seats = purchased collaborator seats; inviting beyond them gives 403 `SEAT_LIMIT_REACHED` | `assertCanInvite()` |
| **Invites without active Team** give 403 `SUBSCRIPTION_REQUIRED` (workspace and RCA invitations) | workspaces and collaborators routes |
| **Collaborators without active Team** are read-only: anyone other than the workspace's primary owner (members, co-owners, direct RCA collaborators) is capped to VIEWER. They are never removed | `policy/access.ts` caps the effective role; `permissions.read_only_reason = 'SUBSCRIPTION_INACTIVE'` |
| **`PAST_DUE` / `CANCELED`:** entitlement ends, so the bucket and watermark apply again from now on. Paid RCAs stay unlocked, collaborators become read-only, and the owner sees a warning (`GET /billing/alerts` feeds a banner) | entitlements |
| **Watermark:** any export (print, PDF, DOCX, and PDFs in "export my data") of an RCA that is unpaid **and** in a non-entitled workspace gets a free-plan watermark. It is a fixed, repeating, light band on every page plus a header note in DOCX, alongside the existing DRAFT watermark, and does not change the Section 7 layout | `export/model.ts` `billingWatermark`, `printHtml.ts`, `docx.ts` |
| **Pricing:** one config object from env: `BILLING_CURRENCY` (USD), `RCA_UNLOCK_PRICE_CENTS`, `SOLO_MONTHLY_PRICE_CENTS`, `TEAM_BASE_PRICE_CENTS`, `TEAM_SEAT_PRICE_CENTS`, `FREE_RCA_LIMIT`. Test defaults are 900 / 1200 / 2900 / 800 / 3 | `billing/pricing.ts`, `GET /billing/pricing` |

## 4. Data model (migration `phase8_billing`)

- **`workspaces`:** `plan` becomes enum `billing_plan` (`NONE`, `SOLO`, `TEAM`; the old `'FREE'` maps to `NONE`). Adds `subscription_status` enum (`NONE`, `ACTIVE`, `PAST_DUE`, `CANCELED`), `payment_customer_ref`, `subscription_ref`, `current_period_end` and `seats` (int, Team collaborator seats).
- **`rca`:** adds `paid_at` and `payment_reference`.
- **`checkout_sessions`:** our record of each checkout we start. Columns: `id`, `provider`, `provider_session_id`, `kind`, `workspace_id`, `rca_id`, `plan`, `seats`, `amount_cents`, `currency`, `status` (`OPEN`, `COMPLETED`, `FAILED`, `CANCELED`), `created_by`, timestamps. Events are cross-checked against it (same workspace, same RCA).
- **`billing_events`:** an append-only log of every provider event. Columns: `id`, `provider`, `provider_event_id`, `type`, `payload` jsonb, `workspace_id`, `received_at`, `processed_at`, `result`. It has UNIQUE(`provider`, `provider_event_id`). The insert happens in the same transaction as applying the event, so a replay is a no-op and a failure can be retried.
- **`billing_history`:** rows for the Billing tab. Columns: `workspace_id`, `rca_id`, `kind`, `description`, `amount_cents`, `currency`, `status` (`PAID`, `FAILED`), `reference`, `occurred_at`.
- **Audit:** every billing state change writes an audit row (`category DATA`, `workspace_id`, action `BILLING`, plus the internal event type), so owners see it in the workspace audit log. Paid RCAs also get the row in the RCA history.

## 5. API

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/billing/pricing` | public | Prices, currency, free limit, provider test mode |
| GET | `/billing/workspaces/:wid` | any member | Plan, status, period end, seats used/limit, bucket used/limit, `entitled`, `read_only_collaborators` |
| GET | `/billing/workspaces/:wid/history` | primary owner | Billing history |
| GET | `/billing/alerts` | any | Past-due or canceled workspaces the user primarily owns (in-app warning) |
| POST | `/billing/rca/:id/checkout` | OWNER/EDITOR of the RCA (after the capping above) | 409 if already paid |
| POST | `/billing/subscribe` `{workspace_id, plan, seats?}` | primary owner | 409 if already entitled with the same plan |
| POST | `/billing/portal` `{workspace_id}` | primary owner | Needs a customer ref |
| POST | `/webhooks/payment` | the provider | Raw body; the active provider verifies it |
| GET/POST | `/billing/mock/sessions/:id[/complete]`, `/billing/mock/portal/:wid` | mock only; the session creator or primary owner | Test-mode checkout and portal |

Every one of these is covered by the tenant-isolation suite (B gets 404 on A's RCA or workspace).

## 6. UI

- **Bucket indicator** on the RCA list and dashboard for the current workspace: "Free plan: 2 of 3 unpaid RCAs". The BUCKET_FULL blocked state has CTAs: unlock an RCA, delete one, or subscribe.
- **RCA page:** a "Free plan watermark" badge, **Unlock this RCA** (price shown), **Remove watermark — subscribe**, and a "Paid" badge. Read-only collaborators see a banner explaining why.
- **Public `/pricing` page:** plans and prices from `GET /billing/pricing`.
- **Account settings → Billing:** for each workspace the user owns: plan, status, renewal date, seats, history, **Manage billing**, and Subscribe buttons.
- **Owner warning:** a banner in the app layout for past-due or canceled subscriptions.
- **Invite blocked:** the invite form explains `SUBSCRIPTION_REQUIRED` and `SEAT_LIMIT_REACHED` with a link to Billing.
- **Test-mode pages:** the test checkout and test portal pages show a **TEST MODE — no real payment** banner. The Billing tab also shows a "Test mode" chip while the mock provider is active.

## 7. Tests (mock provider only; no external calls)

- **Bucket:** 3 allowed, the 4th gives `BUCKET_FULL`; delete frees a slot; paying frees a slot permanently, even after a subscription is canceled; the sample RCA counts; concurrent creates cannot exceed the limit.
- **Watermark matrix:** {paid, unpaid} × {subscribed, unsubscribed} for print HTML, PDF text on every page, and the DOCX header.
- **Idempotency:** the same signed webhook event posted twice is processed once (one history row, one audit row). A tampered signature gives 400.
- **Subscriptions:** Solo removes the cap. `PAST_DUE` and `CANCELED` bring back the cap and watermark from then on, while paid RCAs stay unlocked, collaborators become read-only (view 200, edit 403) and the owner sees an alert. Renewal extends the period. An expired period ends entitlement even without an event.
- **Invites:** blocked without Team (Solo and none give 403 `SUBSCRIPTION_REQUIRED`), allowed with Team, and 403 `SEAT_LIMIT_REACHED` when seats are used up.
- **Integrity:** the client cannot set `paid_at` (400 unknown field). A success redirect alone changes nothing. Only the session creator can complete a mock session. A payment failure leaves the RCA unpaid. A mock provider in production is refused by config validation.
- **Stripe unit tests:** signature verification (valid, wrong secret, expired timestamp) and mapping of fixture events to internal events.
- **E2E:**
  1. A solo user fills the 3-RCA bucket and sees the blocked state.
  2. They unlock one RCA through the TEST MODE checkout; the watermark disappears and a slot frees up.
  3. They subscribe to Team and invite a DEV contributor.
  4. They cancel in the test portal: the owner warning appears, invites are blocked and the contributor becomes read-only.

  The existing collaboration journeys subscribe to Team through the TEST MODE checkout first.

## 8. Switching to Stripe later

`docs/STRIPE_SETUP.md` is the full checklist. In short:

| Step | Where | What |
|---|---|---|
| 1 | Stripe dashboard | Create the four prices (unlock one-time; Solo, Team base, Team seat monthly). Keep the amounts equal to the `*_PRICE_CENTS` env vars. |
| 2 | Stripe dashboard | Add the webhook `https://<domain>/api/v1/webhooks/payment` with the seven events in section 2, and configure the customer portal. |
| 3 | `.env.prod` | `PAYMENT_PROVIDER=stripe`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_RCA_UNLOCK`, `STRIPE_PRICE_SOLO_MONTHLY`, `STRIPE_PRICE_TEAM_BASE`, `STRIPE_PRICE_TEAM_SEAT`. Config validation (`apps/api/src/config.ts`) refuses to start if any is missing. |
| 4 | `apps/api/src/billing/providers/stripe.ts` | Resolve the `TODO(stripe-verify)` markers against Stripe test mode. `mapStripeEvent()` is the only place that knows Stripe's event shapes; `apps/api/test/stripe.unit.test.ts` holds the fixtures, so update the fixtures from real payloads when you fix a marker. |
| 5 | Test mode | Run the checklist at the end of `STRIPE_SETUP.md`, then switch to live keys. |

Files that do **not** change: `billing/types.ts` (the contract), `billing/events.ts` (the only writer of billing state), `billing/entitlements.ts`, `billing/service.ts`, `routes/billing.ts` and the web UI. `providers/index.ts` already picks the provider from `PAYMENT_PROVIDER`. With Stripe active the TEST MODE pages and `/billing/mock/*` routes answer 404.

### Mock checkout sessions

A mock session is completed once. A simulated failure marks it `FAILED` (as `checkout.session.async_payment_failed` would), and the TEST MODE page then offers **Start over**, which creates a fresh session. This keeps one provider outcome per session, which is how the Stripe mapping works as well.
