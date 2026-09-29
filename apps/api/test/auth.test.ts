import { beforeAll, describe, expect, it } from 'vitest';
import { api, bearer, createUser, db, PASSWORD, raw, resetDb, type Actor } from './helpers.js';

let user: Actor;

beforeAll(async () => {
  await resetDb();
  user = await createUser('Dana Dev');
});

describe('auth', () => {
  it('logs in with email and password and returns a token and the profile with workspaces', async () => {
    const res = await api().post('/api/v1/auth/login').send({ email: user.email.toUpperCase(), password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.access_token).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ email: user.email, email_verified: true });
    expect(res.body.user.password_hash).toBeUndefined();
    expect(res.body.user.workspaces).toEqual([expect.objectContaining({ id: user.personalWorkspaceId, role: 'OWNER', is_personal: true })]);
    const me = await api().get('/api/v1/me').set({ Authorization: `Bearer ${res.body.access_token}` });
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(user.id);
  });

  it('rejects a wrong password with 401', async () => {
    const res = await api().post('/api/v1/auth/login').send({ email: user.email, password: 'nope' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('UNAUTHORIZED');
  });

  it('rejects a malformed login body with 400 and field errors', async () => {
    const res = await api().post('/api/v1/auth/login').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.fields).toHaveProperty('email');
    expect(res.body.fields).toHaveProperty('password');
  });

  it('returns 401 without a token or with a bad token', async () => {
    expect((await api().get('/api/v1/me')).status).toBe(401);
    expect((await api().get('/api/v1/rcas')).status).toBe(401);
    expect((await api().get('/api/v1/me').set({ Authorization: 'Bearer garbage' })).status).toBe(401);
  });

  it('blocks deleted users from logging in and from using an old token', async () => {
    const gone = await createUser('Gone');
    await raw(() => db.user.update({ where: { id: gone.id }, data: { deleted_at: new Date() } }));
    expect((await api().post('/api/v1/auth/login').send({ email: gone.email, password: PASSWORD })).status).toBe(401);
    expect((await api().get('/api/v1/me').set(bearer(gone))).status).toBe(401);
  });
});
