import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, bearer, createActors, prisma, resetDb, ROLE_KEYS, type Actor, type RoleKey } from './helpers.js';

let a: Record<RoleKey, Actor>;

beforeAll(async () => {
  await resetDb();
  a = await createActors();
});

const NON_ADMIN = ROLE_KEYS.filter((r) => r !== 'ADMIN');

describe('masters: permissions', () => {
  it.each(NON_ADMIN)('%s gets 403 creating users, companies and projects', async (role) => {
    const h = bearer(a[role]);
    expect((await api().post('/api/v1/users').set(h).send({})).status).toBe(403);
    expect((await api().post('/api/v1/companies').set(h).send({ name: 'X' })).status).toBe(403);
    expect((await api().post('/api/v1/projects').set(h).send({})).status).toBe(403);
    expect((await api().patch(`/api/v1/users/${a.VIEWER.id}`).set(h).send({ name: 'x' })).status).toBe(403);
    expect((await api().delete(`/api/v1/users/${a.VIEWER.id}`).set(h)).status).toBe(403);
  });

  it('every logged-in role can read masters (for pickers)', async () => {
    for (const role of ROLE_KEYS) {
      const res = await api().get('/api/v1/users').set(bearer(a[role]));
      expect(res.status).toBe(200);
      expect(res.body.data[0].password_hash).toBeUndefined();
    }
  });
});

describe('masters: companies and projects', () => {
  it('creates, lists, updates and guards deletion of companies and projects', async () => {
    const h = bearer(a.ADMIN);
    const c = await api().post('/api/v1/companies').set(h).send({ name: 'Acme' });
    expect(c.status).toBe(201);
    expect((await api().post('/api/v1/companies').set(h).send({ name: 'acme' })).status).toBe(409);
    expect((await api().post('/api/v1/companies').set(h).send({ name: '' })).body.fields.name).toBeDefined();

    const p = await api()
      .post('/api/v1/projects')
      .set(h)
      .send({ company_id: c.body.id, name: 'Payments', owner_user_id: a.PROJECT_OWNER.id });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    expect(p.body.company.name).toBe('Acme');
    expect(p.body.owner.id).toBe(a.PROJECT_OWNER.id);

    const bad = await api()
      .post('/api/v1/projects')
      .set(h)
      .send({ company_id: randomUUID(), name: 'X', owner_user_id: a.PROJECT_OWNER.id });
    expect(bad.status).toBe(400);
    expect(bad.body.fields.company_id).toBeDefined();

    const list = await api().get('/api/v1/projects?page=1&page_size=10&sort=-name').set(bearer(a.DEV));
    expect(list.body).toMatchObject({ page: 1, page_size: 10, total: 1 });

    expect((await api().get('/api/v1/projects?sort=bogus').set(h)).status).toBe(400);

    const upd = await api().patch(`/api/v1/projects/${p.body.id}`).set(h).send({ name: 'Payments v2' });
    expect(upd.body.name).toBe('Payments v2');

    expect((await api().delete(`/api/v1/companies/${c.body.id}`).set(h)).status).toBe(409);
    expect((await api().delete(`/api/v1/projects/${p.body.id}`).set(h)).status).toBe(204);
    expect((await api().delete(`/api/v1/companies/${c.body.id}`).set(h)).status).toBe(204);
    expect((await api().get(`/api/v1/companies/${c.body.id}`).set(h)).status).toBe(404);
  });

  it('returns 404 for unknown ids and 400 for malformed ids', async () => {
    const h = bearer(a.ADMIN);
    expect((await api().get(`/api/v1/projects/${randomUUID()}`).set(h)).status).toBe(404);
    expect((await api().get('/api/v1/projects/not-a-uuid').set(h)).status).toBe(400);
  });
});

describe('masters: users', () => {
  it('creates a user with a hashed password who can then log in', async () => {
    const h = bearer(a.ADMIN);
    const res = await api()
      .post('/api/v1/users')
      .set(h)
      .send({ name: 'New Dev', email: 'NewDev@Test.local', password: 'secret123', role: 'DEV' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email: 'newdev@test.local', role: 'DEV', team: 'DEV', is_active: true });
    const row = await prisma.user.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.password_hash).not.toBe('secret123');
    const login = await api().post('/api/v1/auth/login').send({ email: 'newdev@test.local', password: 'secret123' });
    expect(login.status).toBe(200);
  });

  it('rejects duplicate emails (409) and invalid role/team combos (400)', async () => {
    const h = bearer(a.ADMIN);
    const dup = await api()
      .post('/api/v1/users')
      .set(h)
      .send({ name: 'Dup', email: 'dev@test.local', password: 'secret123', role: 'VIEWER' });
    expect(dup.status).toBe(409);
    const badTeam = await api()
      .post('/api/v1/users')
      .set(h)
      .send({ name: 'X', email: 'x@test.local', password: 'secret123', role: 'QA', team: 'DEV' });
    expect(badTeam.status).toBe(400);
    expect(badTeam.body.fields.team).toBeDefined();
    const badRole = await api()
      .post('/api/v1/users')
      .set(h)
      .send({ name: 'X', email: 'y@test.local', password: 'short', role: 'BOSS' });
    expect(badRole.status).toBe(400);
    expect(Object.keys(badRole.body.fields).sort()).toEqual(['password', 'role']);
  });

  it('delete deactivates the user and blocks login; writes audit rows', async () => {
    const h = bearer(a.ADMIN);
    const created = await api()
      .post('/api/v1/users')
      .set(h)
      .send({ name: 'Temp', email: 'temp@test.local', password: 'secret123', role: 'VIEWER' });
    expect((await api().delete(`/api/v1/users/${created.body.id}`).set(h)).status).toBe(204);
    const user = await api().get(`/api/v1/users/${created.body.id}`).set(h);
    expect(user.body.is_active).toBe(false);
    const login = await api().post('/api/v1/auth/login').send({ email: 'temp@test.local', password: 'secret123' });
    expect(login.status).toBe(401);
    const audit = await prisma.auditLog.findMany({ where: { entity_id: created.body.id }, orderBy: { at: 'asc' } });
    expect(audit.map((x) => x.action)).toEqual(['CREATE', 'DELETE']);
    expect(JSON.stringify(audit)).not.toContain('password_hash');
  });

  it('audit rows cannot be modified', async () => {
    const row = await prisma.auditLog.findFirstOrThrow();
    await expect(prisma.auditLog.update({ where: { id: row.id }, data: { action: 'X' } })).rejects.toThrow();
    await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow();
  });
});
