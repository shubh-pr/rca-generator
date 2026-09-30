/**
 * Tenant isolation suite (docs/B2C_PLAN.md section 4). User B must never read, change, export,
 * download an attachment from, or see the audit log of user A's data. Every route mounted under
 * /rcas/:id must appear in PER_RCA below; the coverage test fails when a new route is added
 * without an isolation case.
 */
import { createHash } from 'node:crypto';
type Layer = { route?: unknown; handle: unknown };
import { beforeAll, describe, expect, it } from 'vitest';
import { rcaRouter } from '../src/routes/rca/index.js';
import { loadFullRca } from '../src/services/rcaQueries.js';
import {
  api,
  bearer,
  COMMON_COMPLETE,
  createRca,
  createUser,
  db,
  fillAndSubmitSection,
  raw,
  resetDb,
  subscribe,
  type Actor,
} from './helpers.js';

const MARKER = 'ALPHA-SECRET-7F3A';

let A: Actor;
let B: Actor;
const ids: Record<string, string> = {};

async function snapshotA() {
  const rca = await raw(() => loadFullRca(db, ids.rca));
  const tables = await raw(async () => ({
    rca: await db.rca.count(),
    audit: await db.auditLog.count({ where: { workspace_id: A.personalWorkspaceId } }),
    attachments: await db.rcaAttachment.count(),
    followups: await db.rcaFollowup.count(),
    actions: await db.rcaAction.count(),
    timeline: await db.rcaTimeline.count(),
    collaborators: await db.rcaCollaborator.count(),
    invitations: await db.invitation.count(),
    members: await db.workspaceMember.count(),
  }));
  return createHash('sha256').update(JSON.stringify({ rca, tables })).digest('hex');
}

beforeAll(async () => {
  await resetDb();
  A = await createUser('Alice Alpha');
  B = await createUser('Bob Beta');
  // A: one fully populated RCA in review, plus a second DRAFT RCA.
  const r = await createRca(A, A.personalWorkspaceId, { summary: `${MARKER} checkout outage`, ticket_id: MARKER, project_name: `${MARKER}-project` });
  ids.rca = r.id;
  await api().patch(`/api/v1/rcas/${r.id}`).set(bearer(A)).send(COMMON_COMPLETE);
  const ev = await api().post(`/api/v1/rcas/${r.id}/timeline`).set(bearer(A)).send({ event_time: '2026-09-27T14:05:00Z', event: `${MARKER} alert` });
  ids.timeline = ev.body.id;
  for (const team of ['DEV', 'QA', 'PROD'] as const) {
    const { action } = await fillAndSubmitSection(A, r.id, team, { actionStatus: 'IN_PROGRESS' });
    ids[`action_${team}`] = action.id;
  }
  const f = await api().post(`/api/v1/rcas/${r.id}/followups`).set(bearer(A)).send({ risk: `${MARKER} risk`, owner_id: A.id, due_date: '2026-12-01' });
  ids.followup = f.body.id;
  const file = await api().post(`/api/v1/rcas/${r.id}/attachments`).set(bearer(A)).attach('file', Buffer.from(`${MARKER} log`), 'secret.log');
  ids.attachment = file.body.id;
  await api().post(`/api/v1/rcas/${r.id}/submit-review`).set(bearer(A)).send({});
  await subscribe(A.personalWorkspaceId, 'TEAM', 5); // collaboration is a Team feature
  const inv = await api().post(`/api/v1/rcas/${r.id}/invitations`).set(bearer(A)).send({ email: 'friend-of-a@x.test', role: 'VIEWER' });
  const checkout = await api().post(`/api/v1/billing/rca/${ids.rca}/checkout`).set(bearer(A)).send({});
  ids.checkout = checkout.body.session_id;
  ids.invitation = inv.body.id;
  const draft = await createRca(A, A.personalWorkspaceId, { summary: `${MARKER} second` });
  ids.draft = draft.id;
  // B has data of their own, so B's lists are not trivially empty.
  await createRca(B, B.personalWorkspaceId, { summary: 'Bob outage' });
});

type Case = { method: 'get' | 'post' | 'put' | 'patch' | 'delete'; route: string; path: () => string; body?: () => object };

