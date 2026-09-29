import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config.js';
import { ConsoleEmailProvider, emailProvider, flushEmails } from '../src/email/index.js';
import { resetRateLimits } from '../src/auth/rateLimit.js';
import { passwordProblem } from '../src/auth/password.js';
import { api, bearer, createUser, db, PASSWORD, raw, resetDb } from './helpers.js';

const outbox = () => (emailProvider() as ConsoleEmailProvider).outbox;
const lastMail = async (to: string, template?: string) => {
  await flushEmails();
  return [...outbox()].reverse().find((m) => m.to === to && (!template || m.template === template));
};
const tokenFrom = (text: string) => /token=([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? '';
const cookieHeader = (setCookie: string[] | string | undefined) =>
  (Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []).map((c) => c.split(';')[0]).join('; ');
const csrfOf = (cookie: string) => /rca_csrf=([^;]+)/.exec(cookie)?.[1] ?? '';

const NEW_PASSWORD = 'Blue-Ocean-Lantern-42';

beforeEach(async () => {
  await resetDb();
  outbox().length = 0;
  resetRateLimits();
});

afterEach(() => {
  config.rateLimit.enabled = false;
  config.turnstile.enabled = false;
  vi.restoreAllMocks();
});

async function signup(email: string, password = NEW_PASSWORD, name = 'New Person') {
  return api().post('/api/v1/auth/signup').send({ name, email, password, accept_terms: true });
}

async function login(email: string, password: string) {
  return api().post('/api/v1/auth/login').send({ email, password });
}

describe('password policy', () => {
  it('requires 10+ characters and rejects common passwords and the email address', () => {
    expect(passwordProblem('short')).toMatch(/at least 10/);
    expect(passwordProblem('1234567890')).toMatch(/too common/);
    expect(passwordProblem('qwertyuiop')).toMatch(/too common/);
    expect(passwordProblem('~~~~~~~~~~~~~~')).toMatch(/easy to guess/);
    expect(passwordProblem('jane.doe.1990', 'jane.doe.1990@x.test')).toMatch(/email/);
    expect(passwordProblem(NEW_PASSWORD)).toBeNull();
  });
});

describe('signup and verification', () => {
  it('creates an unverified account with a personal workspace and emails a single-use verification link', async () => {
    const res = await signup('new@x.test');
    expect(res.status).toBe(202);
    const user = await raw(() => db.user.findUniqueOrThrow({ where: { email: 'new@x.test' } }));
    expect(user.email_verified_at).toBeNull();
    expect(user.password_hash).toMatch(/^\$argon2id\$/);
    expect(await raw(() => db.workspace.count({ where: { owner_id: user.id, is_personal: true } }))).toBe(1);
    const mail = await lastMail('new@x.test', 'verify-email');
    expect(mail?.text).toContain('http://app.test/verify-email?token=');
    const token = tokenFrom(mail!.text);
    // Only the hash is stored.
    expect(JSON.stringify(await raw(() => db.emailToken.findMany()))).not.toContain(token);

    // Unverified users can log in (and view) but cannot create RCAs.
    const l = await login('new@x.test', NEW_PASSWORD);
    expect(l.status).toBe(200);
    expect(l.body.user.email_verified).toBe(false);
    const blocked = await api().post('/api/v1/rcas').set({ Authorization: `Bearer ${l.body.access_token}` }).send({ rca_date: '2026-09-28', severity: 'P1', environment: 'PROD', incident_start: '2026-09-27T10:00:00Z', summary: 'x' });
    expect(blocked.body.error).toBe('EMAIL_NOT_VERIFIED');

    expect((await api().post('/api/v1/auth/verify-email').send({ token })).body).toEqual({ verified: true });
    expect((await api().post('/api/v1/auth/verify-email').send({ token })).status).toBe(400); // single use
    const me = await api().get('/api/v1/me').set({ Authorization: `Bearer ${l.body.access_token}` });
    expect(me.body.email_verified).toBe(true);
  });

  it('does not reveal whether an email exists: same response, and the owner gets an "account exists" email', async () => {
    const existing = await createUser('Existing', { email: 'taken@x.test' });
    const a = await signup('taken@x.test');
    const b = await signup('free@x.test');
    expect(a.status).toBe(b.status);
    expect(a.body).toEqual(b.body);
    expect((await lastMail('taken@x.test'))?.template).toBe('account-exists');
    expect(await raw(() => db.user.count({ where: { email: 'taken@x.test' } }))).toBe(1);
    // The existing password is untouched.
    expect((await login('taken@x.test', PASSWORD)).status).toBe(200);
    expect(existing.id).toBeTruthy();
  });

  it('validates input: weak password, missing terms, bad email (400)', async () => {
    const weak = await signup('w@x.test', 'password12');
    expect(weak.status).toBe(400);
    expect(weak.body.fields.password).toMatch(/too common/);
    const terms = await api().post('/api/v1/auth/signup').send({ name: 'X', email: 'y@x.test', password: NEW_PASSWORD });
    expect(terms.body.fields.accept_terms).toBeDefined();
    expect((await signup('not-an-email')).body.fields.email).toBeDefined();
  });

  it('verification links expire after 24 hours', async () => {
    await signup('late@x.test');
    const token = tokenFrom((await lastMail('late@x.test'))!.text);
    await raw(() => db.emailToken.updateMany({ data: { expires_at: new Date(Date.now() - 1000) } }));
    expect((await api().post('/api/v1/auth/verify-email').send({ token })).status).toBe(400);
    const row = await raw(() => db.emailToken.findFirstOrThrow());
    expect(row.expires_at.getTime() - row.created_at.getTime()).toBeLessThanOrEqual(24 * 3_600_000 + 1000);
  });

  it('resend-verification issues a new link, invalidates the old one, and answers generically', async () => {
    await signup('again@x.test');
    const first = tokenFrom((await lastMail('again@x.test'))!.text);
    const r1 = await api().post('/api/v1/auth/resend-verification').send({ email: 'again@x.test' });
    const r2 = await api().post('/api/v1/auth/resend-verification').send({ email: 'nobody@x.test' });
    expect(r1.status).toBe(202);
    expect(r1.body).toEqual(r2.body);
    const second = tokenFrom((await lastMail('again@x.test'))!.text);
    expect(second).not.toBe(first);
    expect((await api().post('/api/v1/auth/verify-email').send({ token: first })).status).toBe(400);
    expect((await api().post('/api/v1/auth/verify-email').send({ token: second })).status).toBe(200);
  });
});

describe('login, sessions, refresh rotation, CSRF', () => {
  it('login sets an httpOnly refresh cookie and a CSRF cookie; refresh rotates; reuse revokes the session', async () => {
    const u = await createUser('Sess', { email: 'sess@x.test' });
    const l = await login('sess@x.test', PASSWORD);
    expect(l.status).toBe(200);
    const setCookie = l.headers['set-cookie'] as unknown as string[];
    expect(setCookie.find((c) => c.startsWith('rca_rt='))).toMatch(/HttpOnly/);
    expect(setCookie.find((c) => c.startsWith('rca_rt='))).toMatch(/SameSite=Lax/);
    expect(setCookie.find((c) => c.startsWith('rca_rt='))).toMatch(/Path=\/api\/v1\/auth/);
    const cookie = cookieHeader(setCookie);
    const csrf = csrfOf(cookie);

    // Without the CSRF header, or from another origin, refresh is refused.
    expect((await api().post('/api/v1/auth/refresh').set('Cookie', cookie)).status).toBe(403);
    expect((await api().post('/api/v1/auth/refresh').set('Cookie', cookie).set('X-CSRF-Token', csrf).set('Origin', 'https://evil.test')).status).toBe(403);

    const r1 = await api().post('/api/v1/auth/refresh').set('Cookie', cookie).set('X-CSRF-Token', csrf);
    expect(r1.status).toBe(200);
    expect(r1.body.access_token).toEqual(expect.any(String));
    const rotated = cookieHeader(r1.headers['set-cookie'] as unknown as string[]);
    expect(rotated).not.toBe(cookie);

    // Replaying the old refresh token: treated as theft, the whole session is revoked.
    const replay = await api().post('/api/v1/auth/refresh').set('Cookie', cookie).set('X-CSRF-Token', csrf);
    expect(replay.status).toBe(401);
    const afterReuse = await api().post('/api/v1/auth/refresh').set('Cookie', rotated).set('X-CSRF-Token', csrfOf(rotated));
    expect(afterReuse.status).toBe(401);
    expect((await api().get('/api/v1/me').set({ Authorization: `Bearer ${r1.body.access_token}` })).status).toBe(401);
    expect(u.id).toBeTruthy();
  });

  it('logout ends the session immediately; logout-all ends every session', async () => {
    await createUser('Out', { email: 'out@x.test' });
    const a = await login('out@x.test', PASSWORD);
    const b = await login('out@x.test', PASSWORD);
    const cookieA = cookieHeader(a.headers['set-cookie'] as unknown as string[]);
    expect((await api().post('/api/v1/auth/logout').set('Cookie', cookieA).set('X-CSRF-Token', csrfOf(cookieA))).status).toBe(204);
    expect((await api().get('/api/v1/me').set({ Authorization: `Bearer ${a.body.access_token}` })).status).toBe(401);
    expect((await api().get('/api/v1/me').set({ Authorization: `Bearer ${b.body.access_token}` })).status).toBe(200);

    const sessions = await api().get('/api/v1/auth/sessions').set({ Authorization: `Bearer ${b.body.access_token}` });
    // The fixture's own session plus login b; login a was logged out.
    expect(sessions.body.data).toHaveLength(2);
    expect(sessions.body.data.filter((s: { current: boolean }) => s.current)).toHaveLength(1);

    const c = await login('out@x.test', PASSWORD);
    expect((await api().post('/api/v1/auth/logout-all').set({ Authorization: `Bearer ${c.body.access_token}` })).status).toBe(204);
    expect((await api().get('/api/v1/me').set({ Authorization: `Bearer ${b.body.access_token}` })).status).toBe(401);
    expect((await api().get('/api/v1/me').set({ Authorization: `Bearer ${c.body.access_token}` })).status).toBe(401);
  });

  it('a user can end one of their other sessions but not someone else\'s', async () => {
    const u = await createUser('Multi', { email: 'multi@x.test' });
    const other = await createUser('Other');
    const a = await login('multi@x.test', PASSWORD);
    const list = await api().get('/api/v1/auth/sessions').set(bearer(u));
    const target = list.body.data.find((s: { current: boolean }) => !s.current);
    expect((await api().delete(`/api/v1/auth/sessions/${target.id}`).set(bearer(other))).status).toBe(404);
    expect((await api().delete(`/api/v1/auth/sessions/${target.id}`).set(bearer(u))).status).toBe(204);
    expect(a.status).toBe(200);
  });

  it('unknown email and wrong password give the same 401; legacy bcrypt hashes are upgraded', async () => {
    await createUser('Legacy', { email: 'legacy@x.test' });
    const bcrypt = await import('bcryptjs');
    await raw(async () => db.user.update({ where: { email: 'legacy@x.test' }, data: { password_hash: await bcrypt.default.hash(PASSWORD, 4) } }));
    const unknown = await login('ghost@x.test', PASSWORD);
    const wrong = await login('legacy@x.test', 'Wrong-Password-1');
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
    expect((await login('legacy@x.test', PASSWORD)).status).toBe(200);
    expect((await raw(() => db.user.findUniqueOrThrow({ where: { email: 'legacy@x.test' } }))).password_hash).toMatch(/^\$argon2id\$/);
    const events = await raw(() => db.auditLog.findMany({ where: { category: 'SECURITY' }, orderBy: { at: 'asc' } }));
    expect(events.map((e) => e.action)).toEqual(['LOGIN_FAILED', 'LOGIN']);
    expect(JSON.stringify(events)).not.toMatch(/password|argon2/i);
  });
});

describe('rate limits and lockout', () => {
  it('locks an account after repeated failures, even with the right password, and limits by IP', async () => {
    config.rateLimit.enabled = true;
    await createUser('Lock', { email: 'lock@x.test' });
    for (let i = 0; i < config.rateLimit.lockoutThreshold; i++) expect((await login('lock@x.test', 'Wrong-Password-1')).status).toBe(401);
    const locked = await login('lock@x.test', PASSWORD);
    expect([429]).toContain(locked.status);
    expect(locked.body.error).toBe('RATE_LIMITED');
    await raw(() => db.user.update({ where: { email: 'lock@x.test' }, data: { locked_until: new Date(Date.now() - 1000) } }));
    resetRateLimits();
    expect((await login('lock@x.test', PASSWORD)).status).toBe(200);
  });

  it('limits signup, forgot-password and resend-verification per IP and per account', async () => {
    config.rateLimit.enabled = true;
    const statuses: number[] = [];
    for (let i = 0; i < config.rateLimit.emailPerAccount + 1; i++) {
      statuses.push((await api().post('/api/v1/auth/forgot-password').send({ email: 'same@x.test' })).status);
    }
    expect(statuses.slice(0, -1).every((s) => s === 202)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    resetRateLimits();
    for (let i = 0; i < config.rateLimit.signupPerIp; i++) await signup(`s${i}@x.test`);
    expect((await signup('one-more@x.test')).status).toBe(429);
  });
});

describe('CAPTCHA hook (Turnstile)', () => {
  it('when enabled, signup and forgot-password need a valid token', async () => {
    config.turnstile.enabled = true;
    config.turnstile.secretKey = 'secret';
    const missing = await signup('cap@x.test');
    expect(missing.body.fields.captcha_token).toBeDefined();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ success: false })));
    const bad = await api().post('/api/v1/auth/forgot-password').send({ email: 'cap@x.test', captcha_token: 'bad' });
    expect(bad.status).toBe(400);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ success: true })));
    const ok = await api().post('/api/v1/auth/signup').send({ name: 'Cap', email: 'cap@x.test', password: NEW_PASSWORD, accept_terms: true, captcha_token: 'good' });
    expect(ok.status).toBe(202);
    expect(String(fetchMock.mock.calls[0][0])).toContain('challenges.cloudflare.com');
  });
});

