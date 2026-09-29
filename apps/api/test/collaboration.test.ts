import { beforeEach, describe, expect, it } from 'vitest';
import { ConsoleEmailProvider, emailProvider, flushEmails } from '../src/email/index.js';
import { api, bearer, createRca, createTeam, createUser, db, PASSWORD, raw, resetDb, type Actor, type RoleKey } from './helpers.js';

const outbox = () => (emailProvider() as ConsoleEmailProvider).outbox;
const inviteToken = async (to: string) => {
  await flushEmails();
  const mail = [...outbox()].reverse().find((m) => m.to === to && m.template === 'invitation');
  return { mail, token: /token=([A-Za-z0-9_-]+)/.exec(mail?.text ?? '')?.[1] ?? '' };
};

let a: Record<RoleKey, Actor>;
let ws: string;

beforeEach(async () => {
  await resetDb();
  outbox().length = 0;
  ({ a, workspaceId: ws } = await createTeam());
});

describe('workspace invitations', () => {
  it('owner invites an existing user; the email has no RCA content; accepting adds the member', async () => {
    const secret = await createRca(a.OWNER, ws, { summary: 'TOP-SECRET-OUTAGE', project_name: 'Hidden Project' });
    const guest = await createUser('Guest', { email: 'guest@x.test' });
    for (const k of ['EDITOR', 'DEV', 'VIEWER'] as RoleKey[]) {
      expect((await api().post(`/api/v1/workspaces/${ws}/invitations`).set(bearer(a[k])).send({ email: 'guest@x.test', role: 'VIEWER' })).status).toBe(403);
    }
    expect((await api().post(`/api/v1/workspaces/${ws}/invitations`).set(bearer(a.OUTSIDER)).send({ email: 'guest@x.test', role: 'VIEWER' })).status).toBe(404);
    const inv = await api().post(`/api/v1/workspaces/${ws}/invitations`).set(bearer(a.OWNER)).send({ email: 'Guest@X.test', role: 'EDITOR' });
    expect(inv.status).toBe(201);
    const { mail, token } = await inviteToken('guest@x.test');
    expect(mail!.text).toContain('as editor');
    expect(mail!.text + mail!.html).not.toMatch(/TOP-SECRET|Hidden Project|Team workspace/);

    const lookup = await api().get(`/api/v1/invitations/lookup?token=${token}`);
    expect(lookup.body).toMatchObject({ target: 'workspace', role: 'EDITOR', inviter_name: a.OWNER.name, has_account: true, email: 'gu•••@x.test' });
    expect(JSON.stringify(lookup.body)).not.toMatch(/Team workspace|TOP-SECRET/);

    expect((await api().get(`/api/v1/rcas/${secret.id}`).set(bearer(guest))).status).toBe(404);
    const acc = await api().post('/api/v1/invitations/accept').set(bearer(guest)).send({ token });
    expect(acc.body).toMatchObject({ accepted: true, workspace_id: ws });
    expect((await api().get(`/api/v1/rcas/${secret.id}`).set(bearer(guest))).body.permissions.role).toBe('EDITOR');
    // Single use.
    expect((await api().post('/api/v1/invitations/accept').set(bearer(guest)).send({ token })).status).toBe(400);
    expect((await api().get(`/api/v1/invitations/lookup?token=${token}`)).status).toBe(404);
  });

  it('an invitation only works for the invited email, before it expires, and unless revoked', async () => {
    await api().post(`/api/v1/workspaces/${ws}/invitations`).set(bearer(a.OWNER)).send({ email: 'target@x.test', role: 'VIEWER' });
    const { token } = await inviteToken('target@x.test');
    const wrong = await api().post('/api/v1/invitations/accept').set(bearer(a.OUTSIDER)).send({ token });
    expect(wrong.status).toBe(400);
    expect(wrong.body.fields.token).toMatch(/different email/);

    const target = await createUser('Target', { email: 'target@x.test' });
    await raw(() => db.invitation.updateMany({ data: { expires_at: new Date(Date.now() - 1000) } }));
    expect((await api().post('/api/v1/invitations/accept').set(bearer(target)).send({ token })).status).toBe(400);

    const again = await api().post(`/api/v1/workspaces/${ws}/invitations`).set(bearer(a.OWNER)).send({ email: 'target@x.test', role: 'VIEWER' });
    const { token: t2 } = await inviteToken('target@x.test');
    const list = await api().get(`/api/v1/workspaces/${ws}/invitations`).set(bearer(a.OWNER));
    expect(list.body.data.map((i: { id: string }) => i.id)).toEqual([again.body.id]);
    expect((await api().delete(`/api/v1/workspaces/${ws}/invitations/${again.body.id}`).set(bearer(a.OWNER))).status).toBe(204);
    expect((await api().post('/api/v1/invitations/accept').set(bearer(target)).send({ token: t2 })).status).toBe(400);
  });

  it('new users: sign up with the invited email, verify, and the invitation is applied automatically', async () => {
    await api().post(`/api/v1/workspaces/${ws}/invitations`).set(bearer(a.OWNER)).send({ email: 'fresh@x.test', role: 'CONTRIBUTOR', team: 'QA' });
    const { token } = await inviteToken('fresh@x.test');
    expect((await api().get(`/api/v1/invitations/lookup?token=${token}`)).body.has_account).toBe(false);
    await api().post('/api/v1/auth/signup').send({ name: 'Fresh', email: 'fresh@x.test', password: 'Tidal-Harbour-88', accept_terms: true });
    await flushEmails();
    const verify = [...outbox()].reverse().find((m) => m.to === 'fresh@x.test' && m.template === 'verify-email')!;
    const vtoken = /token=([A-Za-z0-9_-]+)/.exec(verify.text)![1];
    expect((await api().post('/api/v1/auth/verify-email').send({ token: vtoken })).body).toMatchObject({ verified: true, invitations_accepted: 1 });
    const user = await raw(() => db.user.findUniqueOrThrow({ where: { email: 'fresh@x.test' } }));
    const m = await raw(() => db.workspaceMember.findFirstOrThrow({ where: { workspace_id: ws, user_id: user.id } }));
    expect(m).toMatchObject({ role: 'CONTRIBUTOR', team: 'QA' });
  });

  it('refuses to invite someone who already has access (409) and validates role/team', async () => {
    expect((await api().post(`/api/v1/workspaces/${ws}/invitations`).set(bearer(a.OWNER)).send({ email: a.DEV.email, role: 'VIEWER' })).status).toBe(409);
    expect((await api().post(`/api/v1/workspaces/${ws}/invitations`).set(bearer(a.OWNER)).send({ email: 'z@x.test', role: 'VIEWER', team: 'DEV' })).body.fields.team).toBeDefined();
    expect((await api().post(`/api/v1/workspaces/${ws}/invitations`).set(bearer(a.OWNER)).send({ email: 'z@x.test', role: 'BOSS' })).status).toBe(400);
  });
});

