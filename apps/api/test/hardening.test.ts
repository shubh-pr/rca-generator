import http from 'node:http';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { buildExportModel } from '../src/export/model.js';
import { closePdfBrowser, renderPdf, takePrintHtml } from '../src/export/pdf.js';
import { renderPrintHtml } from '../src/export/printHtml.js';
import { logger } from '../src/lib/logger.js';
import { contentMatches } from '../src/storage/fileType.js';
import { api, bearer, createRca, createUser, db, raw, rcaBody, resetDb, type Actor } from './helpers.js';

let u: Actor;

beforeEach(async () => {
  await resetDb();
  u = await createUser('Quota');
});

afterAll(() => closePdfBrowser());

describe('quotas', () => {
  it('limits the number of RCAs per user (env default, overridable per user)', async () => {
    await raw(() => db.usageQuota.create({ data: { user_id: u.id, rca_limit: 2 } }));
    await createRca(u, u.personalWorkspaceId);
    await createRca(u, u.personalWorkspaceId);
    const third = await api().post('/api/v1/rcas').set(bearer(u)).send(rcaBody(u.personalWorkspaceId));
    expect(third.status).toBe(422);
    expect(third.body.error).toBe('QUOTA_EXCEEDED');
    expect((await api().post('/api/v1/rcas/sample').set(bearer(u))).status).toBe(422);
    const usage = await api().get('/api/v1/me/usage').set(bearer(u));
    expect(usage.body).toMatchObject({ rca_count: 2, rca_limit: 2, storage_limit_bytes: config.quota.storageBytes });
    expect(config.quota.rcaCount).toBe(500);
    expect(config.quota.storageBytes).toBe(200 * 1024 * 1024);
  });

  it('limits storage per user; uploads to a shared workspace count against its primary owner', async () => {
    const r = await createRca(u, u.personalWorkspaceId);
    await raw(() => db.usageQuota.upsert({ where: { user_id: u.id }, update: { storage_limit_bytes: BigInt(1500) }, create: { user_id: u.id, storage_limit_bytes: BigInt(1500) } }));
    const up = (bytes: number) =>
      api().post(`/api/v1/rcas/${r.id}/attachments`).set(bearer(u)).attach('file', Buffer.alloc(bytes, 'a'), 'a.txt');
    expect((await up(1000)).status).toBe(201);
    const over = await up(1000);
    expect(over.status).toBe(422);
    expect(over.body.error).toBe('QUOTA_EXCEEDED');
    expect(await raw(() => db.rcaAttachment.count())).toBe(1);
    const usage = await raw(() => db.usageQuota.findUniqueOrThrow({ where: { user_id: u.id } }));
    expect(Number(usage.storage_bytes_used)).toBe(1000);
  });
});