describe('password reset and change', () => {
  it('reset: generic response, 1-hour single-use token, signs out every session', async () => {
    const u = await createUser('Reset', { email: 'reset@x.test' });
    const r1 = await api().post('/api/v1/auth/forgot-password').send({ email: 'reset@x.test' });
    const r2 = await api().post('/api/v1/auth/forgot-password').send({ email: 'ghost@x.test' });
    expect(r1.status).toBe(202);
    expect(r1.body).toEqual(r2.body);
    const token = tokenFrom((await lastMail('reset@x.test', 'reset-password'))!.text);
    const row = await raw(() => db.emailToken.findFirstOrThrow({ where: { type: 'RESET_PASSWORD' } }));
    expect(row.expires_at.getTime() - row.created_at.getTime()).toBeLessThanOrEqual(3_600_000 + 1000);

    expect((await api().post('/api/v1/auth/reset-password').send({ token, password: 'password12' })).status).toBe(400); // weak; token not spent
    expect((await api().post('/api/v1/auth/reset-password').send({ token, password: NEW_PASSWORD })).status).toBe(200);
    expect((await api().post('/api/v1/auth/reset-password').send({ token, password: NEW_PASSWORD })).status).toBe(400);
    expect((await api().get('/api/v1/me').set(bearer(u))).status).toBe(401);
    expect((await login('reset@x.test', PASSWORD)).status).toBe(401);
    expect((await login('reset@x.test', NEW_PASSWORD)).status).toBe(200);
  });

  it('expired reset tokens are refused', async () => {
    await createUser('Old', { email: 'old@x.test' });
    await api().post('/api/v1/auth/forgot-password').send({ email: 'old@x.test' });
    const token = tokenFrom((await lastMail('old@x.test'))!.text);
    await raw(() => db.emailToken.updateMany({ data: { expires_at: new Date(Date.now() - 1) } }));
    expect((await api().post('/api/v1/auth/reset-password').send({ token, password: NEW_PASSWORD })).status).toBe(400);
  });

  it('change password needs the current one and signs out other devices only', async () => {
    const u = await createUser('Change', { email: 'change@x.test' });
    const other = await login('change@x.test', PASSWORD);
    expect((await api().post('/api/v1/auth/change-password').set(bearer(u)).send({ current_password: 'nope', new_password: NEW_PASSWORD })).body.fields.current_password).toBeDefined();
    expect((await api().post('/api/v1/auth/change-password').set(bearer(u)).send({ current_password: PASSWORD, new_password: '1234567890' })).body.fields.new_password).toBeDefined();
    expect((await api().post('/api/v1/auth/change-password').set(bearer(u)).send({ current_password: PASSWORD, new_password: NEW_PASSWORD })).status).toBe(200);
    expect((await api().get('/api/v1/me').set(bearer(u))).status).toBe(200);
    expect((await api().get('/api/v1/me').set({ Authorization: `Bearer ${other.body.access_token}` })).status).toBe(401);
  });
});

