/**
 * The only place that changes billing state (rca.paid_at, workspaces.plan / subscription_*).
 * Input: internal events from a provider's VERIFIED callback. Each event is recorded in billing_events
 * and applied in one transaction; UNIQUE(provider, provider_event_id) makes replays no-ops.
 */
import type { Prisma } from '@prisma/client';
import { prisma, type Tx } from '../db.js';
import { rcaAudit, writeAudit } from '../lib/audit.js';
import { toJson } from '../lib/json.js';
import { logger } from '../lib/logger.js';
import { unscoped } from '../tenancy/context.js';
import type { InternalBillingEvent } from './types.js';

export type EventOutcome = { status: 'processed' | 'duplicate' | 'ignored'; result: string };

const plus = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);

export async function handleBillingEvent(provider: string, evt: InternalBillingEvent): Promise<EventOutcome> {
  return unscoped('billing: apply a verified provider event', () =>
    prisma.$transaction(async (tx) => {
      // ON CONFLICT DO NOTHING: a replay (or a concurrent duplicate) inserts nothing and changes nothing.
      const inserted = await tx.billingEvent.createMany({
        data: [
          {
            provider,
            provider_event_id: evt.id,
            type: evt.type,
            payload: toJson(evt) as Prisma.InputJsonValue,
            workspace_id: (await tx.workspace.findUnique({ where: { id: evt.workspaceId }, select: { id: true } }))?.id ?? null,
          },
        ],
        skipDuplicates: true,
      });
      if (inserted.count === 0) return { status: 'duplicate' as const, result: 'already processed' };
      let outcome: EventOutcome;
      try {
        outcome = await apply(tx, evt);
      } catch (err) {
        logger.error('billing event failed', { event_id: evt.id, type: evt.type, error: String(err) });
        throw err; // rolls back, including the billing_events row, so the provider's retry is processed
      }
      await tx.billingEvent.update({
        where: { provider_provider_event_id: { provider, provider_event_id: evt.id } },
        data: { processed_at: new Date(), result: `${outcome.status}: ${outcome.result}`.slice(0, 200) },
      });
      return outcome;
    }),
  );
}