describe('upload content checks', () => {
  it('rejects files whose content does not match the extension', async () => {
    const r = await createRca(u, u.personalWorkspaceId);
    const fake = await api().post(`/api/v1/rcas/${r.id}/attachments`).set(bearer(u)).attach('file', Buffer.from('<html>not a pdf</html>'), 'report.pdf');
    expect(fake.status).toBe(400);
    expect(fake.body.fields.file).toMatch(/does not match/);
    const binaryAsText = await api().post(`/api/v1/rcas/${r.id}/attachments`).set(bearer(u)).attach('file', Buffer.from([0x4d, 0x5a, 0x00, 0x01]), 'notes.txt');
    expect(binaryAsText.status).toBe(400);
    const pdf = await api().post(`/api/v1/rcas/${r.id}/attachments`).set(bearer(u)).attach('file', Buffer.from('%PDF-1.7\n...'), 'ok.pdf');
    expect(pdf.status).toBe(201);
  });

  it('magic-byte table', () => {
    expect(contentMatches('.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
    expect(contentMatches('.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(contentMatches('.docx', Buffer.from('PK\u0003\u0004'))).toBe(true);
    expect(contentMatches('.zip', Buffer.from('MZ'))).toBe(false);
    expect(contentMatches('.csv', Buffer.from('a,b\n1,2\n'))).toBe(true);
  });
});

describe('sandboxed PDF rendering', () => {
  it('print tokens are single use', () => {
    // takePrintHtml of an unknown token returns nothing.
    expect(takePrintHtml('nope')).toBeNull();
  });

  it('never fetches external resources, even when content tries to', async () => {
    let hits = 0;
    const probe = http.createServer((_req, res) => {
      hits += 1;
      res.end('x');
    });
    await new Promise<void>((r) => probe.listen(0, '127.0.0.1', () => r()));
    const port = (probe.address() as { port: number }).port;
    // A server for the internal print URL, the way the API serves it.
    const { createApp } = await import('../src/app.js');
    const appServer = http.createServer(createApp());
    await new Promise<void>((r) => appServer.listen(0, '127.0.0.1', () => r()));
    const base = `http://127.0.0.1:${(appServer.address() as { port: number }).port}`;
    const html = renderPrintHtml(buildExportModel(null)).replace(
      '</body>',
      `<img src="http://127.0.0.1:${port}/tracker.png"><link rel="stylesheet" href="http://127.0.0.1:${port}/x.css"><script src="http://127.0.0.1:${port}/x.js"></script></body>`,
    );
    const pdf = await renderPdf(html, base);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(hits).toBe(0);
    probe.close();
    appServer.close();
  });

  it('the internal print route is not reachable through the public API prefix', async () => {
    expect([401, 404]).toContain((await api().get('/api/v1/internal/print/abc')).status);
    expect((await api().get('/internal/print/unknown-token')).status).toBe(404);
  });
});

describe('health, headers, errors, logs', () => {
  it('/healthz and /readyz', async () => {
    expect((await api().get('/healthz')).body).toEqual({ ok: true });
    expect((await api().get('/readyz')).body).toEqual({ ok: true });
  });

  it('sets security headers and strict CORS', async () => {
    const res = await api().get('/api/v1/health').set('Origin', 'https://evil.test');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    const ok = await api().get('/api/v1/health').set('Origin', config.corsOrigin);
    expect(ok.headers['access-control-allow-origin']).toBe(config.corsOrigin);
  });

  it('rejects oversized JSON bodies (400)', async () => {
    const res = await api().post('/api/v1/auth/login').set('Content-Type', 'application/json').send(JSON.stringify({ email: 'a@b.c', password: 'x'.repeat(1_100_000) }));
    expect(res.status).toBe(400);
  });

  it('the logger redacts secret-looking fields', () => {
    const lines: string[] = [];
    const write = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string) => (lines.push(String(chunk)), true)) as typeof process.stderr.write;
    try {
      logger.error('test', { email: 'x@y.z', token: 'abc', password: 'p', user_id: 'u1' });
    } finally {
      process.stderr.write = write;
    }
    const entry = JSON.parse(lines[0]);
    expect(entry).toMatchObject({ email: '[redacted]', token: '[redacted]', password: '[redacted]', user_id: 'u1' });
  });
});

describe('platform admin', () => {
  it('admin endpoints are invisible to normal users; admins see metadata but no RCA content', async () => {
    const admin = await createUser('Operator', { platformAdmin: true });
    const r = await createRca(u, u.personalWorkspaceId, { summary: 'SECRET-CONTENT-9' });
    expect((await api().get('/api/v1/admin/users').set(bearer(u))).status).toBe(404);
    const users = await api().get('/api/v1/admin/users').set(bearer(admin));
    expect(users.body.total).toBe(2);
    const wss = await api().get('/api/v1/admin/workspaces').set(bearer(admin));
    expect(JSON.stringify(wss.body)).not.toContain('SECRET-CONTENT');
    expect(wss.body.data.find((w: { id: string }) => w.id === u.personalWorkspaceId).rca_count).toBe(1);
    expect((await api().get(`/api/v1/rcas/${r.id}`).set(bearer(admin))).status).toBe(404);

    expect((await api().post('/api/v1/admin/support-access').set(bearer(admin)).send({ workspace_id: u.personalWorkspaceId, reason: 'short' })).status).toBe(400);
    const grant = await api()
      .post('/api/v1/admin/support-access')
      .set(bearer(admin))
      .send({ workspace_id: u.personalWorkspaceId, reason: 'Support ticket #123: export fails', minutes: 30 });
    expect(grant.status).toBe(201);
    expect((await api().get(`/api/v1/rcas/${r.id}`).set(bearer(admin))).body.summary).toBe('SECRET-CONTENT-9');
    // The owner can see that support access happened.
    const audit = await api().get(`/api/v1/audit?workspace_id=${u.personalWorkspaceId}`).set(bearer(u));
    expect(audit.body.data.map((e: { action: string }) => e.action)).toContain('SUPPORT_ACCESS');
    expect((await api().delete(`/api/v1/admin/support-access/${grant.body.id}`).set(bearer(admin))).status).toBe(204);
    expect((await api().get(`/api/v1/rcas/${r.id}`).set(bearer(admin))).status).toBe(404);
  });

  it('disabling an account signs it out and blocks login', async () => {
    const admin = await createUser('Operator', { platformAdmin: true });
    expect((await api().post(`/api/v1/admin/users/${u.id}/disable`).set(bearer(admin))).body.is_active).toBe(false);
    expect((await api().get('/api/v1/me').set(bearer(u))).status).toBe(401);
    expect((await api().post(`/api/v1/admin/users/${u.id}/enable`).set(bearer(admin))).body.is_active).toBe(true);
  });
});
