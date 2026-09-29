/**
 * StripePaymentProvider: the same PaymentProvider contract against Stripe Checkout, Customer Portal
 * and Webhooks, using the REST API directly (no SDK).
 *
 * STATUS: webhook signature verification and event mapping are implemented and unit-tested with
 * fixture payloads (test/stripe.unit.test.ts). The outgoing API calls are written but have NOT been
 * run against a real Stripe account yet: every place marked TODO(stripe-verify) must be checked in
 * Stripe test mode before PAYMENT_PROVIDER=stripe goes live (docs/STRIPE_SETUP.md).
 *
 * Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_RCA_UNLOCK (one-time price),
 * STRIPE_PRICE_SOLO_MONTHLY (recurring), STRIPE_PRICE_TEAM_BASE (recurring, quantity 1),
 * STRIPE_PRICE_TEAM_SEAT (recurring, per-seat quantity).
 */
import { createHmac } from 'node:crypto';
import { safeEqual } from '../../auth/tokens.js';
import { config } from '../../config.js';
import { WebhookVerificationError, type InternalBillingEvent, type OneTimeCheckoutInput, type PaymentProvider, type PortalInput, type SubscriptionCheckoutInput } from '../types.js';

const API = 'https://api.stripe.com/v1';
const SIGNATURE_TOLERANCE_SECONDS = 300;

type Form = Record<string, string | number | undefined>;

export class StripePaymentProvider implements PaymentProvider {
  readonly name = 'stripe' as const;
  readonly testMode: boolean;

  constructor(private cfg = config.billing.stripe) {
    this.testMode = (cfg.secretKey ?? '').startsWith('sk_test_');
  }

  /** POST form-encoded to the Stripe API. TODO(stripe-verify): confirm error handling with a test-mode key. */
  private async post<T>(path: string, form: Form, idempotencyKey: string): Promise<T> {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(form)) if (v !== undefined) body.set(k, String(v));
    const res = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.cfg.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': idempotencyKey,
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json()) as T & { error?: { message?: string } };
    if (!res.ok) throw new Error(`Stripe ${path} failed: ${res.status} ${data.error?.message ?? ''}`);
    return data;
  }

  private customer(customerRef: string | null | undefined, email: string): Form {
    return customerRef ? { customer: customerRef } : { customer_email: email };
  }

  async createOneTimeCheckout(input: OneTimeCheckoutInput) {
    // TODO(stripe-verify): mode=payment with the one-time price; customer_creation makes later portal use possible.
    const s = await this.post<{ id: string; url: string }>(
      '/checkout/sessions',
      {
        mode: 'payment',
        'line_items[0][price]': this.cfg.priceRcaUnlock,
        'line_items[0][quantity]': 1,
        ...this.customer(input.customerRef, input.customerEmail),
        ...(input.customerRef ? {} : { customer_creation: 'always' }),
        client_reference_id: input.sessionId,
        'metadata[checkout_session_id]': input.sessionId,
        'metadata[workspace_id]': input.workspaceId,
        'metadata[rca_id]': input.rcaId,
        'metadata[kind]': 'RCA_UNLOCK',
        'payment_intent_data[metadata][checkout_session_id]': input.sessionId,
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
      },
      `rca-unlock-${input.sessionId}`,
    );
    return { url: s.url, providerSessionId: s.id };
  }

  async createSubscriptionCheckout(input: SubscriptionCheckoutInput) {
    // TODO(stripe-verify): Team = base price (qty 1) + seat price (qty = seats); metadata copied to the subscription.
    const lines: Form =
      input.plan === 'SOLO'
        ? { 'line_items[0][price]': this.cfg.priceSoloMonthly, 'line_items[0][quantity]': 1 }
        : {
            'line_items[0][price]': this.cfg.priceTeamBase,
            'line_items[0][quantity]': 1,
            'line_items[1][price]': this.cfg.priceTeamSeat,
            'line_items[1][quantity]': input.seats,
          };
    const s = await this.post<{ id: string; url: string }>(
      '/checkout/sessions',
      {
        mode: 'subscription',
        ...lines,
        ...this.customer(input.customerRef, input.customerEmail),
        client_reference_id: input.sessionId,
        'metadata[checkout_session_id]': input.sessionId,
        'metadata[workspace_id]': input.workspaceId,
        'metadata[kind]': 'SUBSCRIPTION',
        'metadata[plan]': input.plan,
        'metadata[seats]': input.seats,
        'subscription_data[metadata][workspace_id]': input.workspaceId,
        'subscription_data[metadata][plan]': input.plan,
        'subscription_data[metadata][seats]': input.seats,
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
      },
      `subscribe-${input.sessionId}`,
    );
    return { url: s.url, providerSessionId: s.id };
  }

  async createBillingPortalSession(input: PortalInput) {
    // TODO(stripe-verify): the portal configuration (cancel, update quantity, invoices) is set in the Stripe dashboard.
    const s = await this.post<{ url: string }>('/billing_portal/sessions', { customer: input.customerRef, return_url: input.returnUrl }, `portal-${input.workspaceId}-${Date.now()}`);
    return { url: s.url };
  }

  /** Verify the Stripe-Signature header (t=…,v1=…): HMAC-SHA256 of `${t}.${rawBody}` with the webhook secret. */
  verifySignature(rawBody: Buffer, header: string | undefined, now = Math.floor(Date.now() / 1000)) {
    if (!header || !this.cfg.webhookSecret) throw new WebhookVerificationError('missing signature');
    const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=').map((x) => x.trim()) as [string, string]));
    const t = Number(parts.t);
    const signatures = header
      .split(',')
      .filter((kv) => kv.trim().startsWith('v1='))
      .map((kv) => kv.trim().slice(3));
    if (!t || !signatures.length) throw new WebhookVerificationError('malformed signature');
    if (Math.abs(now - t) > SIGNATURE_TOLERANCE_SECONDS) throw new WebhookVerificationError('signature timestamp outside tolerance');
    const expected = createHmac('sha256', this.cfg.webhookSecret).update(`${t}.${rawBody.toString('utf8')}`).digest('hex');
    if (!signatures.some((sig) => safeEqual(sig, expected))) throw new WebhookVerificationError('signature mismatch');
  }

  async parseWebhook(rawBody: Buffer, headers: Record<string, string | undefined>): Promise<InternalBillingEvent[]> {
    this.verifySignature(rawBody, headers['stripe-signature']);
    return mapStripeEvent(JSON.parse(rawBody.toString('utf8')));
  }
}

