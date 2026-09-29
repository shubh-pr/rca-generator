/**
 * Starting checkouts and portal sessions. Nothing here changes paid_at or subscription state; that
 * happens only when the provider's verified event arrives (events.ts).
 */
import type { Workspace } from '@prisma/client';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import type { AuthUser } from '../policy/access.js';
import { unscoped } from '../tenancy/context.js';
import { isSubscribed, seatsInUse } from './entitlements.js';
import { pricing, subscriptionPrice } from './pricing.js';
import { paymentProvider } from './providers/index.js';
import type { PaidPlan } from './types.js';

/** Billing actions for a workspace are for its primary owner (the account that pays). */
export function assertBillingOwner(me: AuthUser, ws: Workspace) {
  if (ws.owner_id !== me.id) throw forbidden('Only the workspace owner who pays for it can manage billing');
}

export async function startRcaUnlock(me: AuthUser, rca: { id: string; rca_number: string; workspace_id: string; paid_at: Date | null }) {
  if (rca.paid_at) throw conflict('This RCA is already unlocked');
  const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: rca.workspace_id } });
  const price = pricing().rcaUnlock;
  const session = await prisma.checkoutSession.create({
    data: { provider: paymentProvider().name, kind: 'RCA_UNLOCK', workspace_id: ws.id, rca_id: rca.id, amount_cents: price.amountCents, currency: price.currency, created_by: me.id },
  });
  const { url, providerSessionId } = await paymentProvider().createOneTimeCheckout({
    sessionId: session.id,
    rcaId: rca.id,
    rcaNumber: rca.rca_number,
    workspaceId: ws.id,
    amount: price,
    customerRef: ws.payment_customer_ref,
    customerEmail: me.email,
    successUrl: `${config.appUrl}/rcas/${rca.id}?checkout=done`,
    cancelUrl: `${config.appUrl}/rcas/${rca.id}?checkout=canceled`,
  });
  await prisma.checkoutSession.update({ where: { id: session.id }, data: { provider_session_id: providerSessionId } });
  return { checkout_url: url, session_id: session.id, test_mode: paymentProvider().testMode };
}

export async function startSubscription(me: AuthUser, ws: Workspace, plan: PaidPlan, seatsRequested?: number) {
  assertBillingOwner(me, ws);
  const p = pricing().team;
  let seats = 0;
  if (plan === 'TEAM') {
    seats = seatsRequested ?? Math.max(p.minSeats, await seatsInUse(prisma, ws));
    if (seats < p.minSeats || seats > p.maxSeats) throw badRequest({ seats: `Choose between ${p.minSeats} and ${p.maxSeats} seats` });
    const used = await seatsInUse(prisma, ws);
    if (seats < used) throw badRequest({ seats: `${used} people already use a seat; choose at least ${used}` });
  }
  if (isSubscribed(ws)) {
    throw conflict('This workspace already has an active subscription. Change it under Manage billing.', { plan: ws.plan });
  }
  const price = subscriptionPrice(plan, seats);
  const session = await prisma.checkoutSession.create({
    data: { provider: paymentProvider().name, kind: 'SUBSCRIPTION', workspace_id: ws.id, plan, seats, amount_cents: price.amountCents, currency: price.currency, created_by: me.id },
  });
  const { url, providerSessionId } = await paymentProvider().createSubscriptionCheckout({
    sessionId: session.id,
    workspaceId: ws.id,
    plan,
    seats,
    amount: price,
    customerRef: ws.payment_customer_ref,
    customerEmail: me.email,
    successUrl: `${config.appUrl}/settings/billing?checkout=done`,
    cancelUrl: `${config.appUrl}/settings/billing?checkout=canceled`,
  });
  await prisma.checkoutSession.update({ where: { id: session.id }, data: { provider_session_id: providerSessionId } });
  return { checkout_url: url, session_id: session.id, test_mode: paymentProvider().testMode };
}

export async function startPortal(me: AuthUser, ws: Workspace) {
  assertBillingOwner(me, ws);
  if (!ws.payment_customer_ref) throw conflict('There is no billing account for this workspace yet. Subscribe first.');
  const { url } = await paymentProvider().createBillingPortalSession({ workspaceId: ws.id, customerRef: ws.payment_customer_ref, returnUrl: `${config.appUrl}/settings/billing` });
  return { portal_url: url, test_mode: paymentProvider().testMode };
}

/** A workspace the user belongs to, or 404 (no existence leak). */
export async function memberWorkspace(me: AuthUser, workspaceId: string) {
  const [ws, member] = await Promise.all([
    prisma.workspace.findFirst({ where: { id: workspaceId } }),
    prisma.workspaceMember.findFirst({ where: { workspace_id: workspaceId, user_id: me.id } }),
  ]);
  if (!ws || !member) throw notFound('Workspace not found');
  return { ws, member };
}

/** Workspaces the user pays for whose subscription is past due or canceled (in-app warning). */
export function billingAlerts(userId: string) {
  return unscoped('billing alerts for the paying owner', () =>
    prisma.workspace.findMany({
      where: { owner_id: userId, subscription_status: { in: ['PAST_DUE', 'CANCELED'] } },
      select: { id: true, name: true, plan: true, subscription_status: true, current_period_end: true },
    }),
  );
}