describe('RCA collaborators (per-RCA team assignment)', () => {
  it('invite a DEV contributor to one RCA: they see it read-only and edit only Dev; nothing else in the workspace', async () => {
    const r = await createRca(a.OWNER, ws);
    const other = await createRca(a.OWNER, ws);
    const guest = await createUser('Guest Dev', { email: 'gdev@x.test' });
    expect((await api().post(`/api/v1/rcas/${r.id}/invitations`).set(bearer(a.OWNER)).send({ email: 'gdev@x.test', role: 'CONTRIBUTOR' })).body.fields.team).toBeDefined();
    expect((await api().post(`/api/v1/rcas/${r.id}/invitations`).set(bearer(a.EDITOR)).send({ email: 'gdev@x.test', role: 'CONTRIBUTOR', team: 'DEV' })).status).toBe(403);
    const inv = await api().post(`/api/v1/rcas/${r.id}/invitations`).set(bearer(a.OWNER)).send({ email: 'gdev@x.test', role: 'CONTRIBUTOR', team: 'DEV' });
    expect(inv.status).toBe(201);
    const { token } = await inviteToken('gdev@x.test');
    expect((await api().get(`/api/v1/invitations/lookup?token=${token}`)).body).toMatchObject({ target: 'rca', role: 'CONTRIBUTOR', team: 'DEV' });
    expect((await api().post('/api/v1/invitations/accept').set(bearer(guest)).send({ token })).body.rca_id).toBe(r.id);

    const view = await api().get(`/api/v1/rcas/${r.id}`).set(bearer(guest));
    expect(view.body.permissions).toMatchObject({ role: 'CONTRIBUTOR', edit: false, edit_section: { DEV: true, QA: false, PROD: false } });
    expect((await api().put(`/api/v1/rcas/${r.id}/sections/DEV`).set(bearer(guest)).send({ version: 1, extra_1: 'guest' })).status).toBe(200);
    expect((await api().put(`/api/v1/rcas/${r.id}/sections/QA`).set(bearer(guest)).send({ version: 1, extra_1: 'guest' })).status).toBe(403);
    expect((await api().patch(`/api/v1/rcas/${r.id}`).set(bearer(guest)).send({ summary: 'x' })).status).toBe(403);
    expect((await api().get(`/api/v1/rcas/${other.id}`).set(bearer(guest))).status).toBe(404);
    expect((await api().get('/api/v1/rcas').set(bearer(guest))).body.total).toBe(1);
    expect((await api().get(`/api/v1/workspaces/${ws}/members`).set(bearer(guest))).status).toBe(404);

    const collabs = await api().get(`/api/v1/rcas/${r.id}/collaborators`).set(bearer(a.VIEWER));
    expect(collabs.body.data).toEqual([expect.objectContaining({ user_id: guest.id, role: 'CONTRIBUTOR', team: 'DEV' })]);
    const participants = await api().get(`/api/v1/rcas/${r.id}/participants`).set(bearer(a.OWNER));
    expect(participants.body.data.map((p: { id: string }) => p.id)).toContain(guest.id);

    expect((await api().patch(`/api/v1/rcas/${r.id}/collaborators/${guest.id}`).set(bearer(a.OWNER)).send({ role: 'CONTRIBUTOR', team: 'QA' })).body.team).toBe('QA');
    expect((await api().put(`/api/v1/rcas/${r.id}/sections/QA`).set(bearer(guest)).send({ version: 1, extra_1: 'guest' })).status).toBe(200);
    expect((await api().delete(`/api/v1/rcas/${r.id}/collaborators/${guest.id}`).set(bearer(a.OWNER))).status).toBe(204);
    expect((await api().get(`/api/v1/rcas/${r.id}`).set(bearer(guest))).status).toBe(404);
  });
});

