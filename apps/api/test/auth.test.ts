import { beforeAll, describe, expect, it } from 'vitest';
import { api, bearer, createActors, PASSWORD, prisma, resetDb, type Actor, type RoleKey } from './helpers.js';

let actors: Record<RoleKey, Actor>;

beforeAll(async () => {
  await resetDb();
  actors = await createActors();
});

describe('auth', () => {
  it('logs in with email and password and returns a token and the user', async () => {
    const res = await api().post('/api/v1/auth/login').send({ email: 'DEV@test.local', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ email: 'dev@test.local', role: 'DEV', team: 'DEV' });
    expect(res.body.user.password_hash).toBeUndefined();

    const me = await api().get('/api/v1/me').set({ Authorization: `Bearer ${res.body.token}` });
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ id: actors.DEV.id, role: 'DEV', team: 'DEV' });
  });

  it('rejects a wrong password with 401', async () => {
    const res = await api().post('/api/v1/auth/login').send({ email: 'dev@test.local', password: 'nope' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('UNAUTHORIZED');
  });

  it('rejects a malformed login body with 400 and field errors', async () => {
    const res = await api().post('/api/v1/auth/login').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION');
    expect(res.body.fields).toHaveProperty('email');
    expect(res.body.fields).toHaveProperty('password');
  });

  it('returns 401 without a token or with a bad token', async () => {
    expect((await api().get('/api/v1/me')).status).toBe(401);
    expect((await api().get('/api/v1/users')).status).toBe(401);
    expect((await api().get('/api/v1/me').set({ Authorization: 'Bearer garbage' })).status).toBe(401);
  });

  it('blocks inactive users from logging in and from using an old token', async () => {
    const viewer = actors.VIEWER;
    await prisma.user.update({ where: { id: viewer.id }, data: { is_active: false } });
    const login = await api().post('/api/v1/auth/login').send({ email: viewer.email, password: PASSWORD });
    expect(login.status).toBe(401);
    expect((await api().get('/api/v1/me').set(bearer(viewer))).status).toBe(401);
    await prisma.user.update({ where: { id: viewer.id }, data: { is_active: true } });
  });
});
