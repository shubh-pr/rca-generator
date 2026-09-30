/**
 * "Shared with me": RCAs a user was invited to directly, in workspaces they are not a member of.
 * It is a filter over what the user can already see, never a new access level.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { ConsoleEmailProvider, emailProvider, flushEmails } from '../src/email/index.js';
import { addCollaborator, api, bearer, createRca, createTeam, createUser, resetDb, type Actor, type RoleKey } from './helpers.js';

const outbox = () => (emailProvider() as ConsoleEmailProvider).outbox;
async function inviteAndAccept(owner: Actor, rcaId: string, who: Actor, role: string, team?: string) {
  expect((await api().post(`/api/v1/rcas/${rcaId}/invitations`).set(bearer(owner)).send({ email: who.email, role, ...(team ? { team } : {}) })).status).toBe(201);
  await flushEmails();
  const mail = [...outbox()].reverse().find((m) => m.to === who.email && m.template === 'invitation');
  const token = /token=([A-Za-z0-9_-]+)/.exec(mail!.text)![1];
  expect((await api().post('/api/v1/invitations/accept').set(bearer(who)).send({ token })).status).toBe(200);
}

let a: Record<RoleKey, Actor>;
let ws: string;
beforeEach(async () => {
  await resetDb();
  outbox().length = 0;
  ({ a, workspaceId: ws } = await createTeam());
});

const list = async (who: Actor, query = '') => (await api().get(`/api/v1/rcas?page_size=100${query}`).set(bearer(who))).body;

describe('Shared with me', () => {
  it('lists only RCAs shared directly, with who shared them, the workspace and my access; my workspaces do not include them', async () => {
    const shared = await createRca(a.OWNER, ws, { summary: 'Shared outage' });
    await createRca(a.OWNER, ws, { summary: 'Not shared' });
    const shubham = await createUser('Shubham P', { email: 'shubham@x.test' });
    const mine = await createRca(shubham, shubham.personalWorkspaceId, { summary: 'My own' });
    await inviteAndAccept(a.OWNER, shared.id, shubham, 'CONTRIBUTOR', 'DEV');

    const sharedList = await list(shubham, '&shared=true');
    expect(sharedList.total).toBe(1);
    expect(sharedList.data[0]).toMatchObject({
      id: shared.id,
      workspace: { id: ws, name: 'Team workspace' },
      shared: { by: a.OWNER.name, workspace_name: 'Team workspace', role: 'CONTRIBUTOR', team: 'DEV' },
    });
    // My own workspace does not contain it (the reported confusion) …
    const own = await list(shubham, `&workspace_id=${shubham.personalWorkspaceId}`);
    expect(own.data.map((r: { id: string }) => r.id)).toEqual([mine.id]);
    // … "All workspaces" has both; only the shared one is marked.
    const all = await list(shubham);
    expect(Object.fromEntries(all.data.map((r: { id: string; shared: unknown }) => [r.id, r.shared !== null]))).toEqual({ [shared.id]: true, [mine.id]: false });
    // /me counts exactly these.
    expect((await api().get('/api/v1/me').set(bearer(shubham))).body.shared_rca_count).toBe(1);
  });

  it('a workspace member who is also an RCA collaborator is not "shared with me"; the owner never sees their own RCAs there', async () => {
    const r = await createRca(a.OWNER, ws);
    await addCollaborator(r.id, a.VIEWER, 'EDITOR');
    expect((await list(a.VIEWER, '&shared=true')).total).toBe(0);
    expect((await list(a.OWNER, '&shared=true')).total).toBe(0);
    expect((await api().get('/api/v1/me').set(bearer(a.VIEWER))).body.shared_rca_count).toBe(0);
  });

  it('dashboard and list export honour the same filter', async () => {
    const shared = await createRca(a.OWNER, ws);
    const guest = await createUser('Guest', { email: 'guest@x.test' });
    await createRca(guest, guest.personalWorkspaceId);
    await inviteAndAccept(a.OWNER, shared.id, guest, 'VIEWER');
    const summary = await api().get('/api/v1/dashboard/summary?shared=true').set(bearer(guest));
    expect(summary.body.kpis.open_rcas.count).toBe(1);
    expect((await api().get('/api/v1/dashboard/summary').set(bearer(guest))).body.kpis.open_rcas.count).toBe(2);
    const csv = await api().get('/api/v1/rcas/export?format=csv&shared=true').set(bearer(guest));
    expect(csv.text.trim().split('\n')).toHaveLength(2); // header + the shared RCA
    expect(csv.text).toContain(shared.rca_number);
  });

  it('opening a shared RCA keeps the existing permissions: contributor edits only their team, viewer nothing', async () => {
    const r1 = await createRca(a.OWNER, ws);
    const r2 = await createRca(a.OWNER, ws);
    const con = await createUser('Con', { email: 'con@x.test' });
    await inviteAndAccept(a.OWNER, r1.id, con, 'CONTRIBUTOR', 'DEV');
    await inviteAndAccept(a.OWNER, r2.id, con, 'VIEWER');
    expect((await list(con, '&shared=true')).data.map((r: { shared: { role: string } }) => r.shared.role).sort()).toEqual(['CONTRIBUTOR', 'VIEWER']);

    const p1 = (await api().get(`/api/v1/rcas/${r1.id}`).set(bearer(con))).body.permissions;
    expect(p1).toMatchObject({ role: 'CONTRIBUTOR', edit: false, edit_section: { DEV: true, QA: false, PROD: false } });
    const p2 = (await api().get(`/api/v1/rcas/${r2.id}`).set(bearer(con))).body.permissions;
    expect(p2).toMatchObject({ role: 'VIEWER', edit: false, edit_section: { DEV: false, QA: false, PROD: false } });
    expect((await api().patch(`/api/v1/rcas/${r2.id}`).set(bearer(con)).send({ ticket_id: 'X' })).status).toBe(403);
  });
});