const R = () => `/api/v1/rcas/${ids.rca}`;
/** Every route of rcaRouter, attacked by B with A's real ids. */
const PER_RCA: Case[] = [
  { method: 'get', route: 'GET /', path: () => R() },
  { method: 'patch', route: 'PATCH /', path: () => R(), body: () => ({ summary: 'pwned' }) },
  { method: 'delete', route: 'DELETE /', path: () => R() },
  { method: 'get', route: 'GET /participants', path: () => `${R()}/participants` },
  { method: 'put', route: 'PUT /signoffs/:role/assignee', path: () => `${R()}/signoffs/DEV_LEAD/assignee`, body: () => ({ user_id: B.id }) },
  { method: 'get', route: 'GET /timeline', path: () => `${R()}/timeline` },
  { method: 'post', route: 'POST /timeline', path: () => `${R()}/timeline`, body: () => ({ event_time: '2026-09-27T14:05:00Z', event: 'pwned' }) },
  { method: 'patch', route: 'PATCH /timeline/:tid', path: () => `${R()}/timeline/${ids.timeline}`, body: () => ({ event: 'pwned' }) },
  { method: 'delete', route: 'DELETE /timeline/:tid', path: () => `${R()}/timeline/${ids.timeline}` },
  { method: 'get', route: 'GET /sections/:team', path: () => `${R()}/sections/DEV` },
  { method: 'put', route: 'PUT /sections/:team', path: () => `${R()}/sections/DEV`, body: () => ({ version: 1, extra_1: 'pwned' }) },
  { method: 'post', route: 'POST /sections/:team/submit', path: () => `${R()}/sections/DEV/submit`, body: () => ({}) },
  { method: 'post', route: 'POST /sections/:team/reopen', path: () => `${R()}/sections/DEV/reopen`, body: () => ({}) },
  { method: 'post', route: 'POST /sections/:team/actions', path: () => `${R()}/sections/DEV/actions`, body: () => ({ action: 'pwned', owner_id: B.id, due_date: '2026-12-01' }) },
  { method: 'patch', route: 'PATCH /sections/:team/actions/:aid', path: () => `${R()}/sections/DEV/actions/${ids.action_DEV}`, body: () => ({ status: 'COMPLETED' }) },
  { method: 'delete', route: 'DELETE /sections/:team/actions/:aid', path: () => `${R()}/sections/DEV/actions/${ids.action_DEV}` },
  { method: 'post', route: 'POST /submit-review', path: () => `/api/v1/rcas/${ids.draft}/submit-review`, body: () => ({}) },
  { method: 'post', route: 'POST /send-back', path: () => `${R()}/send-back`, body: () => ({ comment: 'x', teams: ['DEV'] }) },
  { method: 'post', route: 'POST /close', path: () => `${R()}/close`, body: () => ({}) },
  { method: 'post', route: 'POST /reopen', path: () => `${R()}/reopen`, body: () => ({ reason: 'x' }) },
  { method: 'post', route: 'POST /signoffs/:role', path: () => `${R()}/signoffs/DEV_LEAD`, body: () => ({}) },
  { method: 'get', route: 'GET /followups', path: () => `${R()}/followups` },
  { method: 'post', route: 'POST /followups', path: () => `${R()}/followups`, body: () => ({ risk: 'pwned' }) },
  { method: 'patch', route: 'PATCH /followups/:fid', path: () => `${R()}/followups/${ids.followup}`, body: () => ({ risk: 'pwned' }) },
  { method: 'delete', route: 'DELETE /followups/:fid', path: () => `${R()}/followups/${ids.followup}` },
  { method: 'get', route: 'GET /attachments', path: () => `${R()}/attachments` },
  { method: 'post', route: 'POST /attachments', path: () => `${R()}/attachments`, body: () => ({ kind: 'LINK', url: 'https://evil.test' }) },
  { method: 'get', route: 'GET /attachments/:aid/download', path: () => `${R()}/attachments/${ids.attachment}/download` },
  { method: 'delete', route: 'DELETE /attachments/:aid', path: () => `${R()}/attachments/${ids.attachment}` },
  { method: 'get', route: 'GET /audit', path: () => `${R()}/audit` },
  { method: 'get', route: 'GET /print', path: () => `${R()}/print` },
  { method: 'get', route: 'GET /export', path: () => `${R()}/export?format=pdf` },
  { method: 'get', route: 'GET /collaborators', path: () => `${R()}/collaborators` },
  { method: 'patch', route: 'PATCH /collaborators/:uid', path: () => `${R()}/collaborators/${A.id}`, body: () => ({ role: 'VIEWER' }) },
  { method: 'delete', route: 'DELETE /collaborators/:uid', path: () => `${R()}/collaborators/${A.id}` },
  { method: 'get', route: 'GET /invitations', path: () => `${R()}/invitations` },
  { method: 'post', route: 'POST /invitations', path: () => `${R()}/invitations`, body: () => ({ email: 'b-friend@x.test', role: 'EDITOR' }) },
  { method: 'delete', route: 'DELETE /invitations/:iid', path: () => `${R()}/invitations/${ids.invitation}` },
];

