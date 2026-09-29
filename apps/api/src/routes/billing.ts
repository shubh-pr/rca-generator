import express, { Router } from 'express';
import { z } from 'zod';
import { currentUser } from '../auth/index.js';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { hasTeam, isSubscribed, seatsInUse, unpaidRcaCount } from '../billing/entitlements.js';
import { handleBillingEvent } from '../billing/events.js';
import { completeMockCheckout, mockPortalAction } from '../billing/mockActions.js';
import { publicPricing, pricing } from '../billing/pricing.js';
import { paymentProvider } from '../billing/providers/index.js';
import { assertBillingOwner, billingAlerts, memberWorkspace, startPortal, startRcaUnlock, startSubscription } from '../billing/service.js';
import { WebhookVerificationError } from '../billing/types.js';
import { HttpError, notFound } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { pageResult, parsePage } from '../lib/pagination.js';
import { parse, zUuid } from '../lib/validate.js';
import { loadRcaAccess } from '../policy/access.js';
import { authorize } from '../policy/policy.js';
import { unscoped } from '../tenancy/context.js';

// ---------- Public ----------

export const billingPublicRouter = Router();

billingPublicRouter.get('/billing/pricing', (_req, res) => {
  res.json(publicPricing(paymentProvider().testMode));
});

/**
 * Provider webhooks. The raw body is verified by the ACTIVE provider (signature); only then are its
 * internal events applied. Mounted before the JSON parser.
 */
export const webhookRouter = Router();
webhookRouter.post('/webhooks/payment', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  const provider = paymentProvider();
  let events;
  try {
    events = await provider.parseWebhook(Buffer.isBuffer(req.body) ? req.body : Buffer.from(''), req.headers as Record<string, string | undefined>);
  } catch (err) {
    if (err instanceof WebhookVerificationError || err instanceof SyntaxError) {
      logger.warn('webhook rejected', { provider: provider.name, reason: String(err.message) });
      res.status(400).json({ error: 'INVALID_WEBHOOK', message: 'Webhook signature or payload is invalid' });
      return;
    }
    throw err;
  }
  const results = [];
  for (const e of events) results.push({ id: e.id, type: e.type, ...(await handleBillingEvent(provider.name, e)) });
  res.json({ received: true, results });
});

// ---------- Authenticated ----------

export const billingRouter = Router();

function workspaceBilling(ws: Awaited<ReturnType<typeof memberWorkspace>>['ws']) {
  return {
    workspace_id: ws.id,
    plan: ws.plan,
    subscription_status: ws.subscription_status,
    current_period_end: ws.current_period_end,
    seats: ws.seats,
    entitled: isSubscribed(ws),
    team: hasTeam(ws),
  };
}

/** Plan, status, bucket and seat usage of a workspace (any member). */
billingRouter.get('/billing/workspaces/:wid', async (req, res) => {
  const me = currentUser(req);
  const { wid } = parse(z.object({ wid: zUuid }), req.params);
  const { ws } = await memberWorkspace(me, wid);
  const limit = pricing().freeRcaLimit;
  const unpaid = await unpaidRcaCount(prisma, ws.id);
  res.json({
    ...workspaceBilling(ws),
    is_billing_owner: ws.owner_id === me.id,
    bucket: { unpaid, limit, full: !isSubscribed(ws) && unpaid >= limit, applies: !isSubscribed(ws) },
    seats_used: await seatsInUse(prisma, ws),
    collaborators_read_only: !hasTeam(ws),
    has_billing_account: !!ws.payment_customer_ref,
    test_mode: paymentProvider().testMode,
  });
});

