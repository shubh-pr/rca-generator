import JSZip from 'jszip';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closePdfBrowser } from '../src/export/pdf.js';
import { purgeDueAccounts } from '../src/services/lifecycle.js';
import { storage } from '../src/storage/index.js';
import { addMember, api, bearer, createRca, createUser, db, PASSWORD, raw, resetDb, subscribe, type Actor } from './helpers.js';

const binary = (res: import('superagent').Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

let u: Actor;

beforeEach(async () => {
  await resetDb();
  u = await createUser('Leaving User');
});

afterAll(() => closePdfBrowser());

async function deleteMe(actor: Actor, body: object = { password: PASSWORD, confirm: 'DELETE' }) {
  return api().delete('/api/v1/me').set(bearer(actor)).send(body);
}

describe('account deletion', () => {
  it('needs the password and the typed confirmation', async () => {
    expect((await deleteMe(u, { confirm: 'DELETE' })).body.fields.password).toBeDefined();
    expect((await deleteMe(u, { password: 'wrong', confirm: 'DELETE' })).status).toBe(400);
    expect((await deleteMe(u, { password: PASSWORD, confirm: 'yes' })).body.fields.confirm).toBeDefined();
  });

  it('soft delete blocks login immediately and schedules the purge after the grace period', async () => {
    const res = await deleteMe(u);
    expect(res.status).toBe(200);
    const days = (new Date(res.body.purge_after).getTime() - Date.now()) / 86_400_000;
    expect(Math.round(days)).toBe(14);
    expect((await api().get('/api/v1/me').set(bearer(u))).status).toBe(401);
    expect((await api().post('/api/v1/auth/login').send({ email: u.email, password: PASSWORD })).status).toBe(401);
    // Nothing is erased before the grace period ends.
    expect((await purgeDueAccounts()).purged).toBe(0);
    expect(await raw(() => db.user.count({ where: { id: u.id } }))).toBe(1);
    const events = await raw(() => db.auditLog.findMany({ where: { category: 'SECURITY', user_id: u.id } }));
    expect(events.map((e) => e.action)).toContain('ACCOUNT_DELETE');
  });

  it('is blocked while the user is the only owner of a shared workspace with other members', async () => {
    const colleague = await createUser('Colleague');
    const ws = await api().post('/api/v1/workspaces').set(bearer(u)).send({ name: 'Team' });
    await addMember(ws.body.id, colleague, 'EDITOR');
    const check = await api().get('/api/v1/me/deletion-check').set(bearer(u));
    expect(check.body.blocking_workspaces).toEqual([{ id: ws.body.id, name: 'Team' }]);
    const blocked = await deleteMe(u);
    expect(blocked.status).toBe(409);
    expect(blocked.body.details.workspaces[0].name).toBe('Team');
    // After transferring ownership the account can go.
    await api().post(`/api/v1/workspaces/${ws.body.id}/transfer`).set(bearer(u)).send({ user_id: colleague.id });
    expect((await deleteMe(u)).status).toBe(200);
  });

  it('a co-owned workspace is handed to the other owner', async () => {
    const co = await createUser('Co Owner');
    const ws = await api().post('/api/v1/workspaces').set(bearer(u)).send({ name: 'Shared' });
    await addMember(ws.body.id, co, 'OWNER');
    expect((await deleteMe(u)).status).toBe(200);
    expect((await raw(() => db.workspace.findUniqueOrThrow({ where: { id: ws.body.id } }))).owner_id).toBe(co.id);
  });

  it('after the grace period the purge erases personal data and files; other tenants keep working, anonymised', async () => {
    const other = await createUser('Other Owner');
    const own = await createRca(u, u.personalWorkspaceId, { summary: 'MY-PRIVATE-RCA' });
    const upload = await api().post(`/api/v1/rcas/${own.id}/attachments`).set(bearer(u)).attach('file', Buffer.from('mine'), 'mine.txt');
    const key = (await raw(() => db.rcaAttachment.findUniqueOrThrow({ where: { id: upload.body.id } }))).file_path!;
    // u also contributes to someone else's workspace (collaboration needs the owner's Team plan).
    await addMember(other.personalWorkspaceId, u, 'EDITOR');
    await subscribe(other.personalWorkspaceId, 'TEAM', 3);
    const theirs = await createRca(other, other.personalWorkspaceId);
    const action = await api()
      .post(`/api/v1/rcas/${theirs.id}/sections/DEV/actions`)
      .set(bearer(u))
      .send({ action: 'Fix', owner_id: u.id, due_date: '2026-12-01' });
    expect(action.status).toBe(201);
    await api().patch(`/api/v1/rcas/${theirs.id}`).set(bearer(u)).send({ impact_users: 'edited by the leaving user' });

    expect((await deleteMe(u)).status).toBe(200);
    await raw(() => db.user.update({ where: { id: u.id }, data: { purge_after: new Date(Date.now() - 1000) } }));
    expect(await purgeDueAccounts()).toMatchObject({ purged: 1 });

    expect(await raw(() => db.user.count({ where: { id: u.id } }))).toBe(0);
    expect(await raw(() => db.rca.count({ where: { id: own.id } }))).toBe(0);
    expect(await raw(() => db.workspace.count({ where: { id: u.personalWorkspaceId } }))).toBe(0);
    await expect(storage().get(key)).rejects.toThrow();
    expect(await raw(() => db.auditLog.count({ where: { OR: [{ user_id: u.id }, { workspace_id: u.personalWorkspaceId }] } }))).toBe(0);
    // The other tenant's RCA is intact; the action now belongs to that workspace's owner.
    const rca = await api().get(`/api/v1/rcas/${theirs.id}`).set(bearer(other));
    expect(rca.status).toBe(200);
    expect(rca.body.sections[0].actions[0].owner.id).toBe(other.id);
    const history = await api().get(`/api/v1/rcas/${theirs.id}/audit?page_size=100`).set(bearer(other));
    expect(history.body.data.some((e: { user: unknown; action: string }) => e.action === 'UPDATE' && e.user === null)).toBe(true);
  });
});

describe('data export', () => {
  it('downloads a zip with account, security log, RCA JSON + PDF and own uploads only', async () => {
    const other = await createUser('Stranger');
    await createRca(other, other.personalWorkspaceId, { summary: 'STRANGER-SECRET' });
    const r = await createRca(u, u.personalWorkspaceId, { summary: 'MY-EXPORTED-RCA' });
    await api().post(`/api/v1/rcas/${r.id}/attachments`).set(bearer(u)).attach('file', Buffer.from('export me'), 'notes.txt');
    const res = await api().get('/api/v1/me/export').set(bearer(u)).buffer(true).parse(binary);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/zip');
    const zip = await JSZip.loadAsync(res.body as Buffer);
    const names = Object.keys(zip.files);
    expect(names).toEqual(expect.arrayContaining(['README.txt', 'account.json', 'security-log.json']));
    const rcaJson = names.find((n) => n.endsWith('RCA-2026-0001.json'))!;
    expect(await zip.file(rcaJson)!.async('string')).toContain('MY-EXPORTED-RCA');
    const pdf = await zip.file(rcaJson.replace('.json', '.pdf'))!.async('nodebuffer');
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const upload = names.find((n) => n.startsWith('uploads/') && n.endsWith('notes.txt'))!;
    expect(await zip.file(upload)!.async('string')).toBe('export me');
    const account = JSON.parse(await zip.file('account.json')!.async('string'));
    expect(account.user.email).toBe(u.email);
    expect(JSON.stringify(account)).not.toMatch(/password_hash|argon2/);
    let all = '';
    for (const n of names) if (!n.endsWith('.pdf')) all += await zip.file(n)!.async('string');
    expect(all).not.toContain('STRANGER-SECRET');
    const events = await api().get('/api/v1/me/security-events').set(bearer(u));
    expect(events.body.data.map((e: { action: string }) => e.action)).toContain('DATA_EXPORT');
  });
});

describe('security log', () => {
  it('shows only the user\'s own security events', async () => {
    const other = await createUser('Someone');
    await api().post('/api/v1/auth/login').send({ email: u.email, password: PASSWORD });
    await api().post('/api/v1/auth/login').send({ email: other.email, password: 'wrong-password-1' });
    const mine = await api().get('/api/v1/me/security-events').set(bearer(u));
    expect(mine.body.data.map((e: { action: string }) => e.action)).toEqual(['LOGIN']);
    const theirs = await api().get('/api/v1/me/security-events').set(bearer(other));
    expect(theirs.body.data.map((e: { action: string }) => e.action)).toEqual(['LOGIN_FAILED']);
  });
});
