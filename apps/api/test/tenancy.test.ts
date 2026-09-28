import { beforeAll, describe, expect, it } from 'vitest';
import { buildScope } from '../src/auth/middleware.js';
import { unscoped, withScope } from '../src/tenancy/context.js';
import { TenantScopeError } from '../src/tenancy/prismaScope.js';
import { api, bearer, createRca, createUser, db, raw, resetDb, type Actor } from './helpers.js';

let A: Actor;
let B: Actor;
let admin: Actor;
let rcaA: { id: string };

beforeAll(async () => {
  await resetDb();
  A = await createUser('Alice');
  B = await createUser('Bob');
  admin = await createUser('Operator', { platformAdmin: true });
  rcaA = await createRca(A, A.personalWorkspaceId);
});

const asUser = async <T>(u: Actor, fn: () => PromiseLike<T>) => withScope(await buildScope(u.id, false), fn);

describe('tenant scope extension', () => {
  it('throws for tenant queries outside any scope', async () => {
    await expect(db.rca.findMany()).rejects.toThrow(TenantScopeError);
    await expect(db.rcaAction.count()).rejects.toThrow(TenantScopeError);
    await expect(db.auditLog.findFirst()).rejects.toThrow(TenantScopeError);
  });

  it('unscoped() is an explicit opt-out', async () => {
    expect(await unscoped('test', () => db.rca.count())).toBe(1);
  });

  it('filters every read by the user\'s workspaces, including findUnique by id', async () => {
    expect(await asUser(A, () => db.rca.count())).toBe(1);
    expect(await asUser(B, () => db.rca.count())).toBe(0);
    expect(await asUser(B, () => db.rca.findUnique({ where: { id: rcaA.id } }))).toBeNull();
    expect(await asUser(B, () => db.rcaTeamSection.findMany({ where: { rca_id: rcaA.id } }))).toEqual([]);
    expect(await asUser(B, () => db.rcaWhy.count())).toBe(0);
  });

  it('filters writes: updateMany/deleteMany on another tenant\'s rows affect nothing', async () => {
    const res = await asUser(B, () => db.rca.updateMany({ where: { id: rcaA.id }, data: { summary: 'pwned' } }));
    expect(res.count).toBe(0);
    await expect(asUser(B, () => db.rca.update({ where: { id: rcaA.id }, data: { summary: 'pwned' } }))).rejects.toThrow();
    expect((await raw(() => db.rca.findUniqueOrThrow({ where: { id: rcaA.id } }))).summary).not.toBe('pwned');
  });

  it('rejects creates that attach rows to another tenant\'s data', async () => {
    await expect(asUser(B, () => db.rcaTimeline.create({ data: { rca_id: rcaA.id, event_time: new Date(), event: 'x' } }))).rejects.toThrow(TenantScopeError);
    await expect(
      asUser(B, () => db.rca.create({ data: { workspace_id: A.personalWorkspaceId, rca_number: 'X', rca_date: new Date(), severity: 'P1', environment: 'PROD', incident_start: new Date(), summary: 'x' } })),
    ).rejects.toThrow(TenantScopeError);
  });

  it('forbids reading tenant relations through a user row', async () => {
    await expect(asUser(B, () => db.user.findUnique({ where: { id: A.id }, include: { created_rcas: true } }))).rejects.toThrow(TenantScopeError);
  });
});

describe('platform admin support access', () => {
  it('has no access to RCA content without a grant, read-only access with an active grant', async () => {
    expect((await api().get(`/api/v1/rcas/${rcaA.id}`).set(bearer(admin))).status).toBe(404);
    await raw(() => db.supportGrant.create({ data: { admin_user_id: admin.id, workspace_id: A.personalWorkspaceId, reason: 'ticket #1', expires_at: new Date(Date.now() + 3_600_000) } }));
    const view = await api().get(`/api/v1/rcas/${rcaA.id}`).set(bearer(admin));
    expect(view.status).toBe(200);
    expect(view.body.permissions).toMatchObject({ support: true, edit: false });
    expect((await api().patch(`/api/v1/rcas/${rcaA.id}`).set(bearer(admin)).send({ summary: 'x' })).status).toBe(403);
    expect((await api().get(`/api/v1/rcas/${rcaA.id}/export?format=docx`).set(bearer(admin))).status).toBe(403);
  });

  it('an expired grant gives no access', async () => {
    const other = await createUser('Other');
    const r = await createRca(other, other.personalWorkspaceId);
    await raw(() => db.supportGrant.create({ data: { admin_user_id: admin.id, workspace_id: other.personalWorkspaceId, reason: 'old', expires_at: new Date(Date.now() - 1000) } }));
    expect((await api().get(`/api/v1/rcas/${r.id}`).set(bearer(admin))).status).toBe(404);
  });

  it('a non-admin user with a grant row still gets nothing', async () => {
    await raw(() => db.supportGrant.create({ data: { admin_user_id: B.id, workspace_id: A.personalWorkspaceId, reason: 'x', expires_at: new Date(Date.now() + 3_600_000) } }));
    expect((await api().get(`/api/v1/rcas/${rcaA.id}`).set(bearer(B))).status).toBe(404);
  });
});