billingRouter.get('/billing/workspaces/:wid/history', async (req, res) => {
  const me = currentUser(req);
  const { wid } = parse(z.object({ wid: zUuid }), req.params);
  const { ws } = await memberWorkspace(me, wid);
  assertBillingOwner(me, ws);
  const p = parsePage(req.query, ['occurred_at'], '-occurred_at');
  const where = { workspace_id: ws.id };
  const [data, total] = await Promise.all([
    prisma.billingHistory.findMany({ where, orderBy: p.orderBy, skip: p.skip, take: p.take, include: { rca: { select: { id: true, rca_number: true } } } }),
    prisma.billingHistory.count({ where }),
  ]);
  res.json(pageResult(data, total, p));
});

billingRouter.get('/billing/alerts', async (req, res) => {
  res.json({ data: await billingAlerts(currentUser(req).id) });
});

billingRouter.post('/billing/rca/:id/checkout', async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(z.object({ id: zUuid }), req.params);
  const { rca, ctx } = await loadRcaAccess(prisma, me, id);
  authorize(ctx, 'rca.edit', undefined, 'Only owners and editors of this workspace can buy an unlock');
  res.status(201).json(await startRcaUnlock(me, rca));
});

billingRouter.post('/billing/subscribe', async (req, res) => {
  const me = currentUser(req);
  const body = parse(z.object({ workspace_id: zUuid, plan: z.enum(['SOLO', 'TEAM']), seats: z.number().int().optional() }).strict(), req.body);
  const { ws } = await memberWorkspace(me, body.workspace_id);
  res.status(201).json(await startSubscription(me, ws, body.plan, body.seats));
});

billingRouter.post('/billing/portal', async (req, res) => {
  const me = currentUser(req);
  const body = parse(z.object({ workspace_id: zUuid }).strict(), req.body);
  const { ws } = await memberWorkspace(me, body.workspace_id);
  res.json(await startPortal(me, ws));
});

// ---------- Mock provider only (TEST MODE pages) ----------

function requireMock() {
  if (paymentProvider().name !== 'mock') throw notFound('Route not found');
}

billingRouter.get('/billing/mock/sessions/:sid', async (req, res) => {
  requireMock();
  const me = currentUser(req);
  const { sid } = parse(z.object({ sid: zUuid }), req.params);
  const s = await unscoped('mock checkout page', () => prisma.checkoutSession.findUnique({ where: { id: sid }, include: { rca: { select: { id: true, rca_number: true } }, workspace: { select: { name: true } } } }));
  if (!s || s.provider !== 'mock' || s.created_by !== me.id) throw notFound('Checkout not found');
  res.json({ id: s.id, kind: s.kind, plan: s.plan, seats: s.seats, amount_cents: s.amount_cents, currency: s.currency, status: s.status, rca: s.rca, workspace_name: s.workspace.name, test_mode: true });
});

billingRouter.post('/billing/mock/sessions/:sid/complete', async (req, res) => {
  requireMock();
  const me = currentUser(req);
  const { sid } = parse(z.object({ sid: zUuid }), req.params);
  const { outcome } = parse(z.object({ outcome: z.enum(['success', 'failure', 'cancel']) }).strict(), req.body);
  res.json({ results: await completeMockCheckout(sid, me.id, outcome) });
});

billingRouter.post('/billing/mock/portal/:wid', async (req, res) => {
  requireMock();
  const me = currentUser(req);
  const { wid } = parse(z.object({ wid: zUuid }), req.params);
  const { ws } = await memberWorkspace(me, wid);
  assertBillingOwner(me, ws);
  const body = parse(
    z.discriminatedUnion('action', [
      z.object({ action: z.literal('renew') }),
      z.object({ action: z.literal('past_due') }),
      z.object({ action: z.literal('cancel') }),
      z.object({ action: z.literal('seats'), seats: z.number().int().min(config.billing.teamSeats.min).max(config.billing.teamSeats.max) }),
    ]),
    req.body,
  );
  if (body.action === 'seats') {
    const used = await seatsInUse(prisma, ws);
    if (body.seats < used) throw new HttpError(400, 'VALIDATION', `${used} seats are in use`, { seats: `Choose at least ${used}` });
  }
  res.json({ results: await mockPortalAction(ws.id, body) });
});

