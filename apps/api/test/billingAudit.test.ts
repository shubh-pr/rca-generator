/**
 * Phase 8 audit (docs/PHASE8_AUDIT.md): webhook trust boundary, per-event-type idempotency and the
 * owned-workspace quota. Mock provider only; the Stripe provider is instantiated with dummy config and
 * never makes a network call here.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { signMockWebhook } from '../src/billing/providers/mock.js';
import { MockPaymentProvider } from '../src/billing/providers/mock.js';
import { setPaymentProvider } from '../src/billing/providers/index.js';
import { StripePaymentProvider } from '../src/billing/providers/stripe.js';
import { config, loadConfig } from '../src/config.js';
import { ConsoleEmailProvider, emailProvider, flushEmails } from '../src/email/index.js';
import { api, bearer, createRca, createUser, db, raw, rcaBody, resetDb, subscribe, type Actor } from './helpers.js';

let owner: Actor;
let ws: string;

beforeEach(async () => {
  await resetDb();
  (emailProvider() as ConsoleEmailProvider).outbox.length = 0;
  owner = await createUser('Olive Owner');
  ws = owner.personalWorkspaceId;
});

afterEach(() => setPaymentProvider(new MockPaymentProvider()));

const now = () => new Date().toISOString();
const later = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

function webhook(events: object[], secret?: string) {
  const body = JSON.stringify({ events });
  return api().post('/api/v1/webhooks/payment').set('Content-Type', 'application/json').set('x-mock-signature', signMockWebhook(body, secret)).send(body);
}

const wsRow = () => raw(() => db.workspace.findUniqueOrThrow({ where: { id: ws } }));
const eventRows = (id: string) => raw(() => db.billingEvent.count({ where: { provider_event_id: id } }));
/** BILLING audit rows on the workspace for one internal event type. */
const workspaceAudits = async (type: string) =>
  (await raw(() => db.auditLog.findMany({ where: { entity: 'workspaces', entity_id: ws, action: 'BILLING' } }))).filter((r) => (r.new_value as { event?: string } | null)?.event === type).length;