describe('profile', () => {
  it('PATCH /me changes the name; an email change needs the password and a confirmation from the new inbox', async () => {
    const u = await createUser('Prof', { email: 'prof@x.test' });
    expect((await api().patch('/api/v1/me').set(bearer(u)).send({ name: 'Professor' })).body.name).toBe('Professor');
    expect((await api().patch('/api/v1/me').set(bearer(u)).send({ email: 'new-prof@x.test' })).status).toBe(400);
    const res = await api().patch('/api/v1/me').set(bearer(u)).send({ email: 'new-prof@x.test', current_password: PASSWORD });
    expect(res.body).toMatchObject({ email: 'prof@x.test', email_change_pending: true });
    const token = tokenFrom((await lastMail('new-prof@x.test', 'change-email'))!.text);
    expect((await api().post('/api/v1/auth/verify-email').send({ token })).body).toMatchObject({ email_changed: true });
    expect((await api().get('/api/v1/me').set(bearer(u))).body.email).toBe('new-prof@x.test');
    expect((await raw(() => db.auditLog.findMany({ where: { action: 'EMAIL_CHANGE' } }))).length).toBe(1);
  });

  it('never returns password hashes', async () => {
    const u = await createUser('Hash');
    const me = await api().get('/api/v1/me').set(bearer(u));
    expect(JSON.stringify(me.body)).not.toMatch(/password_hash|argon2/);
  });
});

describe('configuration', () => {
  it('fails fast on unsafe production settings', async () => {
    const { loadConfig } = await import('../src/config.js');
    expect(() => loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x' })).toThrow(/JWT_SECRET[\s\S]*EMAIL_PROVIDER[\s\S]*STORAGE_DRIVER/);
    expect(() => loadConfig({ DATABASE_URL: 'postgres://x', EMAIL_PROVIDER: 'smtp' })).toThrow(/SMTP_HOST/);
    expect(() => loadConfig({ DATABASE_URL: 'postgres://x', TURNSTILE_ENABLED: 'true' })).toThrow(/TURNSTILE/);
    expect(loadConfig({ DATABASE_URL: 'postgres://x' }).env).toBe('development');
  });
});
