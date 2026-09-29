# Switching billing to Stripe

The app runs on the **mock payment provider** until you complete this checklist. The mock needs no account, makes no external calls and labels every checkout **TEST MODE**. The production config refuses to start with the mock unless `ALLOW_MOCK_PAYMENTS=true` (only use that on a staging server).

Do everything below in Stripe **test mode** first (keys starting `sk_test_`). The Billing page and checkout keep showing a TEST MODE chip while a test key is in use. Repeat the steps in live mode when the test run is clean.

## 1. Products and prices

In the Stripe dashboard, open **Product catalog** and create four prices. The amounts must match the `*_PRICE_CENTS` variables, because the app shows those numbers on the pricing page and in the Billing tab, while Stripe charges its own price.

| Product | Price | Type | Env var for the price ID | Env var for the displayed amount |
|---|---|---|---|---|
| RCA unlock | e.g. 9.00 USD | One-time | `STRIPE_PRICE_RCA_UNLOCK` | `RCA_UNLOCK_PRICE_CENTS` |
| Solo | e.g. 12.00 USD | Recurring, monthly | `STRIPE_PRICE_SOLO_MONTHLY` | `SOLO_MONTHLY_PRICE_CENTS` |
| Team base | e.g. 29.00 USD | Recurring, monthly | `STRIPE_PRICE_TEAM_BASE` | `TEAM_BASE_PRICE_CENTS` |
| Team seat | e.g. 8.00 USD | Recurring, monthly, **per unit** | `STRIPE_PRICE_TEAM_SEAT` | `TEAM_SEAT_PRICE_CENTS` |

All four prices must be in the currency set in `BILLING_CURRENCY` (default `USD`). A Team checkout has two line items: the base price with quantity 1 and the seat price with quantity = seats.

## 2. Webhook endpoint

Open **Developers → Webhooks → Add endpoint**:

- **URL:** `https://<your-domain>/api/v1/webhooks/payment`
- **Events:**
  - `checkout.session.completed`
  - `checkout.session.async_payment_succeeded`
  - `checkout.session.async_payment_failed`
  - `invoice.paid`
  - `invoice.payment_failed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`

Copy the endpoint's **signing secret** (`whsec_…`) into `STRIPE_WEBHOOK_SECRET`. The endpoint verifies the `Stripe-Signature` header over the raw body, with a 5-minute timestamp tolerance, and answers 400 to anything unsigned or tampered with. Stripe retries failed deliveries. Every event is recorded once in `billing_events` (unique on provider and event ID), so a retry is harmless.

## 3. Customer portal

Open **Settings → Billing → Customer portal** and enable:

- cancel subscriptions (at the end of the period or immediately, your choice);
- update the quantity of the **Team seat** price (the app refuses fewer seats than are in use when you start a checkout, but the portal does not know that, so set a sensible minimum there as well);
- invoice history;
- payment method updates.

The Billing tab's **Manage billing** button opens this portal for workspaces that have a Stripe customer.

## 4. Environment

In `.env.prod` (or `apps/api/.env` for a local test):

```bash
PAYMENT_PROVIDER=stripe
STRIPE_SECRET_KEY=sk_test_...          # sk_live_... in production
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_RCA_UNLOCK=price_...
STRIPE_PRICE_SOLO_MONTHLY=price_...
STRIPE_PRICE_TEAM_BASE=price_...
STRIPE_PRICE_TEAM_SEAT=price_...
BILLING_CURRENCY=USD
RCA_UNLOCK_PRICE_CENTS=900
SOLO_MONTHLY_PRICE_CENTS=1200
TEAM_BASE_PRICE_CENTS=2900
TEAM_SEAT_PRICE_CENTS=800
```

The API refuses to start with `PAYMENT_PROVIDER=stripe` if any `STRIPE_*` variable is missing. Remove `ALLOW_MOCK_PAYMENTS` and `MOCK_WEBHOOK_SECRET`. With Stripe active, the TEST MODE checkout and portal routes answer 404.

For a local test, forward events with the Stripe CLI: `stripe listen --forward-to localhost:4000/api/v1/webhooks/payment`, and use the `whsec_…` it prints.

## 5. Verify the provider code

`apps/api/src/billing/providers/stripe.ts` was written against Stripe's documented API but has not yet run against a real account. Check each `TODO(stripe-verify)` marker in test mode, fix what differs, and remove the marker:

| Marker | What to check |
|---|---|
| `post()` error handling | A bad price ID or key returns a readable error; the Idempotency-Key header is accepted. |
| One-time checkout | `mode=payment` with `customer_creation=always` creates a customer, so the portal works later; `metadata` and `client_reference_id` arrive on `checkout.session.completed`. |
| Subscription checkout | The Team base (qty 1) and seat (qty = seats) lines are created; `subscription_data.metadata` (workspace_id, plan, seats) is copied onto the subscription. |
| Portal | The portal configuration from step 3 applies. |
| Period end on activation | `checkout.session.completed` has no period end, so a placeholder of 30 days is used until the next `customer.subscription.updated` or `invoice.paid` corrects it. Confirm that event follows. |
| Invoice metadata | On newer API versions the subscription metadata on an invoice is under `parent.subscription_details.metadata`. Pin the API version in your account, or read both places. |
| `current_period_end` | On newer API versions it moved to the subscription items. Read it from wherever your pinned version puts it. |

Then run this test-mode checklist with card `4242 4242 4242 4242` (and `4000 0000 0000 0341` for a failing renewal):

1. Unlock an RCA. It shows **Unlocked**, the PDF has no watermark, and the Billing history shows a paid row.
2. Subscribe to Solo, then Team with 2 seats. Invitations work, and the plan and renewal date show in Billing.
3. Change seats in the portal. The seat count updates after `customer.subscription.updated`.
4. Trigger a failed renewal (`stripe trigger invoice.payment_failed`, or the failing card with a test clock). The owner sees the past-due warning, invitations are blocked, and collaborators become read-only.
5. Cancel in the portal. Status shows **Canceled**; paid RCAs stay unlocked.
6. Resend an event from the dashboard. Nothing changes (it shows as `duplicate` in `billing_events.result`).

No other file changes are needed. The routes, the entitlement rules and the UI are provider-independent, and every state change still goes through `handleBillingEvent()` in `apps/api/src/billing/events.ts`.