describe('webhook trust boundary', () => {
  it('an unauthenticated request cannot fake a payment for any workspace: no signature, wrong secret, or a signature over another body', async () => {
    const victim = await createUser('Victor Victim');
    const r = await createRca(victim, victim.personalWorkspaceId);
    const events = [
      { id: 'evt_forge_pay', type: 'PAYMENT_SUCCEEDED', kind: 'RCA_UNLOCK', workspaceId: victim.personalWorkspaceId, rcaId: r.id, occurredAt: now() },
      { id: 'evt_forge_sub', type: 'SUBSCRIPTION_ACTIVATED', workspaceId: victim.personalWorkspaceId, plan: 'TEAM', seats: 50, subscriptionRef: 'sub_forged', periodEnd: later(365), occurredAt: now() },
    ];
    const body = JSON.stringify({ events });
    const noSig = await api().post('/api/v1/webhooks/payment').set('Content-Type', 'application/json').send(body);
    const wrongSecret = await webhook(events, 'guessed-secret');
    const otherBody = await api()
      .post('/api/v1/webhooks/payment')
      .set('Content-Type', 'application/json')
      .set('x-mock-signature', signMockWebhook(JSON.stringify({ events: [] })))
      .send(body);
    for (const res of [noSig, wrongSecret, otherBody]) expect(res.status).toBe(400);
    expect(noSig.body.error).toBe('INVALID_WEBHOOK');
    expect(await raw(() => db.billingEvent.count())).toBe(0);
    expect((await raw(() => db.rca.findUniqueOrThrow({ where: { id: r.id } }))).paid_at).toBeNull();
    expect((await raw(() => db.workspace.findUniqueOrThrow({ where: { id: victim.personalWorkspaceId } }))).subscription_status).toBe('NONE');
  });

  it('TEST MODE checkout and portal routes need a login, the buyer, and the paying owner', async () => {
    const r = (await api().post('/api/v1/rcas').set(bearer(owner)).send(rcaBody(ws))).body.id;
    const start = await api().post(`/api/v1/billing/rca/${r}/checkout`).set(bearer(owner)).send({});
    const sid = start.body.session_id;
    expect((await api().post(`/api/v1/billing/mock/sessions/${sid}/complete`).send({ outcome: 'success' })).status).toBe(401);
    expect((await api().post(`/api/v1/billing/mock/portal/${ws}`).send({ action: 'cancel' })).status).toBe(401);
    const stranger = await createUser('Stan Stranger');
    expect((await api().post(`/api/v1/billing/mock/sessions/${sid}/complete`).set(bearer(stranger)).send({ outcome: 'success' })).status).toBe(404);
    expect((await api().post(`/api/v1/billing/mock/portal/${ws}`).set(bearer(stranger)).send({ action: 'renew' })).status).toBe(404);
    expect((await raw(() => db.rca.findUniqueOrThrow({ where: { id: r } }))).paid_at).toBeNull();
  });

  it('with PAYMENT_PROVIDER=stripe, mock-signed webhooks are rejected and the TEST MODE routes are 404', async () => {
    setPaymentProvider(
      new StripePaymentProvider({ secretKey: 'sk_test_dummy', webhookSecret: 'whsec_dummy', priceRcaUnlock: 'p1', priceSoloMonthly: 'p2', priceTeamBase: 'p3', priceTeamSeat: 'p4' }),
    );
    const r = await createRca(owner, ws);
    const res = await webhook([{ id: 'evt_mock_under_stripe', type: 'PAYMENT_SUCCEEDED', kind: 'RCA_UNLOCK', workspaceId: ws, rcaId: r.id, occurredAt: now() }]);
    expect(res.status).toBe(400);
    expect((await raw(() => db.rca.findUniqueOrThrow({ where: { id: r.id } }))).paid_at).toBeNull();
    expect((await api().get('/api/v1/billing/mock/sessions/00000000-0000-4000-8000-000000000000').set(bearer(owner))).status).toBe(404);
    expect((await api().post(`/api/v1/billing/mock/portal/${ws}`).set(bearer(owner)).send({ action: 'cancel' })).status).toBe(404);
  });

  it('a double-clicked TEST MODE success (two concurrent completes) records the payment once', async () => {
    const r = (await api().post('/api/v1/rcas').set(bearer(owner)).send(rcaBody(ws))).body.id;
    const sid = (await api().post(`/api/v1/billing/rca/${r}/checkout`).set(bearer(owner)).send({})).body.session_id;
    const both = await Promise.all([0, 1].map(() => api().post(`/api/v1/billing/mock/sessions/${sid}/complete`).set(bearer(owner)).send({ outcome: 'success' })));
    expect(both.every((b) => b.status === 200 || b.status === 409)).toBe(true);
    expect(await raw(() => db.billingHistory.count({ where: { rca_id: r, status: 'PAID' } }))).toBe(1);
    expect(await raw(() => db.auditLog.count({ where: { rca_id: r, action: 'BILLING' } }))).toBe(1);
  });
});

