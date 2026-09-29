/**
 * What the mock provider "does" when someone clicks a TEST MODE button: it produces internal events
 * and feeds them to handleBillingEvent(), exactly as a verified webhook would.
 */
import { prisma } from '../db.js';
import { conflict, notFound } from '../lib/errors.js';
import { unscoped } from '../tenancy/context.js';
import { handleBillingEvent } from './events.js';
import { subscriptionPrice } from './pricing.js';
import { mockId } from './providers/mock.js';
import type { InternalBillingEvent } from './types.js';

const days = (n: number) => n * 86_400_000;

async function emit(events: InternalBillingEvent[]) {
  const outcomes = [];
  for (const e of events) outcomes.push(await handleBillingEvent('mock', e));
  return outcomes;
}

/** Complete a TEST MODE checkout. Only the user who started it may complete it. */
export async function completeMockCheckout(sessionId: string, userId: string, outcome: 'success' | 'failure' | 'cancel') {
  const s = await unscoped('mock checkout lookup', () => prisma.checkoutSession.findUnique({ where: { id: sessionId } }));
  if (!s || s.provider !== 'mock' || s.created_by !== userId) throw notFound('Checkout not found');
  if (s.status !== 'OPEN') throw conflict(`This checkout is already ${s.status.toLowerCase()}`);
  const now = new Date();
  // Event ids derive from the session, so a double click (two requests that both saw OPEN) produces the
  // same events and the billing_events unique constraint turns the second into a no-op.
  const eventId = (what: string) => `mock_evt_${s.id}_${what}`;
  const common = { workspaceId: s.workspace_id, checkoutSessionId: s.id, occurredAt: now.toISOString(), amountCents: s.amount_cents, currency: s.currency };
  if (outcome === 'cancel') {
    await unscoped('mock checkout canceled by the buyer', () => prisma.checkoutSession.update({ where: { id: s.id }, data: { status: 'CANCELED', completed_at: now } }));
    return [];
  }
  if (outcome === 'failure') {
    return emit([{ ...common, id: eventId('failed'), type: 'PAYMENT_FAILED', kind: s.kind as 'RCA_UNLOCK' | 'SUBSCRIPTION', rcaId: s.rca_id ?? undefined, reference: mockId('pi') }]);
  }
  if (s.kind === 'RCA_UNLOCK') {
    return emit([{ ...common, id: eventId('paid'), type: 'PAYMENT_SUCCEEDED', kind: 'RCA_UNLOCK', rcaId: s.rca_id ?? undefined, reference: mockId('pi') }]);
  }
  const subscriptionRef = `mock_sub_${s.id.replace(/-/g, '').slice(0, 24)}`;
  return emit([
    { ...common, id: eventId('paid'), type: 'PAYMENT_SUCCEEDED', kind: 'SUBSCRIPTION', plan: s.plan as 'SOLO' | 'TEAM', reference: mockId('in') },
    {
      ...common,
      id: eventId('activated'),
      type: 'SUBSCRIPTION_ACTIVATED',
      kind: 'SUBSCRIPTION',
      plan: s.plan as 'SOLO' | 'TEAM',
      seats: s.seats ?? 0,
      subscriptionRef,
      customerRef: `mock_cus_${s.workspace_id.slice(0, 8)}`,
      periodEnd: new Date(now.getTime() + days(30)).toISOString(),
    },
  ]);
}

export type PortalAction = { action: 'renew' } | { action: 'past_due' } | { action: 'cancel' } | { action: 'seats'; seats: number };

/** TEST MODE portal: the primary owner simulates renewals, failures, cancellation and seat changes. */
export async function mockPortalAction(workspaceId: string, a: PortalAction) {
  const ws = await unscoped('mock portal', () => prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } }));
  if (!ws.subscription_ref) throw conflict('This workspace has no subscription');
  const now = new Date();
  const common = { workspaceId: ws.id, subscriptionRef: ws.subscription_ref, occurredAt: now.toISOString() };
  switch (a.action) {
    case 'renew': {
      const from = ws.current_period_end && ws.current_period_end > now ? ws.current_period_end : now;
      const price = subscriptionPrice(ws.plan === 'TEAM' ? 'TEAM' : 'SOLO', ws.seats);
      return emit([{ ...common, id: mockId('evt'), type: 'SUBSCRIPTION_RENEWED', periodEnd: new Date(from.getTime() + days(30)).toISOString(), amountCents: price.amountCents, currency: price.currency, reference: mockId('in') }]);
    }
    case 'past_due':
      return emit([
        { ...common, id: mockId('evt'), type: 'PAYMENT_FAILED', kind: 'SUBSCRIPTION', reference: mockId('in') },
        { ...common, id: mockId('evt'), type: 'SUBSCRIPTION_PAST_DUE' },
      ]);
    case 'cancel':
      return emit([{ ...common, id: mockId('evt'), type: 'SUBSCRIPTION_CANCELED' }]);
    case 'seats':
      if (ws.plan !== 'TEAM') throw conflict('Seats apply to Team subscriptions');
      return emit([{ ...common, id: mockId('evt'), type: 'SUBSCRIPTION_ACTIVATED', plan: 'TEAM', seats: a.seats, periodEnd: ws.current_period_end?.toISOString() }]);
  }
}