async function apply(tx: Tx, evt: InternalBillingEvent): Promise<EventOutcome> {
  const ws = await tx.workspace.findUnique({ where: { id: evt.workspaceId } });
  if (!ws) return { status: 'ignored', result: 'unknown workspace' };
  const session = evt.checkoutSessionId ? await tx.checkoutSession.findUnique({ where: { id: evt.checkoutSessionId } }) : null;
  // The event must describe the checkout we created: same workspace, same RCA and kind.
  if (evt.checkoutSessionId && (!session || session.workspace_id !== ws.id || (evt.rcaId && session.rca_id !== evt.rcaId))) {
    return { status: 'ignored', result: 'checkout session does not match' };
  }
  const actor = session?.created_by ?? null;
  const audit = (detail: Record<string, unknown>) =>
    writeAudit(tx, { entity: 'workspaces', entity_id: ws.id, workspace_id: ws.id, category: 'DATA', action: 'BILLING', new_value: { event: evt.type, ...detail }, user_id: actor });
  const occurred = new Date(evt.occurredAt);

  switch (evt.type) {
    case 'PAYMENT_SUCCEEDED': {
      if (session?.status === 'OPEN') await tx.checkoutSession.update({ where: { id: session.id }, data: { status: 'COMPLETED', completed_at: new Date() } });
      const amount = evt.amountCents ?? session?.amount_cents ?? 0;
      const currency = evt.currency ?? session?.currency ?? 'USD';
      if (evt.kind === 'RCA_UNLOCK') {
        if (!evt.rcaId) return { status: 'ignored', result: 'rca unlock without rca id' };
        const rca = await tx.rca.findUnique({ where: { id: evt.rcaId } });
        if (!rca || rca.workspace_id !== ws.id) return { status: 'ignored', result: 'rca not in workspace' };
        if (!rca.paid_at) {
          await tx.rca.update({ where: { id: rca.id }, data: { paid_at: occurred, payment_reference: evt.reference ?? evt.id } });
          await writeAudit(tx, rcaAudit(rca, { entity: 'rca', entity_id: rca.id, action: 'BILLING', new_value: { event: evt.type, paid: true, reference: evt.reference ?? evt.id }, user_id: actor }));
        }
        await tx.billingHistory.create({
          data: { workspace_id: ws.id, rca_id: rca.id, kind: 'RCA_UNLOCK', description: `Unlock ${rca.rca_number}`, amount_cents: amount, currency, status: 'PAID', reference: evt.reference ?? evt.id, occurred_at: occurred },
        });
        return { status: 'processed', result: rca.paid_at ? 'rca already paid; payment recorded' : 'rca unlocked' };
      }
      await tx.billingHistory.create({
        data: { workspace_id: ws.id, kind: 'SUBSCRIPTION', description: `${planLabel(evt.plan ?? session?.plan ?? ws.plan)} subscription payment`, amount_cents: amount, currency, status: 'PAID', reference: evt.reference ?? evt.id, occurred_at: occurred },
      });
      await audit({ kind: 'SUBSCRIPTION', amount_cents: amount });
      return { status: 'processed', result: 'subscription payment recorded' };
    }

    case 'PAYMENT_FAILED': {
      if (session?.status === 'OPEN') await tx.checkoutSession.update({ where: { id: session.id }, data: { status: 'FAILED', completed_at: new Date() } });
      await tx.billingHistory.create({
        data: {
          workspace_id: ws.id,
          rca_id: evt.rcaId ?? null,
          kind: evt.kind ?? session?.kind ?? 'SUBSCRIPTION',
          description: evt.kind === 'RCA_UNLOCK' || session?.kind === 'RCA_UNLOCK' ? 'RCA unlock payment failed' : 'Subscription payment failed',
          amount_cents: evt.amountCents ?? session?.amount_cents ?? 0,
          currency: evt.currency ?? session?.currency ?? 'USD',
          status: 'FAILED',
          reference: evt.reference ?? evt.id,
          occurred_at: occurred,
        },
      });
      await audit({ rca_id: evt.rcaId ?? null });
      return { status: 'processed', result: 'payment failure recorded; nothing unlocked' };
    }

    case 'SUBSCRIPTION_ACTIVATED': {
      if (!evt.plan) return { status: 'ignored', result: 'activation without plan' };
      // A different, newer subscription replaces the old one; an update of the current one keeps it.
      const seats = evt.plan === 'TEAM' ? Math.max(1, evt.seats ?? session?.seats ?? 1) : 0;
      if (session?.status === 'OPEN') await tx.checkoutSession.update({ where: { id: session.id }, data: { status: 'COMPLETED', completed_at: new Date() } });
      await tx.workspace.update({
        where: { id: ws.id },
        data: {
          plan: evt.plan,
          seats,
          subscription_status: 'ACTIVE',
          subscription_ref: evt.subscriptionRef ?? ws.subscription_ref,
          payment_customer_ref: evt.customerRef ?? ws.payment_customer_ref,
          current_period_end: evt.periodEnd ? new Date(evt.periodEnd) : (ws.current_period_end ?? plus(occurred, 30)),
        },
      });
      await audit({ plan: evt.plan, seats, from: { plan: ws.plan, status: ws.subscription_status } });
      return { status: 'processed', result: `${evt.plan} active` };
    }

    case 'SUBSCRIPTION_RENEWED':
    case 'SUBSCRIPTION_PAST_DUE':
    case 'SUBSCRIPTION_CANCELED': {
      // Out-of-order or stale events for an older subscription never touch the current one.
      if (!ws.subscription_ref || (evt.subscriptionRef && evt.subscriptionRef !== ws.subscription_ref)) {
        return { status: 'ignored', result: 'event for a subscription that is not current' };
      }
      if (evt.type === 'SUBSCRIPTION_RENEWED') {
        const periodEnd = evt.periodEnd ? new Date(evt.periodEnd) : plus(ws.current_period_end ?? occurred, 30);
        await tx.workspace.update({ where: { id: ws.id }, data: { subscription_status: 'ACTIVE', current_period_end: periodEnd } });
        if (evt.amountCents) {
          await tx.billingHistory.create({
            data: { workspace_id: ws.id, kind: 'SUBSCRIPTION', description: `${planLabel(ws.plan)} subscription renewal`, amount_cents: evt.amountCents, currency: evt.currency ?? 'USD', status: 'PAID', reference: evt.reference ?? evt.id, occurred_at: occurred },
          });
        }
        await audit({ period_end: periodEnd });
        return { status: 'processed', result: 'renewed' };
      }
      const status = evt.type === 'SUBSCRIPTION_PAST_DUE' ? 'PAST_DUE' : 'CANCELED';
      await tx.workspace.update({ where: { id: ws.id }, data: { subscription_status: status } });
      await audit({ status, plan: ws.plan });
      return { status: 'processed', result: status.toLowerCase() };
    }
  }
}

function planLabel(plan: string | null | undefined) {
  return plan === 'TEAM' ? 'Team' : plan === 'SOLO' ? 'Solo' : 'Subscription';
}