describe('workspace members', () => {
  it('lists members; owners change roles; the last owner and the primary owner are protected', async () => {
    const list = await api().get(`/api/v1/workspaces/${ws}/members`).set(bearer(a.VIEWER));
    expect(list.body.data).toHaveLength(6);
    expect(list.body.data.find((m: { user_id: string }) => m.user_id === a.OWNER.id).is_primary_owner).toBe(true);
    expect((await api().patch(`/api/v1/workspaces/${ws}/members/${a.VIEWER.id}`).set(bearer(a.EDITOR)).send({ role: 'EDITOR' })).status).toBe(403);
    expect((await api().patch(`/api/v1/workspaces/${ws}/members/${a.VIEWER.id}`).set(bearer(a.OWNER)).send({ role: 'CONTRIBUTOR', team: 'PROD' })).body).toMatchObject({ role: 'CONTRIBUTOR', team: 'PROD' });
    expect((await api().patch(`/api/v1/workspaces/${ws}/members/${a.OWNER.id}`).set(bearer(a.OWNER)).send({ role: 'EDITOR' })).status).toBe(409);
    expect((await api().delete(`/api/v1/workspaces/${ws}/members/${a.OWNER.id}`).set(bearer(a.OWNER))).status).toBe(409);
  });

  it('members can leave; owners can remove; removed members lose access', async () => {
    const r = await createRca(a.OWNER, ws);
    expect((await api().delete(`/api/v1/workspaces/${ws}/members/${a.QA.id}`).set(bearer(a.DEV))).status).toBe(403);
    expect((await api().delete(`/api/v1/workspaces/${ws}/members/${a.DEV.id}`).set(bearer(a.DEV))).status).toBe(204);
    expect((await api().get(`/api/v1/rcas/${r.id}`).set(bearer(a.DEV))).status).toBe(404);
    expect((await api().delete(`/api/v1/workspaces/${ws}/members/${a.QA.id}`).set(bearer(a.OWNER))).status).toBe(204);
    expect((await api().get(`/api/v1/rcas/${r.id}`).set(bearer(a.QA))).status).toBe(404);
  });

  it('the primary owner can transfer ownership to a member', async () => {
    expect((await api().post(`/api/v1/workspaces/${ws}/transfer`).set(bearer(a.OWNER)).send({ user_id: a.OUTSIDER.id })).status).toBe(400);
    const t = await api().post(`/api/v1/workspaces/${ws}/transfer`).set(bearer(a.OWNER)).send({ user_id: a.EDITOR.id });
    expect(t.body.owner_id).toBe(a.EDITOR.id);
    expect((await api().get(`/api/v1/workspaces/${ws}/members`).set(bearer(a.OWNER))).body.data.find((m: { user_id: string }) => m.user_id === a.EDITOR.id).role).toBe('OWNER');
    // The old primary owner can now be removed by the new one.
    expect((await api().delete(`/api/v1/workspaces/${ws}/members/${a.OWNER.id}`).set(bearer(a.EDITOR))).status).toBe(204);
  });

  it('create, rename and delete (with typed confirmation) a shared workspace', async () => {
    const created = await api().post('/api/v1/workspaces').set(bearer(a.OUTSIDER)).send({ name: 'Side project' });
    expect(created.body).toMatchObject({ name: 'Side project', role: 'OWNER', is_personal: false });
    const wid = created.body.id;
    await createRca(a.OUTSIDER, wid);
    expect((await api().patch(`/api/v1/workspaces/${wid}`).set(bearer(a.OUTSIDER)).send({ name: 'Side project 2' })).body.name).toBe('Side project 2');
    expect((await api().delete(`/api/v1/workspaces/${wid}`).set(bearer(a.OUTSIDER)).send({ confirm_name: 'nope' })).status).toBe(400);
    expect((await api().delete(`/api/v1/workspaces/${a.OUTSIDER.personalWorkspaceId}`).set(bearer(a.OUTSIDER)).send({ confirm_name: "Outsider User's workspace" })).status).toBe(400);
    expect((await api().delete(`/api/v1/workspaces/${wid}`).set(bearer(a.OUTSIDER)).send({ confirm_name: 'Side project 2' })).status).toBe(204);
    expect(await raw(() => db.rca.count({ where: { workspace_id: wid } }))).toBe(0);
    expect(await raw(() => db.auditLog.count({ where: { workspace_id: wid } }))).toBe(0);
  });

  it('logs invitation and membership security events for the acting user', async () => {
    await api().post(`/api/v1/workspaces/${ws}/invitations`).set(bearer(a.OWNER)).send({ email: 'evt@x.test', role: 'VIEWER' });
    await api().delete(`/api/v1/workspaces/${ws}/members/${a.VIEWER.id}`).set(bearer(a.OWNER));
    const events = await raw(() => db.auditLog.findMany({ where: { category: 'SECURITY', user_id: a.OWNER.id }, orderBy: { at: 'asc' } }));
    expect(events.map((e) => e.action)).toEqual(['INVITE', 'MEMBER_REMOVE']);
    expect(PASSWORD).toBeTruthy();
  });
});
