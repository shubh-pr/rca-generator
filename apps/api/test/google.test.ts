import { generateKeyPairSync } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config.js';
import { api, createUser, db, raw, resetDb } from './helpers.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-kid', alg: 'RS256', use: 'sig' };
const CLIENT_ID = 'test-client.apps.googleusercontent.com';

function idToken(claims: Record<string, unknown>, opts: { key?: typeof privateKey; aud?: string } = {}) {
  return jwt.sign({ iss: 'https://accounts.google.com', aud: opts.aud ?? CLIENT_ID, ...claims }, opts.key ?? privateKey, {
    algorithm: 'RS256',
    keyid: 'test-kid',
    expiresIn: 300,
  });
}

function mockGoogle(token: string) {
  const real = globalThis.fetch;
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get('code_verifier')).toBeTruthy();
      expect(body.get('client_secret')).toBe('secret');
      return new Response(JSON.stringify({ id_token: token }));
    }
    if (url.startsWith('https://www.googleapis.com/oauth2/v3/certs')) return new Response(JSON.stringify({ keys: [jwk] }));
    return real(input, init);
  });
}

/** Runs start + callback like a browser; returns the callback response. */
async function signInWithGoogle(token: string, state?: string) {
  const start = await api().get('/api/v1/auth/google/start?next=/rcas');
  expect(start.status).toBe(302);
  const url = new URL(start.headers.location);
  expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  const cookie = (start.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');
  mockGoogle(token);
  return api()
    .get(`/api/v1/auth/google/callback?code=abc&state=${state ?? url.searchParams.get('state')}`)
    .set('Cookie', cookie);
}

beforeEach(async () => {
  await resetDb();
  config.google.clientId = CLIENT_ID;
  config.google.clientSecret = 'secret';
});

afterEach(() => {
  config.google.clientId = undefined;
  config.google.clientSecret = undefined;
  vi.restoreAllMocks();
});

describe('Google sign-in', () => {
  it('is off (404) unless configured', async () => {
    config.google.clientId = undefined;
    expect((await api().get('/api/v1/auth/google/start')).status).toBe(404);
    expect((await api().get('/api/v1/config/public')).body.google_enabled).toBe(false);
  });

  it('creates a verified account with a personal workspace and starts a session', async () => {
    const res = await signInWithGoogle(idToken({ sub: 'g-1', email: 'NewPerson@Gmail.test', email_verified: true, name: 'New Person' }));
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${config.appUrl}/rcas`);
    expect((res.headers['set-cookie'] as unknown as string[]).some((c) => c.startsWith('rca_rt='))).toBe(true);
    const user = await raw(() => db.user.findUniqueOrThrow({ where: { email: 'newperson@gmail.test' } }));
    expect(user).toMatchObject({ google_sub: 'g-1', password_hash: null, name: 'New Person' });
    expect(user.email_verified_at).not.toBeNull();
    expect(await raw(() => db.workspace.count({ where: { owner_id: user.id, is_personal: true } }))).toBe(1);
  });

  it('links an existing account only when Google says the email is verified', async () => {
    const existing = await createUser('Existing', { email: 'existing@x.test' });
    const refused = await signInWithGoogle(idToken({ sub: 'g-2', email: 'existing@x.test', email_verified: false }));
    expect(refused.headers.location).toBe(`${config.appUrl}/login?error=google_email_not_verified`);
    expect((await raw(() => db.user.findUniqueOrThrow({ where: { id: existing.id } }))).google_sub).toBeNull();
    vi.restoreAllMocks();
    const linked = await signInWithGoogle(idToken({ sub: 'g-2', email: 'existing@x.test', email_verified: true }));
    expect(linked.headers.location).toBe(`${config.appUrl}/rcas`);
    expect((await raw(() => db.user.findUniqueOrThrow({ where: { id: existing.id } }))).google_sub).toBe('g-2');
    expect(await raw(() => db.user.count())).toBe(1);
  });

  it('refuses a wrong state, a forged signature and a token for another client', async () => {
    expect((await signInWithGoogle(idToken({ sub: 'g-3', email: 'a@x.test', email_verified: true }), 'tampered')).headers.location).toContain('error=google_state');
    vi.restoreAllMocks();
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    expect((await signInWithGoogle(idToken({ sub: 'g-3', email: 'a@x.test', email_verified: true }, { key: other }))).headers.location).toContain('error=google_failed');
    vi.restoreAllMocks();
    expect((await signInWithGoogle(idToken({ sub: 'g-3', email: 'a@x.test', email_verified: true }, { aud: 'someone-else' }))).headers.location).toContain('error=google_failed');
    expect(await raw(() => db.user.count())).toBe(0);
  });

  it('a deleted account cannot come back through Google', async () => {
    const u = await createUser('Gone', { email: 'gone@x.test' });
    await raw(() => db.user.update({ where: { id: u.id }, data: { deleted_at: new Date(), google_sub: 'g-4' } }));
    const res = await signInWithGoogle(idToken({ sub: 'g-4', email: 'gone@x.test', email_verified: true }));
    expect(res.headers.location).toContain('error=account_unavailable');
  });
});