type StripeObject = Record<string, unknown> & { metadata?: Record<string, string> };

const iso = (unix: unknown) => (typeof unix === 'number' ? new Date(unix * 1000).toISOString() : undefined);
const str = (v: unknown) => (typeof v === 'string' ? v : v && typeof v === 'object' && 'id' in v ? String((v as { id: unknown }).id) : undefined);

/** Translate one Stripe event into internal events. Unknown types map to []. */
export function mapStripeEvent(event: { id: string; type: string; created: number; data: { object: StripeObject } }): InternalBillingEvent[] {
  const o = event.data.object;
  const md = o.metadata ?? {};
  const occurredAt = iso(event.created) ?? new Date().toISOString();
  const base = { id: event.id, occurredAt };

  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      if (!md.workspace_id) return [];
      if (o.mode === 'payment') {
        // Delayed methods complete with payment_status "unpaid"; the async_payment_succeeded event follows.
        if (o.payment_status !== 'paid') return [];
        return [
          {
            ...base,
            type: 'PAYMENT_SUCCEEDED',
            kind: 'RCA_UNLOCK',
            workspaceId: md.workspace_id,
            rcaId: md.rca_id,
            checkoutSessionId: md.checkout_session_id,
            amountCents: typeof o.amount_total === 'number' ? o.amount_total : undefined,
            currency: typeof o.currency === 'string' ? o.currency.toUpperCase() : undefined,
            reference: str(o.payment_intent) ?? str(o.id),
            customerRef: str(o.customer),
          },
        ];
      }
      if (o.mode === 'subscription') {
        // TODO(stripe-verify): the period end comes with customer.subscription.updated / invoice.paid; 30 days is a placeholder until then.
        return [
          {
            ...base,
            type: 'SUBSCRIPTION_ACTIVATED',
            kind: 'SUBSCRIPTION',
            workspaceId: md.workspace_id,
            checkoutSessionId: md.checkout_session_id,
            plan: md.plan === 'TEAM' ? 'TEAM' : 'SOLO',
            seats: Number(md.seats ?? 0),
            subscriptionRef: str(o.subscription),
            customerRef: str(o.customer),
            amountCents: typeof o.amount_total === 'number' ? o.amount_total : undefined,
            currency: typeof o.currency === 'string' ? o.currency.toUpperCase() : undefined,
            reference: str(o.invoice) ?? str(o.id),
          },
        ];
      }
      return [];
    }
    case 'checkout.session.async_payment_failed':
      if (!md.workspace_id) return [];
      return [{ ...base, type: 'PAYMENT_FAILED', kind: 'RCA_UNLOCK', workspaceId: md.workspace_id, rcaId: md.rca_id, checkoutSessionId: md.checkout_session_id, reference: str(o.payment_intent) }];

    case 'invoice.paid': {
      // TODO(stripe-verify): subscription metadata location on invoices (parent.subscription_details.metadata on newer API versions).
      const sub = subscriptionMeta(o);
      if (!sub.workspace_id || o.billing_reason !== 'subscription_cycle') return [];
      const line = (o.lines as { data?: { period?: { end?: number } }[] } | undefined)?.data?.[0];
      return [
        {
          ...base,
          type: 'SUBSCRIPTION_RENEWED',
          workspaceId: sub.workspace_id,
          subscriptionRef: sub.subscription,
          periodEnd: iso(line?.period?.end),
          amountCents: typeof o.amount_paid === 'number' ? o.amount_paid : undefined,
          currency: typeof o.currency === 'string' ? o.currency.toUpperCase() : undefined,
          reference: str(o.id),
        },
      ];
    }
    case 'invoice.payment_failed': {
      const sub = subscriptionMeta(o);
      if (!sub.workspace_id) return [];
      return [{ ...base, type: 'PAYMENT_FAILED', kind: 'SUBSCRIPTION', workspaceId: sub.workspace_id, subscriptionRef: sub.subscription, amountCents: typeof o.amount_due === 'number' ? o.amount_due : undefined, reference: str(o.id) }];
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      if (!md.workspace_id) return [];
      const status = event.type === 'customer.subscription.deleted' ? 'canceled' : String(o.status);
      // TODO(stripe-verify): current_period_end moved to subscription items on newer API versions.
      const periodEnd = iso(o.current_period_end) ?? iso((o.items as { data?: { current_period_end?: number }[] } | undefined)?.data?.[0]?.current_period_end);
      const common = { ...base, workspaceId: md.workspace_id, subscriptionRef: str(o.id), customerRef: str(o.customer) };
      if (status === 'active' || status === 'trialing') {
        return [{ ...common, type: 'SUBSCRIPTION_ACTIVATED', plan: md.plan === 'TEAM' ? 'TEAM' : 'SOLO', seats: seatQuantity(o) ?? Number(md.seats ?? 0), periodEnd }];
      }
      if (status === 'past_due' || status === 'unpaid' || status === 'incomplete_expired') return [{ ...common, type: 'SUBSCRIPTION_PAST_DUE' }];
      if (status === 'canceled') return [{ ...common, type: 'SUBSCRIPTION_CANCELED' }];
      return [];
    }
    default:
      return [];
  }
}

function subscriptionMeta(invoice: StripeObject): { workspace_id?: string; subscription?: string } {
  const parent = invoice.parent as { subscription_details?: { metadata?: Record<string, string>; subscription?: string } } | undefined;
  const legacy = invoice.subscription_details as { metadata?: Record<string, string> } | undefined;
  const md = parent?.subscription_details?.metadata ?? legacy?.metadata ?? {};
  return { workspace_id: md.workspace_id, subscription: parent?.subscription_details?.subscription ?? str(invoice.subscription) };
}

/** Seats = quantity of the seat price line on the subscription. */
function seatQuantity(sub: StripeObject): number | undefined {
  const items = (sub.items as { data?: { price?: { id?: string }; quantity?: number }[] } | undefined)?.data ?? [];
  const seat = items.find((i) => i.price?.id === config.billing.stripe.priceTeamSeat);
  return seat?.quantity;
}