/** Method + path of every route registered on rcaRouter (including nested routers). */
function registeredRoutes(): string[] {
  const out: string[] = [];
  const walk = (stack: Layer[]) => {
    for (const layer of stack) {
      const route = (layer as unknown as { route?: { path: string; methods: Record<string, boolean> } }).route;
      if (route) {
        for (const m of Object.keys(route.methods)) out.push(`${m.toUpperCase()} ${route.path}`);
      } else {
        const nested = (layer.handle as unknown as { stack?: Layer[] }).stack;
        if (nested) walk(nested);
      }
    }
  };
  walk((rcaRouter as unknown as { stack: Layer[] }).stack);
  return out.sort();
}

function expectNoLeak(text: string) {
  expect(text).not.toContain(MARKER);
  for (const id of Object.values(ids)) expect(text).not.toContain(id);
}

describe('tenant isolation', () => {
  it('covers every /rcas/:id route', () => {
    expect(registeredRoutes()).toEqual(PER_RCA.map((c) => c.route).sort());
  });

  it.each(PER_RCA.map((c) => [c.route, c] as const))('B gets 404 on A\'s RCA: %s', async (_name, c) => {
    const before = await snapshotA();
    let req = api()[c.method](c.path()).set(bearer(B));
    if (c.body) req = req.send(c.body());
    const res = await req;
    expect(res.status).toBe(404);
    expectNoLeak(res.text);
    expect(await snapshotA()).toBe(before);
  });

  it('A still sees and can change their own data (the suite attacks real, working ids)', async () => {
    expect((await api().get(`${R()}/attachments/${ids.attachment}/download`).set(bearer(A))).text).toContain(MARKER);
    expect((await api().get(`${R()}/audit`).set(bearer(A))).body.total).toBeGreaterThan(5);
    expect((await api().get(`${R()}/export?format=docx`).set(bearer(A))).status).toBe(200);
  });

  it('collection endpoints never include A\'s data', async () => {
    const cases: [string, (text: string, body: Record<string, unknown>) => void][] = [
      ['/api/v1/rcas', (_t, b) => expect(b.total).toBe(1)],
      [`/api/v1/rcas?workspace_id=${A.personalWorkspaceId}`, (_t, b) => expect(b.total).toBe(0)],
      ['/api/v1/rcas?q=ALPHA', (_t, b) => expect(b.total).toBe(0)],
      ['/api/v1/dashboard/summary', (_t, b) => expect((b.kpis as { open_rcas: { count: number } }).open_rcas.count).toBe(1)],
      [`/api/v1/dashboard/summary?workspace_id=${A.personalWorkspaceId}`, (_t, b) => expect((b.kpis as { open_rcas: { count: number } }).open_rcas.count).toBe(0)],
      ['/api/v1/my-tasks', () => {}],
      ['/api/v1/audit', () => {}],
      [`/api/v1/audit?workspace_id=${A.personalWorkspaceId}`, (_t, b) => expect(b.total).toBe(0)],
      [`/api/v1/audit?rca_id=${ids.rca}`, (_t, b) => expect(b.total).toBe(0)],
      ['/api/v1/rcas/export?format=csv', (t) => expect(t.trim().split('\r\n')).toHaveLength(2)],
      ['/api/v1/rcas/export?format=csv&rows=actions', (t) => expect(t.trim().split('\r\n')).toHaveLength(1)],
      ['/api/v1/workspaces', (_t, b) => expect(b.data).toHaveLength(1)],
      ['/api/v1/me', () => {}],
    ];
    for (const [path, check] of cases) {
      const res = await api().get(path).set(bearer(B));
      expect(res.status, path).toBe(200);
      expectNoLeak(res.text);
      check(res.text, res.body);
    }
    const labels = await api().get(`/api/v1/workspaces/${A.personalWorkspaceId}/labels`).set(bearer(B));
    expect(labels.status).toBe(404);
    expectNoLeak(labels.text);
  });

  it('B gets 404 on every endpoint of A\'s workspace', async () => {
    const W = `/api/v1/workspaces/${A.personalWorkspaceId}`;
    const cases: [string, string, object?][] = [
      ['get', `${W}/members`],
      ['get', `${W}/access`],
      ['patch', `${W}/members/${A.id}`, { role: 'VIEWER' }],
      ['delete', `${W}/members/${A.id}`],
      ['post', `${W}/transfer`, { user_id: B.id }],
      ['get', `${W}/invitations`],
      ['post', `${W}/invitations`, { email: 'b-friend@x.test', role: 'OWNER' }],
      ['delete', `${W}/invitations/${ids.invitation}`],
      ['patch', W, { name: 'pwned' }],
      ['delete', W, { confirm_name: "Alice Alpha's workspace" }],
      ['get', `${W}/labels`],
    ];
    for (const [method, path, body] of cases) {
      const before = await snapshotA();
      let req = (api() as unknown as Record<string, (p: string) => ReturnType<ReturnType<typeof api>['get']>>)[method](path).set(bearer(B));
      if (body) req = req.send(body);
      const res = await req;
      expect(res.status, `${method} ${path}`).toBe(404);
      expectNoLeak(res.text);
      expect(await snapshotA()).toBe(before);
    }
  });

  it('B gets 404 on A\'s billing endpoints and cannot pay for, subscribe to or view A\'s billing', async () => {
    const W = A.personalWorkspaceId;
    const before = await snapshotA();
    const cases: [string, string, object?][] = [
      ['post', `/api/v1/billing/rca/${ids.rca}/checkout`, {}],
      ['get', `/api/v1/billing/workspaces/${W}`],
      ['get', `/api/v1/billing/workspaces/${W}/history`],
      ['post', '/api/v1/billing/subscribe', { workspace_id: W, plan: 'TEAM', seats: 3 }],
      ['post', '/api/v1/billing/portal', { workspace_id: W }],
      ['post', `/api/v1/billing/mock/portal/${W}`, { action: 'cancel' }],
      ['get', `/api/v1/billing/mock/sessions/${ids.checkout}`],
      ['post', `/api/v1/billing/mock/sessions/${ids.checkout}/complete`, { outcome: 'success' }],
    ];
    for (const [method, path, body] of cases) {
      let req = (api() as unknown as Record<string, (p: string) => ReturnType<ReturnType<typeof api>['get']>>)[method](path).set(bearer(B));
      if (body) req = req.send(body);
      const res = await req;
      expect(res.status, `${method} ${path}`).toBe(404);
      expectNoLeak(res.text);
    }
    expect((await api().get('/api/v1/billing/alerts').set(bearer(B))).body.data).toEqual([]);
    expect(await snapshotA()).toBe(before);
  });

  it('B cannot create an RCA inside A\'s workspace', async () => {
    const before = await raw(() => db.rca.count({ where: { workspace_id: A.personalWorkspaceId } }));
    const res = await api()
      .post('/api/v1/rcas')
      .set(bearer(B))
      .send({ workspace_id: A.personalWorkspaceId, rca_date: '2026-09-28', severity: 'P1', environment: 'PROD', incident_start: '2026-09-27T10:00:00Z', summary: 'x' });
    expect(res.status).toBe(400);
    expect(await raw(() => db.rca.count({ where: { workspace_id: A.personalWorkspaceId } }))).toBe(before);
  });

  it('the reverse direction holds too: A cannot read B\'s RCA', async () => {
    const bRca = await raw(() => db.rca.findFirstOrThrow({ where: { workspace_id: B.personalWorkspaceId } }));
    expect((await api().get(`/api/v1/rcas/${bRca.id}`).set(bearer(A))).status).toBe(404);
    expect((await api().get(`/api/v1/rcas/${bRca.id}/print`).set(bearer(A))).status).toBe(404);
  });
});
