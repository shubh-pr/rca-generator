import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { mapStripeEvent, StripePaymentProvider } from '../src/billing/providers/stripe.js';
import { WebhookVerificationError } from '../src/billing/types.js';

const secret = 'whsec_test_fixture';
const provider = new StripePaymentProvider({ secretKey: 'sk_test_x', webhookSecret: secret, priceRcaUnlock: 'price_unlock', priceSoloMonthly: 'price_solo', priceTeamBase: 'price_base', priceTeamSeat: 'price_seat' });
const WS = '11111111-1111-4111-8111-111111111111';
const RCA = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';

function signed(payload: object, t = Math.floor(Date.now() / 1000), key = secret) {
  const body = JSON.stringify(payload);
  const sig = createHmac('sha256', key).update(`${t}.${body}`).digest('hex');
  return { body: Buffer.from(body), header: `t=${t},v1=${sig}` };
}

const evt = (type: string, object: Record<string, unknown>) => ({ id: `evt_${type}`, type, created: 1_790_000_000, data: { object } });

describe('Stripe webhook signature', () => {
  it('accepts a valid signature and maps the event', async () => {
    const { body, header } = signed(evt('checkout.session.completed', { id: 'cs_1', mode: 'payment', payment_status: 'paid', amount_total: 900, currency: 'usd', payment_intent: 'pi_1', metadata: { workspace_id: WS, rca_id: RCA, checkout_session_id: SESSION } }));
    const events = await provider.parseWebhook(body, { 'stripe-signature': header });
    expect(events).toEqual([expect.objectContaining({ type: 'PAYMENT_SUCCEEDED', kind: 'RCA_UNLOCK', workspaceId: WS, rcaId: RCA, checkoutSessionId: SESSION, amountCents: 900, currency: 'USD', reference: 'pi_1' })]);
  });

  it('rejects a wrong secret, a tampered body, an old timestamp and a missing header', async () => {
    const good = signed(evt('customer.subscription.deleted', { id: 'sub_1', metadata: { workspace_id: WS } }));
    await expect(provider.parseWebhook(signed(evt('x', {}), undefined, 'whsec_other').body, { 'stripe-signature': signed(evt('x', {}), undefined, 'whsec_other').header })).rejects.toThrow(WebhookVerificationError);
    await expect(provider.parseWebhook(Buffer.from(good.body.toString().replace('sub_1', 'sub_2')), { 'stripe-signature': good.header })).rejects.toThrow(/mismatch/);
    const old = signed(evt('x', {}), Math.floor(Date.now() / 1000) - 3600);
    await expect(provider.parseWebhook(old.body, { 'stripe-signature': old.header })).rejects.toThrow(/tolerance/);
    await expect(provider.parseWebhook(good.body, {})).rejects.toThrow(/missing/);
  });
});

describe('Stripe event mapping', () => {
  it('subscription checkout -> SUBSCRIPTION_ACTIVATED with plan and seats', () => {
    const [e] = mapStripeEvent(evt('checkout.session.completed', { id: 'cs_2', mode: 'subscription', subscription: 'sub_9', customer: 'cus_9', metadata: { workspace_id: WS, plan: 'TEAM', seats: '4', checkout_session_id: SESSION } }));
    expect(e).toMatchObject({ type: 'SUBSCRIPTION_ACTIVATED', plan: 'TEAM', seats: 4, subscriptionRef: 'sub_9', customerRef: 'cus_9' });
  });

  it('unpaid (delayed) payment checkouts do not unlock anything until async success', () => {
    expect(mapStripeEvent(evt('checkout.session.completed', { mode: 'payment', payment_status: 'unpaid', metadata: { workspace_id: WS, rca_id: RCA } }))).toEqual([]);
    expect(mapStripeEvent(evt('checkout.session.async_payment_succeeded', { mode: 'payment', payment_status: 'paid', metadata: { workspace_id: WS, rca_id: RCA } }))[0].type).toBe('PAYMENT_SUCCEEDED');
    expect(mapStripeEvent(evt('checkout.session.async_payment_failed', { metadata: { workspace_id: WS, rca_id: RCA } }))[0].type).toBe('PAYMENT_FAILED');
  });

  it('invoice and subscription lifecycle', () => {
    const renewed = mapStripeEvent(evt('invoice.paid', { id: 'in_1', billing_reason: 'subscription_cycle', amount_paid: 4500, currency: 'usd', parent: { subscription_details: { subscription: 'sub_9', metadata: { workspace_id: WS } } }, lines: { data: [{ period: { end: 1_792_592_000 } }] } }));
    expect(renewed[0]).toMatchObject({ type: 'SUBSCRIPTION_RENEWED', subscriptionRef: 'sub_9', amountCents: 4500, periodEnd: new Date(1_792_592_000 * 1000).toISOString() });
    expect(mapStripeEvent(evt('invoice.paid', { billing_reason: 'subscription_create', parent: { subscription_details: { metadata: { workspace_id: WS } } } }))).toEqual([]);
    expect(mapStripeEvent(evt('invoice.payment_failed', { id: 'in_2', subscription_details: { metadata: { workspace_id: WS } }, subscription: 'sub_9' }))[0].type).toBe('PAYMENT_FAILED');
    const sub = (status: string) => mapStripeEvent(evt('customer.subscription.updated', { id: 'sub_9', status, metadata: { workspace_id: WS, plan: 'TEAM' }, items: { data: [{ price: { id: 'price_seat' }, quantity: 6, current_period_end: 1_792_592_000 }] } }));
    expect(sub('past_due')[0].type).toBe('SUBSCRIPTION_PAST_DUE');
    expect(sub('active')[0]).toMatchObject({ type: 'SUBSCRIPTION_ACTIVATED', subscriptionRef: 'sub_9' });
    expect(sub('canceled')[0].type).toBe('SUBSCRIPTION_CANCELED');
    expect(mapStripeEvent(evt('customer.subscription.deleted', { id: 'sub_9', metadata: { workspace_id: WS } }))[0].type).toBe('SUBSCRIPTION_CANCELED');
  });

  it('events without our metadata or of other types are ignored', () => {
    expect(mapStripeEvent(evt('checkout.session.completed', { mode: 'payment', payment_status: 'paid' }))).toEqual([]);
    expect(mapStripeEvent(evt('charge.refunded', { id: 'ch_1' }))).toEqual([]);
  });

  it('test mode is detected from the secret key', () => {
    expect(provider.testMode).toBe(true);
    expect(new StripePaymentProvider({ secretKey: 'sk_live_x', webhookSecret: 'w', priceRcaUnlock: 'a', priceSoloMonthly: 'b', priceTeamBase: 'c', priceTeamSeat: 'd' }).testMode).toBe(false);
  });
});