describe('idempotency: the same event delivered again (sequentially and concurrently) is processed once', () => {
  it('PAYMENT_SUCCEEDED: one unlock, one history row, one audit row; paid_at is not rewritten', async () => {
    const r = await createRca(owner, ws);
    const evt = { id: 'evt_idem_paid', type: 'PAYMENT_SUCCEEDED', kind: 'RCA_UNLOCK', workspaceId: ws, rcaId: r.id, amountCents: 900, currency: 'USD', reference: 'pi_idem', occurredAt: now() };
    expect((await webhook([evt])).body.results[0].status).toBe('processed');
    const paidAt = (await raw(() => db.rca.findUniqueOrThrow({ where: { id: r.id } }))).paid_at;
    const replays = await Promise.all([webhook([evt]), webhook([{ ...evt, occurredAt: later(1) }]), webhook([evt])]);
    expect(replays.map((x) => x.body.results[0].status)).toEqual(['duplicate', 'duplicate', 'duplicate']);
    expect((await raw(() => db.rca.findUniqueOrThrow({ where: { id: r.id } }))).paid_at).toEqual(paidAt);
    expect(await eventRows('evt_idem_paid')).toBe(1);
    expect(await raw(() => db.billingHistory.count({ where: { rca_id: r.id } }))).toBe(1);
    expect(await raw(() => db.auditLog.count({ where: { rca_id: r.id, action: 'BILLING' } }))).toBe(1);
  });

  it('SUBSCRIPTION_ACTIVATED: a replay after cancellation does not re-activate; one audit row', async () => {
    const activate = { id: 'evt_idem_act', type: 'SUBSCRIPTION_ACTIVATED', workspaceId: ws, plan: 'TEAM', seats: 3, subscriptionRef: 'sub_idem', customerRef: 'cus_idem', periodEnd: later(30), occurredAt: now() };
    const both = await Promise.all([webhook([activate]), webhook([activate])]);
    expect(both.map((x) => x.body.results[0].status).sort()).toEqual(['duplicate', 'processed']);
    await webhook([{ id: 'evt_idem_act_cancel', type: 'SUBSCRIPTION_CANCELED', workspaceId: ws, subscriptionRef: 'sub_idem', occurredAt: now() }]);
    expect((await webhook([activate])).body.results[0].status).toBe('duplicate');
    expect((await wsRow()).subscription_status).toBe('CANCELED');
    expect(await eventRows('evt_idem_act')).toBe(1);
    expect(await workspaceAudits('SUBSCRIPTION_ACTIVATED')).toBe(1);
  });

  it('SUBSCRIPTION_PAST_DUE: a replay after renewal does not flip the workspace back to past due', async () => {
    await subscribe(ws, 'TEAM', 3, 'sub_pd');
    const pastDue = { id: 'evt_idem_pd', type: 'SUBSCRIPTION_PAST_DUE', workspaceId: ws, subscriptionRef: 'sub_pd', occurredAt: now() };
    const both = await Promise.all([webhook([pastDue]), webhook([pastDue])]);
    expect(both.map((x) => x.body.results[0].status).sort()).toEqual(['duplicate', 'processed']);
    expect((await wsRow()).subscription_status).toBe('PAST_DUE');
    await webhook([{ id: 'evt_idem_pd_renew', type: 'SUBSCRIPTION_RENEWED', workspaceId: ws, subscriptionRef: 'sub_pd', periodEnd: later(30), occurredAt: now() }]);
    expect((await webhook([pastDue])).body.results[0].status).toBe('duplicate');
    expect((await wsRow()).subscription_status).toBe('ACTIVE');
    expect(await eventRows('evt_idem_pd')).toBe(1);
    expect(await workspaceAudits('SUBSCRIPTION_PAST_DUE')).toBe(1);
  });

  it('SUBSCRIPTION_CANCELED: replays write no further audit rows and a re-subscription is not undone by them', async () => {
    await subscribe(ws, 'SOLO', 0, 'sub_c1');
    const cancel = { id: 'evt_idem_cancel', type: 'SUBSCRIPTION_CANCELED', workspaceId: ws, subscriptionRef: 'sub_c1', occurredAt: now() };
    const all = await Promise.all([webhook([cancel]), webhook([cancel]), webhook([cancel])]);
    expect(all.map((x) => x.body.results[0].status).sort()).toEqual(['duplicate', 'duplicate', 'processed']);
    expect((await wsRow()).subscription_status).toBe('CANCELED');
    await subscribe(ws, 'SOLO', 0, 'sub_c2');
    expect((await webhook([cancel])).body.results[0].status).toBe('duplicate');
    expect((await wsRow()).subscription_status).toBe('ACTIVE');
    expect(await eventRows('evt_idem_cancel')).toBe(1);
    expect(await workspaceAudits('SUBSCRIPTION_CANCELED')).toBe(1);
  });
});

