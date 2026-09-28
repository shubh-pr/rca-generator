import { beforeEach, describe, expect, it } from 'vitest';
import { api, bearer, createActors, createProject, createRca, prisma, resetDb, type Actor, type RoleKey } from './helpers.js';

let a: Record<RoleKey, Actor>;
let rcaId: string;
const u = (s = '') => `/api/v1/rcas/${rcaId}/attachments${s}`;

beforeEach(async () => {
  await resetDb();
  a = await createActors();
  const { project } = await createProject(a.PROJECT_OWNER.id);
  rcaId = (await createRca(a.RCA_LEAD, project.id, a.RCA_LEAD.id)).id;
});

describe('attachments', () => {
  it('uploads an allowed file with a random storage name and downloads it', async () => {
    const res = await api()
      .post(u())
      .set(bearer(a.DEV))
      .field('description', 'Error log')
      .attach('file', Buffer.from('line 1\nline 2\n'), 'server.log');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ kind: 'FILE', file_name: 'server.log', mime: 'text/plain', size: 14, description: 'Error log' });
    expect(res.body.file_path).toBeUndefined();
    const row = await prisma.rcaAttachment.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.file_path).not.toContain('server');
    expect(row.file_path).toMatch(/^[0-9a-f-]{36}\.log$/);

    const dl = await api().get(u(`/${res.body.id}/download`)).set(bearer(a.VIEWER));
    expect(dl.status).toBe(200);
    expect(dl.headers['content-disposition']).toContain('attachment');
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    expect(dl.text).toBe('line 1\nline 2\n');
  });

  it('rejects disallowed types and files over 10 MB (400); Viewer gets 403', async () => {
    const exe = await api().post(u()).set(bearer(a.DEV)).attach('file', Buffer.from('MZ'), 'evil.exe');
    expect(exe.status).toBe(400);
    expect(exe.body.fields.file).toContain('not allowed');
    const big = await api().post(u()).set(bearer(a.DEV)).attach('file', Buffer.alloc(10 * 1024 * 1024 + 1), 'big.zip');
    expect(big.status).toBe(400);
    expect(big.body.fields.file).toContain('10 MB');
    expect((await api().post(u()).set(bearer(a.VIEWER)).attach('file', Buffer.from('x'), 'a.txt')).status).toBe(403);
    expect(await prisma.rcaAttachment.count()).toBe(0);
  });

  it('adds links (http/https only)', async () => {
    const ok = await api().post(u()).set(bearer(a.QA)).send({ kind: 'LINK', url: 'https://grafana.local/d/abc', description: 'Dashboard' });
    expect(ok.status).toBe(201);
    expect(ok.body.kind).toBe('LINK');
    expect((await api().post(u()).set(bearer(a.QA)).send({ kind: 'LINK', url: 'javascript:alert(1)' })).status).toBe(400);
    expect((await api().get(u(`/${ok.body.id}/download`)).set(bearer(a.QA))).status).toBe(404);
  });

  it('only uploader, Lead or Admin can delete', async () => {
    const res = await api().post(u()).set(bearer(a.DEV)).attach('file', Buffer.from('x'), 'a.txt');
    expect((await api().delete(u(`/${res.body.id}`)).set(bearer(a.QA))).status).toBe(403);
    expect((await api().delete(u(`/${res.body.id}`)).set(bearer(a.PROJECT_OWNER))).status).toBe(403);
    expect((await api().delete(u(`/${res.body.id}`)).set(bearer(a.DEV))).status).toBe(204);
    const r2 = await api().post(u()).set(bearer(a.DEV)).attach('file', Buffer.from('x'), 'b.txt');
    expect((await api().delete(u(`/${r2.body.id}`)).set(bearer(a.RCA_LEAD))).status).toBe(204);
    const audit = await prisma.auditLog.findMany({ where: { entity: 'rca_attachment' } });
    expect(audit.map((x) => x.action).sort()).toEqual(['CREATE', 'CREATE', 'DELETE', 'DELETE']);
  });
});
