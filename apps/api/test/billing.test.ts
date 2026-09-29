import JSZip from 'jszip';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { signMockWebhook } from '../src/billing/providers/mock.js';
import { BILLING_WATERMARK_TEXT } from '../src/export/model.js';
import { closePdfBrowser } from '../src/export/pdf.js';
import { loadConfig } from '../src/config.js';
import pdf from 'pdf-parse/lib/pdf-parse.js';
import { addMember, api, bearer, createRca, createUser, db, raw, rcaBody, resetDb, subscribe, subscriptionEvent, type Actor } from './helpers.js';

const binary = (res: import('superagent').Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

let owner: Actor;
let ws: string;

beforeEach(async () => {
  await resetDb();
  owner = await createUser('Olive Owner');
  ws = owner.personalWorkspaceId;
});

afterAll(() => closePdfBrowser());

const create = (actor = owner, workspaceId = ws) => api().post('/api/v1/rcas').set(bearer(actor)).send(rcaBody(workspaceId));

/** Buy an RCA unlock through the TEST MODE checkout (start + complete), like the UI does. */
async function unlock(rcaId: string, actor = owner, outcome: 'success' | 'failure' | 'cancel' = 'success') {
  const start = await api().post(`/api/v1/billing/rca/${rcaId}/checkout`).set(bearer(actor)).send({});
  expect(start.status).toBe(201);
  expect(start.body.test_mode).toBe(true);
  const done = await api().post(`/api/v1/billing/mock/sessions/${start.body.session_id}/complete`).set(bearer(actor)).send({ outcome });
  expect(done.status).toBe(200);
  return start.body;
}

async function subscribeViaCheckout(plan: 'SOLO' | 'TEAM', seats?: number, actor = owner, workspaceId = ws) {
  const start = await api().post('/api/v1/billing/subscribe').set(bearer(actor)).send({ workspace_id: workspaceId, plan, ...(seats ? { seats } : {}) });
  expect(start.status, JSON.stringify(start.body)).toBe(201);
  const done = await api().post(`/api/v1/billing/mock/sessions/${start.body.session_id}/complete`).set(bearer(actor)).send({ outcome: 'success' });
  expect(done.status).toBe(200);
}

const status = async (actor = owner, workspaceId = ws) => (await api().get(`/api/v1/billing/workspaces/${workspaceId}`).set(bearer(actor))).body;

function webhook(events: object[], secret?: string) {
  const body = JSON.stringify({ events });
  return api().post('/api/v1/webhooks/payment').set('Content-Type', 'application/json').set('x-mock-signature', signMockWebhook(body, secret)).send(body);
}

describe('unpaid RCA bucket', () => {
  it('holds 3 unpaid RCAs; the 4th is 422 BUCKET_FULL', async () => {
    for (let i = 0; i < 3; i++) expect((await create()).status).toBe(201);
    const fourth = await create();
    expect(fourth.status).toBe(422);
    expect(fourth.body.error).toBe('BUCKET_FULL');
    expect(fourth.body.details.limit).toBe(3);
    expect((await status()).bucket).toMatchObject({ unpaid: 3, limit: 3, full: true, applies: true });
  });

  it('deleting an unpaid RCA frees its slot immediately', async () => {
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push((await create()).body.id);
    expect((await api().delete(`/api/v1/rcas/${ids[0]}`).set(bearer(owner))).status).toBe(204);
    expect((await create()).status).toBe(201);
  });

  it('paying for an RCA frees its slot permanently, even after a subscription ends', async () => {
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push((await create()).body.id);
    await unlock(ids[0]);
    expect((await create()).status).toBe(201); // paid RCA no longer counts
    expect((await create()).status).toBe(422);
    await subscribe(ws, 'SOLO');
    await subscriptionEvent(ws, 'SUBSCRIPTION_CANCELED');
    const rca = await api().get(`/api/v1/rcas/${ids[0]}`).set(bearer(owner));
    expect(rca.body.billing).toMatchObject({ paid: true, watermarked: false });
    expect((await status()).bucket.unpaid).toBe(3);
  });

  it('deleting a paid RCA has no billing effect (no refund, stays paid)', async () => {
    const r = (await create()).body.id;
    await unlock(r);
    await api().delete(`/api/v1/rcas/${r}`).set(bearer(owner));
    const row = await raw(() => db.rca.findUniqueOrThrow({ where: { id: r } }));
    expect(row.paid_at).not.toBeNull();
    expect(await raw(() => db.billingHistory.count({ where: { rca_id: r, status: 'PAID' } }))).toBe(1);
  });

  it('the onboarding sample RCA takes a slot; concurrent creates never exceed the limit', async () => {
    expect((await api().post('/api/v1/rcas/sample').set(bearer(owner))).status).toBe(201);
    const results = await Promise.all(Array.from({ length: 5 }, () => create()));
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(results.filter((r) => r.status === 422)).toHaveLength(3);
    expect(await raw(() => db.rca.count({ where: { workspace_id: ws, is_deleted: false } }))).toBe(3);
  });

  it('a subscription removes the cap; after cancellation it applies again going forward', async () => {
    await subscribeViaCheckout('SOLO');
    for (let i = 0; i < 5; i++) expect((await create()).status).toBe(201);
    expect((await status()).bucket.applies).toBe(false);
    await subscriptionEvent(ws, 'SUBSCRIPTION_CANCELED');
    // Existing RCAs stay; new ones are blocked because 5 unpaid RCAs are over the limit.
    expect(await raw(() => db.rca.count({ where: { workspace_id: ws } }))).toBe(5);
    expect((await create()).body.error).toBe('BUCKET_FULL');
  });

  it('buckets cannot be multiplied without limit: a user owns at most QUOTA_OWNED_WORKSPACES workspaces', async () => {
    // The personal workspace is the first of the default 5.
    const created = await Promise.all([1, 2, 3, 4, 5].map((i) => api().post('/api/v1/workspaces').set(bearer(owner)).send({ name: `Extra ${i}` })));
    expect(created.map((r) => r.status).sort()).toEqual([201, 201, 201, 201, 422]);
    expect(created.find((r) => r.status === 422)!.body.error).toBe('QUOTA_EXCEEDED');
    expect(await raw(() => db.workspace.count({ where: { owner_id: owner.id } }))).toBe(5);
  });

  it('an expired period ends the subscription even without a cancellation event', async () => {
    await subscribe(ws, 'SOLO');
    await raw(() => db.workspace.update({ where: { id: ws }, data: { current_period_end: new Date(Date.now() - 1000) } }));
    for (let i = 0; i < 3; i++) await create();
    expect((await create()).body.error).toBe('BUCKET_FULL');
    expect((await status()).entitled).toBe(false);
  });
});

describe('watermark on every export', () => {
  const cases: [string, boolean, boolean, boolean][] = [
    // name, paid, subscribed, expectWatermark
    ['unpaid, unsubscribed', false, false, true],
    ['paid, unsubscribed', true, false, false],
    ['unpaid, subscribed', false, true, false],
    ['paid, subscribed', true, true, false],
  ];
  it.each(cases)('%s', async (_n, paid, subscribed, expected) => {
    const r = (await create()).body.id;
    if (paid) await unlock(r);
    if (subscribed) await subscribe(ws, 'SOLO');
    const view = await api().get(`/api/v1/rcas/${r}`).set(bearer(owner));
    expect(view.body.billing.watermarked).toBe(expected);

    const html = (await api().get(`/api/v1/rcas/${r}/print`).set(bearer(owner))).text;
    expect(html.includes('data-billing-watermark')).toBe(expected);
    expect(html).toContain('"Page " counter(page) " of " counter(pages)'); // layout rules untouched

    const pdfRes = await api().get(`/api/v1/rcas/${r}/export?format=pdf`).set(bearer(owner)).buffer(true).parse(binary);
    const pages: string[] = [];
    await pdf(pdfRes.body as Buffer, {
      pagerender: async (p) => {
        const t = (await p.getTextContent()).items.map((i) => i.str).join('');
        pages.push(t);
        return t;
      },
    });
    expect(pages.length).toBeGreaterThanOrEqual(4);
    for (const p of pages) {
      expect(p.includes('FREE PLAN')).toBe(expected);
      expect(p).toMatch(/Page \d+ of \d+/);
    }

    const docx = await api().get(`/api/v1/rcas/${r}/export?format=docx`).set(bearer(owner)).buffer(true).parse(binary);
    const zip = await JSZip.loadAsync(docx.body as Buffer);
    const headers = await Promise.all(Object.keys(zip.files).filter((f) => /word\/header\d*\.xml/.test(f)).map((f) => zip.file(f)!.async('string')));
    expect(headers.join('').includes(BILLING_WATERMARK_TEXT.split(' · ')[0])).toBe(expected);
  });
});

describe('verified events only, idempotent', () => {
  it('replaying the same webhook event does not double-process it', async () => {
    const r = (await create()).body.id;
    const evt = { id: 'evt_replay_1', type: 'PAYMENT_SUCCEEDED', kind: 'RCA_UNLOCK', workspaceId: ws, rcaId: r, amountCents: 900, currency: 'USD', reference: 'pi_1', occurredAt: new Date().toISOString() };
    const first = await webhook([evt]);
    expect(first.body.results[0]).toMatchObject({ status: 'processed' });
    const again = await webhook([evt]);
    expect(again.body.results[0]).toMatchObject({ status: 'duplicate' });
    expect(await raw(() => db.billingEvent.count({ where: { provider_event_id: 'evt_replay_1' } }))).toBe(1);
    expect(await raw(() => db.billingHistory.count({ where: { rca_id: r } }))).toBe(1);
    expect(await raw(() => db.auditLog.count({ where: { rca_id: r, action: 'BILLING' } }))).toBe(1);
    // Concurrent duplicates too.
    const evt2 = { ...evt, id: 'evt_replay_2', type: 'SUBSCRIPTION_ACTIVATED', plan: 'SOLO', subscriptionRef: 'sub_x', periodEnd: new Date(Date.now() + 86_400_000).toISOString() };
    const both = await Promise.all([webhook([evt2]), webhook([evt2])]);
    expect(both.map((b) => b.body.results[0].status).sort()).toEqual(['duplicate', 'processed']);
  });

  it('rejects unsigned or tampered webhooks (400) without changing anything', async () => {
    const r = (await create()).body.id;
    const body = JSON.stringify({ events: [{ id: 'evt_forged', type: 'PAYMENT_SUCCEEDED', kind: 'RCA_UNLOCK', workspaceId: ws, rcaId: r, occurredAt: new Date().toISOString() }] });
    expect((await api().post('/api/v1/webhooks/payment').set('Content-Type', 'application/json').send(body)).status).toBe(400);
    expect((await webhook(JSON.parse(body).events, 'wrong-secret')).status).toBe(400);
    expect((await raw(() => db.rca.findUniqueOrThrow({ where: { id: r } }))).paid_at).toBeNull();
  });

  it('the client cannot mark anything paid: no field, success redirects change nothing, failures unlock nothing', async () => {
    const r = (await create()).body.id;
    expect((await api().patch(`/api/v1/rcas/${r}`).set(bearer(owner)).send({ paid_at: new Date().toISOString() })).status).toBe(400);
    // Starting a checkout alone (the "success" redirect never reaches the API) changes nothing.
    await api().post(`/api/v1/billing/rca/${r}/checkout`).set(bearer(owner)).send({});
    expect((await api().get(`/api/v1/rcas/${r}`).set(bearer(owner))).body.billing.paid).toBe(false);
    await unlock(r, owner, 'failure');
    expect((await api().get(`/api/v1/rcas/${r}`).set(bearer(owner))).body.billing.paid).toBe(false);
    const hist = await api().get(`/api/v1/billing/workspaces/${ws}/history`).set(bearer(owner));
    expect(hist.body.data.map((h: { status: string }) => h.status)).toEqual(['FAILED']);
    await unlock(r, owner, 'cancel');
    expect((await api().get(`/api/v1/rcas/${r}`).set(bearer(owner))).body.billing.paid).toBe(false);
  });

  it('only the buyer can complete a mock checkout; events for a mismatched session are ignored', async () => {
    const r = (await create()).body.id;
    const other = await createUser('Mallory');
    const start = await api().post(`/api/v1/billing/rca/${r}/checkout`).set(bearer(owner)).send({});
    expect((await api().post(`/api/v1/billing/mock/sessions/${start.body.session_id}/complete`).set(bearer(other)).send({ outcome: 'success' })).status).toBe(404);
    const otherRca = await createRca(other, other.personalWorkspaceId);
    const res = await webhook([{ id: 'evt_mismatch', type: 'PAYMENT_SUCCEEDED', kind: 'RCA_UNLOCK', workspaceId: ws, rcaId: otherRca.id, checkoutSessionId: start.body.session_id, occurredAt: new Date().toISOString() }]);
    expect(res.body.results[0].status).toBe('ignored');
    expect((await raw(() => db.rca.findUniqueOrThrow({ where: { id: otherRca.id } }))).paid_at).toBeNull();
  });

  it('already-paid RCAs cannot be bought again (409); stale subscription events are ignored', async () => {
    const r = (await create()).body.id;
    await unlock(r);
    expect((await api().post(`/api/v1/billing/rca/${r}/checkout`).set(bearer(owner)).send({})).status).toBe(409);
    await subscribe(ws, 'SOLO', 0, 'sub_current');
    const stale = await webhook([{ id: 'evt_stale', type: 'SUBSCRIPTION_CANCELED', workspaceId: ws, subscriptionRef: 'sub_old', occurredAt: new Date().toISOString() }]);
    expect(stale.body.results[0].status).toBe('ignored');
    expect((await status()).entitled).toBe(true);
  });

  it('refuses the mock provider in production unless explicitly allowed (staging)', () => {
    const prod = { NODE_ENV: 'production', DATABASE_URL: 'postgres://x', JWT_SECRET: 'x'.repeat(40), EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'k', STORAGE_DRIVER: 's3', S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'a', S3_SECRET_ACCESS_KEY: 's' };
    expect(() => loadConfig(prod)).toThrow(/PAYMENT_PROVIDER/);
    expect(() => loadConfig({ ...prod, ALLOW_MOCK_PAYMENTS: 'true', MOCK_WEBHOOK_SECRET: 'random-staging-secret' })).not.toThrow();
    expect(() => loadConfig({ ...prod, PAYMENT_PROVIDER: 'stripe' })).toThrow(/STRIPE_SECRET_KEY/);
  });
});

describe('subscriptions, invites and collaborators', () => {
  it('invites are blocked without an active Team subscription (403 SUBSCRIPTION_REQUIRED) and allowed with one', async () => {
    const r = (await create()).body.id;
    const inviteWs = () => api().post(`/api/v1/workspaces/${ws}/invitations`).set(bearer(owner)).send({ email: 'friend@x.test', role: 'EDITOR' });
    const inviteRca = () => api().post(`/api/v1/rcas/${r}/invitations`).set(bearer(owner)).send({ email: 'dev@x.test', role: 'CONTRIBUTOR', team: 'DEV' });
    expect((await inviteWs()).body.error).toBe('SUBSCRIPTION_REQUIRED');
    expect((await inviteRca()).body.error).toBe('SUBSCRIPTION_REQUIRED');
    await subscribeViaCheckout('SOLO');
    expect((await inviteWs()).status).toBe(403); // Solo: single person
    await subscriptionEvent(ws, 'SUBSCRIPTION_CANCELED');
    await subscribeViaCheckout('TEAM', 2);
    expect((await inviteWs()).status).toBe(201);
    expect((await inviteRca()).status).toBe(201);
    const third = await api().post(`/api/v1/workspaces/${ws}/invitations`).set(bearer(owner)).send({ email: 'third@x.test', role: 'VIEWER' });
    expect(third.status).toBe(403);
    expect(third.body.error).toBe('SEAT_LIMIT_REACHED');
    expect((await status()).seats_used).toBe(2);
  });

  it('PAST_DUE / CANCELED: collaborators become read-only (not removed), paid RCAs stay unlocked, cap and watermark return, owner is warned', async () => {
    await subscribeViaCheckout('TEAM', 3);
    const editor = await createUser('Eddie Editor');
    await addMember(ws, editor, 'EDITOR');
    const paid = (await create()).body.id;
    const other = (await create()).body.id;
    await unlock(paid);
    expect((await api().patch(`/api/v1/rcas/${other}`).set(bearer(editor)).send({ impact_users: 'x' })).status).toBe(200);

    for (const type of ['SUBSCRIPTION_PAST_DUE', 'SUBSCRIPTION_CANCELED'] as const) {
      await subscriptionEvent(ws, type);
      const view = await api().get(`/api/v1/rcas/${other}`).set(bearer(editor));
      expect(view.status).toBe(200);
      expect(view.body.permissions).toMatchObject({ role: 'VIEWER', edit: false, read_only_reason: 'SUBSCRIPTION_INACTIVE' });
      expect((await api().patch(`/api/v1/rcas/${other}`).set(bearer(editor)).send({ impact_users: 'y' })).status).toBe(403);
      expect((await api().post('/api/v1/rcas').set(bearer(editor)).send(rcaBody(ws))).status).toBe(403);
      expect(await raw(() => db.workspaceMember.count({ where: { workspace_id: ws, user_id: editor.id } }))).toBe(1);
      expect((await api().get(`/api/v1/rcas/${paid}`).set(bearer(owner))).body.billing).toMatchObject({ paid: true, watermarked: false });
      expect((await api().get(`/api/v1/rcas/${other}`).set(bearer(owner))).body.billing.watermarked).toBe(true);
      // The owner can still edit their own workspace.
      expect((await api().patch(`/api/v1/rcas/${other}`).set(bearer(owner)).send({ impact_users: 'owner' })).status).toBe(200);
      const alerts = await api().get('/api/v1/billing/alerts').set(bearer(owner));
      expect(alerts.body.data).toEqual([expect.objectContaining({ id: ws, subscription_status: type === 'SUBSCRIPTION_PAST_DUE' ? 'PAST_DUE' : 'CANCELED' })]);
      expect((await api().get('/api/v1/billing/alerts').set(bearer(editor))).body.data).toEqual([]);
      if (type === 'SUBSCRIPTION_PAST_DUE') {
        // Renewal after a failed payment restores everything.
        await subscriptionEvent(ws, 'SUBSCRIPTION_RENEWED', { periodEnd: new Date(Date.now() + 30 * 86_400_000).toISOString() });
        expect((await api().patch(`/api/v1/rcas/${other}`).set(bearer(editor)).send({ impact_users: 'z' })).status).toBe(200);
      }
    }
  });

  it('the TEST MODE portal renews, changes seats, simulates past due and cancels through events', async () => {
    await subscribeViaCheckout('TEAM', 1);
    const portal = await api().post('/api/v1/billing/portal').set(bearer(owner)).send({ workspace_id: ws });
    expect(portal.body.portal_url).toContain(`/billing/test-portal/${ws}`);
    const act = (body: object) => api().post(`/api/v1/billing/mock/portal/${ws}`).set(bearer(owner)).send(body);
    const before = (await status()).current_period_end;
    await act({ action: 'renew' });
    expect(new Date((await status()).current_period_end).getTime()).toBeGreaterThan(new Date(before).getTime());
    await act({ action: 'seats', seats: 4 });
    expect((await status()).seats).toBe(4);
    await act({ action: 'past_due' });
    expect((await status()).subscription_status).toBe('PAST_DUE');
    await act({ action: 'cancel' });
    expect((await status()).subscription_status).toBe('CANCELED');
    const history = await api().get(`/api/v1/billing/workspaces/${ws}/history`).set(bearer(owner));
    expect(history.body.data.map((h: { status: string }) => h.status).sort()).toEqual(['FAILED', 'PAID', 'PAID']);
    const audit = await raw(() => db.auditLog.findMany({ where: { workspace_id: ws, action: 'BILLING' } }));
    expect(audit.length).toBeGreaterThanOrEqual(6);
  });

  it('only the paying owner manages billing; members see status; pricing is public', async () => {
    await subscribe(ws, 'TEAM', 3);
    const editor = await createUser('Eddie');
    await addMember(ws, editor, 'EDITOR');
    expect((await api().post('/api/v1/billing/subscribe').set(bearer(editor)).send({ workspace_id: ws, plan: 'TEAM' })).status).toBe(403);
    expect((await api().post('/api/v1/billing/portal').set(bearer(editor)).send({ workspace_id: ws })).status).toBe(403);
    expect((await api().get(`/api/v1/billing/workspaces/${ws}/history`).set(bearer(editor))).status).toBe(403);
    expect((await status(editor)).plan).toBe('TEAM');
    const pricing = await api().get('/api/v1/billing/pricing');
    expect(pricing.body).toMatchObject({ currency: 'USD', test_mode: true, free: { rca_limit: 3 }, rca_unlock: { amount_cents: 900 }, team: { base_cents: 2900, seat_cents: 800 } });
    const sub = await api().post('/api/v1/billing/subscribe').set(bearer(owner)).send({ workspace_id: ws, plan: 'SOLO' });
    expect(sub.status).toBe(409);
  });
});