describe('owned-workspace quota (QUOTA_OWNED_WORKSPACES)', () => {
  const createWs = (actor: Actor, name: string) => api().post('/api/v1/workspaces').set(bearer(actor)).send({ name });

  it('the 6th owned workspace is refused with 422 QUOTA_EXCEEDED and a clear message', async () => {
    // The personal workspace is #1.
    for (let i = 2; i <= 5; i++) expect((await createWs(owner, `Workspace ${i}`)).status).toBe(201);
    const sixth = await createWs(owner, 'Workspace 6');
    expect(sixth.status).toBe(422);
    expect(sixth.body).toMatchObject({ error: 'QUOTA_EXCEEDED', message: 'You can own up to 5 workspaces. Delete one you no longer need.', details: { limit: 5, used: 5 } });
    expect(await raw(() => db.workspace.count({ where: { owner_id: owner.id } }))).toBe(5);
  });

  it('the limit is read from the environment: QUOTA_OWNED_WORKSPACES changes it with no code change', async () => {
    expect(loadConfig({ DATABASE_URL: 'postgres://x' }).quota.ownedWorkspaces).toBe(5);
    expect(loadConfig({ DATABASE_URL: 'postgres://x', QUOTA_OWNED_WORKSPACES: '8' }).quota.ownedWorkspaces).toBe(8);
    expect(() => loadConfig({ DATABASE_URL: 'postgres://x', QUOTA_OWNED_WORKSPACES: '0' })).toThrow(/QUOTA_OWNED_WORKSPACES/);
    // The route reads the loaded value on every request (config.quota.ownedWorkspaces), so a restart with a new value applies.
    const original = config.quota.ownedWorkspaces;
    config.quota.ownedWorkspaces = 2;
    try {
      expect((await createWs(owner, 'Second')).status).toBe(201);
      expect((await createWs(owner, 'Third')).body).toMatchObject({ error: 'QUOTA_EXCEEDED', details: { limit: 2 } });
    } finally {
      config.quota.ownedWorkspaces = original;
    }
  });

  it('only OWNED workspaces count: a user at the limit can still be invited to other workspaces and RCAs', async () => {
    for (let i = 2; i <= 5; i++) expect((await createWs(owner, `Mine ${i}`)).status).toBe(201);
    const host = await createUser('Hana Host');
    await subscribe(host.personalWorkspaceId, 'TEAM', 5);
    const hostRca = await createRca(host, host.personalWorkspaceId);
    const hostWs2 = (await createWs(host, 'Host team')).body.id;
    await subscribe(hostWs2, 'TEAM', 5);

    expect((await api().post(`/api/v1/workspaces/${hostWs2}/invitations`).set(bearer(host)).send({ email: owner.email, role: 'EDITOR' })).status).toBe(201);
    expect((await api().post(`/api/v1/rcas/${hostRca.id}/invitations`).set(bearer(host)).send({ email: owner.email, role: 'VIEWER' })).status).toBe(201);
    await flushEmails();
    const tokens = (emailProvider() as ConsoleEmailProvider).outbox
      .filter((m) => m.to === owner.email && m.template === 'invitation')
      .map((m) => /token=([A-Za-z0-9_-]+)/.exec(m.text)![1]);
    expect(tokens).toHaveLength(2);
    for (const token of tokens) expect((await api().post('/api/v1/invitations/accept').set(bearer(owner)).send({ token })).body.accepted).toBe(true);

    expect((await api().get(`/api/v1/rcas/${hostRca.id}`).set(bearer(owner))).status).toBe(200);
    const mine = await raw(() => db.workspaceMember.findMany({ where: { user_id: owner.id } }));
    expect(mine).toHaveLength(6); // 5 owned + 1 joined
    expect(await raw(() => db.workspace.count({ where: { owner_id: owner.id } }))).toBe(5);
    // Still at the ownership limit.
    expect((await createWs(owner, 'One more')).status).toBe(422);
  });
});
