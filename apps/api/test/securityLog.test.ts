/** The personal Security log: own RCA exports are included, and the ids in events are resolved. */
import { beforeEach, describe, expect, it } from 'vitest';
import { ConsoleEmailProvider, emailProvider, flushEmails } from '../src/email/index.js';
import { api, bearer, createRca, createTeam, createUser, resetDb, type Actor, type RoleKey } from './helpers.js';

let a: Record<RoleKey, Actor>;
let ws: string;
beforeEach(async () => {
  await resetDb();
  (emailProvider() as ConsoleEmailProvider).outbox.length = 0;
  ({ a, workspaceId: ws } = await createTeam());
});

interface Row { action: string; entity: string; rca_id: string | null; new_value: Record<string, unknown> }

describe('GET /me/security-events', () => {
  it('includes own RCA exports and resolves RCA numbers, workspaces, people and revoked invitations', async () => {
    const r = await createRca(a.OWNER, ws);
    const guest = await createUser('Gina Guest', { email: 'gina@x.test' });
    expect((await api().get(`/api/v1/rcas/${r.id}/print`).set(bearer(a.OWNER))).status).toBe(200);
    expect((await api().get('/api/v1/rcas/export?format=csv&status=DRAFT').set(bearer(a.OWNER))).status).toBe(200);
    expect((await api().get('/api/v1/templates/rca-blank.docx').set(bearer(a.OWNER))).status).toBe(200);
    const inv = await api().post(`/api/v1/rcas/${r.id}/invitations`).set(bearer(a.OWNER)).send({ email: 'later@x.test', role: 'VIEWER' });
    await api().delete(`/api/v1/rcas/${r.id}/invitations/${inv.body.id}`).set(bearer(a.OWNER));
    await api().post(`/api/v1/rcas/${r.id}/invitations`).set(bearer(a.OWNER)).send({ email: 'gina@x.test', role: 'VIEWER' });
    await flushEmails();
    const token = /token=([A-Za-z0-9_-]+)/.exec([...(emailProvider() as ConsoleEmailProvider).outbox].reverse().find((m) => m.to === 'gina@x.test')!.text)![1];
    await api().post('/api/v1/invitations/accept').set(bearer(guest)).send({ token });
    await api().patch(`/api/v1/rcas/${r.id}/collaborators/${guest.id}`).set(bearer(a.OWNER)).send({ role: 'CONTRIBUTOR', team: 'QA' });
    await api().delete(`/api/v1/rcas/${r.id}/collaborators/${guest.id}`).set(bearer(a.OWNER));

    const res = await api().get('/api/v1/me/security-events?page_size=100').set(bearer(a.OWNER));
    expect(res.status).toBe(200);
    const rows = res.body.data as Row[];
    const byAction = (action: string, pred: (r: Row) => boolean = () => true) => rows.find((x) => x.action === action && pred(x));

    expect(byAction('EXPORT', (x) => x.entity === 'rca')).toMatchObject({ rca_id: r.id, new_value: { format: 'print' } });
    expect(byAction('EXPORT', (x) => x.entity === 'rca_list')?.new_value).toMatchObject({ format: 'csv', rows: 'rca', count: expect.any(Number) });
    expect(byAction('EXPORT', (x) => x.entity === 'template')?.new_value).toMatchObject({ template: 'blank' });
    expect(byAction('INVITE', (x) => x.new_value.email === 'later@x.test')?.new_value).toMatchObject({ rca_id: r.id, role: 'VIEWER' });
    const revoke = byAction('INVITE_REVOKE')!;
    expect(byAction('ROLE_CHANGE')?.new_value).toMatchObject({ user_id: guest.id, from: 'VIEWER', to: 'CONTRIBUTOR', team: 'QA' });
    expect(byAction('MEMBER_REMOVE')?.new_value).toMatchObject({ user_id: guest.id, rca_id: r.id });

    const refs = res.body.refs;
    expect(refs.rcas[r.id]).toBe(r.rca_number);
    expect(refs.users[guest.id]).toEqual({ name: 'Gina Guest', email: 'gina@x.test' });
    expect(refs.invitations[revoke.new_value.invitation_id as string]).toMatchObject({ email: 'later@x.test', role: 'VIEWER', rca_id: r.id });
    // Only the user's own events: the guest sees their accept, not the owner's exports.
    const guestLog = (await api().get('/api/v1/me/security-events?page_size=100').set(bearer(guest))).body.data as Row[];
    expect(guestLog.map((x) => x.action)).toEqual(expect.arrayContaining(['INVITE_ACCEPT']));
    expect(guestLog.find((x) => x.action === 'EXPORT')).toBeUndefined();
  });

  it('workspace creation, deletion and role changes resolve the workspace and person', async () => {
    const created = await api().post('/api/v1/workspaces').set(bearer(a.OWNER)).send({ name: 'Temp team' });
    await api().patch(`/api/v1/workspaces/${ws}/members/${a.VIEWER.id}`).set(bearer(a.OWNER)).send({ role: 'EDITOR' });
    await api().delete(`/api/v1/workspaces/${created.body.id}`).set(bearer(a.OWNER)).send({ confirm_name: 'Temp team' });
    const res = await api().get('/api/v1/me/security-events?page_size=100').set(bearer(a.OWNER));
    const rows = res.body.data as Row[];
    expect(rows.find((x) => x.action === 'CREATE')?.new_value).toMatchObject({ name: 'Temp team' });
    expect(rows.find((x) => x.action === 'DELETE')?.new_value).toMatchObject({ name: 'Temp team', rcas: 0 });
    expect(rows.find((x) => x.action === 'ROLE_CHANGE')?.new_value).toMatchObject({ workspace_id: ws, user_id: a.VIEWER.id });
    expect(res.body.refs.workspaces[ws]).toBe('Team workspace');
    expect(res.body.refs.users[a.VIEWER.id].email).toBe(a.VIEWER.email);
  });
});
