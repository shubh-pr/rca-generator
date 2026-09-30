/**
 * Invitations end to end: visibility in the Share panel and the access overview, acceptance, the
 * resulting edit permissions per role, the audit trail on the RCA/workspace log (owners only), failed
 * acceptance attempts, and the hardened apply() for access that already exists at acceptance time.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { randomToken, sha256 } from '../src/auth/tokens.js';
import { ConsoleEmailProvider, emailProvider, flushEmails } from '../src/email/index.js';
import { api, bearer, createRca, createTeam, createUser, db, fillAndSubmitSection, raw, resetDb, type Actor, type RoleKey } from './helpers.js';

const outbox = () => (emailProvider() as ConsoleEmailProvider).outbox;
async function tokenFor(to: string) {
  await flushEmails();
  const mail = [...outbox()].reverse().find((m) => m.to === to && m.template === 'invitation');
  return /token=([A-Za-z0-9_-]+)/.exec(mail?.text ?? '')?.[1] ?? '';
}

let a: Record<RoleKey, Actor>;
let ws: string;
beforeEach(async () => {
  await resetDb();
  outbox().length = 0;
  ({ a, workspaceId: ws } = await createTeam());
});

const inviteToRca = (rcaId: string, body: object) => api().post(`/api/v1/rcas/${rcaId}/invitations`).set(bearer(a.OWNER)).send(body);
const accept = (who: Actor, token: string) => api().post('/api/v1/invitations/accept').set(bearer(who)).send({ token });
const rcaAudit = async (rcaId: string, who: Actor = a.OWNER) => (await api().get(`/api/v1/rcas/${rcaId}/audit?page_size=100`).set(bearer(who))).body.data as { action: string; entity: string; new_value: Record<string, unknown>; user?: { id: string } }[];

describe('invite → Share panel → accept → permissions', () => {
  it('a pending invitation is listed immediately; after acceptance it leaves pending and appears as a collaborator (Share panel and access overview)', async () => {
    const r = await createRca(a.OWNER, ws);
    const guest = await createUser('Gus Guest', { email: 'gus@x.test' });
    expect((await inviteToRca(r.id, { email: 'gus@x.test', role: 'EDITOR' })).status).toBe(201);

    const pending = await api().get(`/api/v1/rcas/${r.id}/invitations`).set(bearer(a.OWNER));
    expect(pending.body.data).toEqual([expect.objectContaining({ email: 'gus@x.test', role: 'EDITOR' })]);
    const overview = await api().get(`/api/v1/workspaces/${ws}/access`).set(bearer(a.OWNER));
    expect(overview.body.pending).toEqual([expect.objectContaining({ email: 'gus@x.test', role: 'EDITOR', target: { rca_id: r.id, rca_number: r.rca_number } })]);

    expect((await accept(guest, await tokenFor('gus@x.test'))).body.accepted).toBe(true);
    expect((await api().get(`/api/v1/rcas/${r.id}/invitations`).set(bearer(a.OWNER))).body.data).toEqual([]);
    const collabs = await api().get(`/api/v1/rcas/${r.id}/collaborators`).set(bearer(a.OWNER));
    expect(collabs.body.data).toEqual([expect.objectContaining({ email: 'gus@x.test', role: 'EDITOR', team: null, nothing_to_edit: false })]);
    const after = (await api().get(`/api/v1/workspaces/${ws}/access`).set(bearer(a.OWNER))).body;
    expect(after.pending).toEqual([]);
    expect(after.collaborators).toEqual([expect.objectContaining({ email: 'gus@x.test', role: 'EDITOR', rca: expect.objectContaining({ id: r.id, rca_number: r.rca_number }) })]);
    // Workspace members are listed there too; RCA collaborators are not workspace members.
    expect(after.members.map((m: { email: string }) => m.email)).toContain(a.OWNER.email);
    expect(after.members.map((m: { email: string }) => m.email)).not.toContain('gus@x.test');
  });

  it('edit permissions per role: EDITOR everything, CONTRIBUTOR only their team section, VIEWER nothing', async () => {
    const r = await createRca(a.OWNER, ws);
    const people = { EDITOR: await createUser('Ed', { email: 'ed@x.test' }), CONTRIBUTOR: await createUser('Con', { email: 'con@x.test' }), VIEWER: await createUser('Vi', { email: 'vi@x.test' }) };
    await inviteToRca(r.id, { email: 'ed@x.test', role: 'EDITOR' });
    await inviteToRca(r.id, { email: 'con@x.test', role: 'CONTRIBUTOR', team: 'DEV' });
    await inviteToRca(r.id, { email: 'vi@x.test', role: 'VIEWER' });
    for (const [key, who] of Object.entries(people)) expect((await accept(who, await tokenFor(who.email))).status, key).toBe(200);

    const headerEdit = (who: Actor) => api().patch(`/api/v1/rcas/${r.id}`).set(bearer(who)).send({ ticket_id: `T-${who.name}` });
    const sectionEdit = async (who: Actor, team: string) => {
      const v = (await api().get(`/api/v1/rcas/${r.id}/sections/${team}`).set(bearer(a.OWNER))).body.version;
      return api().put(`/api/v1/rcas/${r.id}/sections/${team}`).set(bearer(who)).send({ version: v, escape_analysis: `${who.name} ${team}` });
    };
    expect((await headerEdit(people.EDITOR)).status).toBe(200);
    expect((await sectionEdit(people.EDITOR, 'QA')).status).toBe(200);
    expect((await headerEdit(people.CONTRIBUTOR)).status).toBe(403);
    expect((await sectionEdit(people.CONTRIBUTOR, 'DEV')).status).toBe(200);
    expect((await sectionEdit(people.CONTRIBUTOR, 'QA')).status).toBe(403);
    expect((await headerEdit(people.VIEWER)).status).toBe(403);
    expect((await sectionEdit(people.VIEWER, 'DEV')).status).toBe(403);
    const view = await api().get(`/api/v1/rcas/${r.id}`).set(bearer(people.CONTRIBUTOR));
    expect(view.body.permissions).toMatchObject({ role: 'CONTRIBUTOR', edit: false, edit_section: { DEV: true, QA: false, PROD: false } });
  });

  it('a contributor whose section is submitted has nothing to edit, and the owner sees it (fresh on every read)', async () => {
    const r = await createRca(a.OWNER, ws);
    const con = await createUser('Dora', { email: 'dora@x.test' });
    await inviteToRca(r.id, { email: 'dora@x.test', role: 'CONTRIBUTOR', team: 'DEV' });
    await accept(con, await tokenFor('dora@x.test'));
    const flag = async () => (await api().get(`/api/v1/rcas/${r.id}/collaborators`).set(bearer(a.OWNER))).body.data[0];
    expect(await flag()).toMatchObject({ section_status: 'NOT_STARTED', nothing_to_edit: false });
    await fillAndSubmitSection(a.OWNER, r.id, 'DEV');
    expect(await flag()).toMatchObject({ section_status: 'SUBMITTED', nothing_to_edit: true });
    expect((await api().get(`/api/v1/workspaces/${ws}/access`).set(bearer(a.OWNER))).body.collaborators[0]).toMatchObject({ section_status: 'SUBMITTED', nothing_to_edit: true });
    await api().post(`/api/v1/rcas/${r.id}/sections/DEV/reopen`).set(bearer(a.OWNER)).send({});
    expect(await flag()).toMatchObject({ section_status: 'IN_PROGRESS', nothing_to_edit: false });
  });
});

describe('audit trail of access changes on the RCA and workspace log', () => {
  it('invite sent and accepted (with the team) are on the RCA audit log and the workspace audit log, not only personal security logs', async () => {
    const r = await createRca(a.OWNER, ws);
    const con = await createUser('Cora', { email: 'cora@x.test' });
    const sent = await inviteToRca(r.id, { email: 'cora@x.test', role: 'CONTRIBUTOR', team: 'DEV' });
    await accept(con, await tokenFor('cora@x.test'));

    const rows = await rcaAudit(r.id);
    const invite = rows.find((e) => e.action === 'INVITE');
    const accepted = rows.find((e) => e.action === 'INVITE_ACCEPT');
    expect(invite).toMatchObject({ entity: 'invitations', new_value: { invitation_id: sent.body.id, email: 'cora@x.test', role: 'CONTRIBUTOR', team: 'DEV' }, user: expect.objectContaining({ id: a.OWNER.id }) });
    expect(accepted).toMatchObject({ entity: 'invitations', new_value: { invitation_id: sent.body.id, role: 'CONTRIBUTOR', team: 'DEV' }, user: expect.objectContaining({ id: con.id }) });
    const wsLog = (await api().get(`/api/v1/audit?workspace_id=${ws}&page_size=100`).set(bearer(a.OWNER))).body.data as { action: string; rca?: { id: string } }[];
    expect(wsLog.filter((e) => e.rca?.id === r.id).map((e) => e.action)).toEqual(expect.arrayContaining(['INVITE', 'INVITE_ACCEPT']));
    // Rows carry rca_id and workspace_id (not just the personal security category).
    const stored = await raw(() => db.auditLog.findMany({ where: { entity: 'invitations', rca_id: r.id } }));
    expect(stored.map((s) => [s.action, s.category, s.workspace_id])).toEqual(expect.arrayContaining([['INVITE', 'DATA', ws], ['INVITE_ACCEPT', 'DATA', ws]]));
  });

  it('revoke, role change and removal are recorded; access rows are for owners only', async () => {
    const r = await createRca(a.OWNER, ws);
    const guest = await createUser('Gil', { email: 'gil@x.test' });
    const first = await inviteToRca(r.id, { email: 'someone@x.test', role: 'VIEWER' });
    await api().delete(`/api/v1/rcas/${r.id}/invitations/${first.body.id}`).set(bearer(a.OWNER));
    await inviteToRca(r.id, { email: 'gil@x.test', role: 'VIEWER' });
    await accept(guest, await tokenFor('gil@x.test'));
    await api().patch(`/api/v1/rcas/${r.id}/collaborators/${guest.id}`).set(bearer(a.OWNER)).send({ role: 'CONTRIBUTOR', team: 'QA' });

    // A viewer can read the RCA history, but not who was invited or refused.
    const asViewer = await rcaAudit(r.id, guest);
    expect(asViewer.filter((e) => ['invitations', 'rca_collaborators'].includes(e.entity))).toEqual([]);
    const editorLog = (await api().get(`/api/v1/audit?workspace_id=${ws}&page_size=100`).set(bearer(a.EDITOR))).body.data as { entity: string }[];
    expect(editorLog.filter((e) => ['invitations', 'rca_collaborators', 'workspace_members'].includes(e.entity))).toEqual([]);

    await api().delete(`/api/v1/rcas/${r.id}/collaborators/${guest.id}`).set(bearer(a.OWNER));
    const rows = await rcaAudit(r.id);
    expect(rows.find((e) => e.action === 'INVITE_REVOKE')?.new_value).toMatchObject({ email: 'someone@x.test', role: 'VIEWER' });
    expect(rows.find((e) => e.action === 'ROLE_CHANGE')?.new_value).toMatchObject({ person: { email: 'gil@x.test' }, from: { role: 'VIEWER', team: null }, to: { role: 'CONTRIBUTOR', team: 'QA' } });
    expect(rows.find((e) => e.action === 'MEMBER_REMOVE')?.new_value).toMatchObject({ person: { email: 'gil@x.test' }, role: 'CONTRIBUTOR', team: 'QA' });
  });

  it('failed acceptance attempts are logged with the reason: wrong account, already used, revoked, expired, unknown token', async () => {
    const r = await createRca(a.OWNER, ws);
    const invitee = await createUser('Ivy', { email: 'ivy@x.test' });
    const intruder = await createUser('Mallory', { email: 'mallory@x.test' });
    await inviteToRca(r.id, { email: 'ivy@x.test', role: 'EDITOR' });
    const token = await tokenFor('ivy@x.test');

    expect((await accept(intruder, token)).status).toBe(400); // wrong account
    expect((await accept(invitee, token)).status).toBe(200);
    expect((await accept(invitee, token)).status).toBe(400); // already used

    const revokedInv = await inviteToRca(r.id, { email: 'rev@x.test', role: 'VIEWER' });
    const revToken = await tokenFor('rev@x.test');
    await api().delete(`/api/v1/rcas/${r.id}/invitations/${revokedInv.body.id}`).set(bearer(a.OWNER));
    const rev = await createUser('Rev', { email: 'rev@x.test' });
    expect((await accept(rev, revToken)).status).toBe(400);

    const expInv = await inviteToRca(r.id, { email: 'exp@x.test', role: 'VIEWER' });
    const expToken = await tokenFor('exp@x.test');
    await raw(() => db.invitation.update({ where: { id: expInv.body.id }, data: { expires_at: new Date(Date.now() - 1000) } }));
    const exp = await createUser('Exp', { email: 'exp@x.test' });
    expect((await accept(exp, expToken)).status).toBe(400);

    const failures = (await rcaAudit(r.id)).filter((e) => e.action === 'INVITE_ACCEPT_FAILED').map((e) => [e.new_value.reason, e.new_value.attempted_by_email]);
    expect(failures).toEqual(expect.arrayContaining([['wrong_account', 'mallory@x.test'], ['already_used', 'ivy@x.test'], ['revoked', 'rev@x.test'], ['expired', 'exp@x.test']]));

    // An unknown token belongs to no RCA: only the person trying gets a security event.
    expect((await accept(intruder, 'not-a-real-token-at-all-000000000000')).status).toBe(400);
    const personal = await raw(() => db.auditLog.findMany({ where: { user_id: intruder.id, action: 'INVITE_ACCEPT_FAILED', category: 'SECURITY' } }));
    expect(personal.map((p) => (p.new_value as { reason: string }).reason)).toEqual(expect.arrayContaining(['wrong_account', 'invalid_token']));
  });
});

describe('hardened apply(): access that already exists at acceptance takes the invitation role', () => {
  it('re-inviting someone with access is still refused (409, pointing to the role list)', async () => {
    const r = await createRca(a.OWNER, ws);
    const guest = await createUser('Rhea', { email: 'rhea@x.test' });
    await inviteToRca(r.id, { email: 'rhea@x.test', role: 'VIEWER' });
    await accept(guest, await tokenFor('rhea@x.test'));
    const again = await inviteToRca(r.id, { email: 'rhea@x.test', role: 'EDITOR' });
    expect(again.status).toBe(409);
    expect(again.body.message).toBe('This person already has access. Change their role in the list of people with access instead.');
  });

  it('if access appeared between invitation and acceptance, the invitation role and team are applied (and recorded)', async () => {
    const r = await createRca(a.OWNER, ws);
    const guest = await createUser('Pat', { email: 'pat@x.test' });
    await inviteToRca(r.id, { email: 'pat@x.test', role: 'CONTRIBUTOR', team: 'PROD' });
    // Access created some other way before the person accepts (e.g. a future admin tool).
    await raw(() => db.rcaCollaborator.create({ data: { rca_id: r.id, user_id: guest.id, role: 'VIEWER', team: null } }));
    expect((await accept(guest, await tokenFor('pat@x.test'))).status).toBe(200);
    const c = await raw(() => db.rcaCollaborator.findFirstOrThrow({ where: { rca_id: r.id, user_id: guest.id } }));
    expect(c).toMatchObject({ role: 'CONTRIBUTOR', team: 'PROD' });
    expect((await rcaAudit(r.id)).find((e) => e.action === 'INVITE_ACCEPT')?.new_value).toMatchObject({ role: 'CONTRIBUTOR', team: 'PROD', previous: { role: 'VIEWER', team: null } });
  });

  it('the primary owner is never changed by an invitation', async () => {
    const token = randomToken();
    await raw(() =>
      db.invitation.create({
        data: { email: a.OWNER.email, workspace_id: ws, role: 'VIEWER', team: null, token_hash: sha256(token), invited_by: a.EDITOR.id, expires_at: new Date(Date.now() + 86_400_000) },
      }),
    );
    expect((await accept(a.OWNER, token)).status).toBe(200);
    expect((await raw(() => db.workspaceMember.findFirstOrThrow({ where: { workspace_id: ws, user_id: a.OWNER.id } }))).role).toBe('OWNER');
  });
});
