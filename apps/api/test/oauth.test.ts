/**
 * Sign in with Google / Microsoft. The real start → provider → callback flow runs against the real
 * endpoint URLs, with fetch mocked for the token and JWKS endpoints: nothing leaves the machine.
 */
import { generateKeyPairSync } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSession } from '../src/auth/sessions.js';
import { MICROSOFT_CONSUMER_TENANT } from '../src/auth/oauth/providers.js';
import { config } from '../src/config.js';
import { ConsoleEmailProvider, emailProvider, flushEmails } from '../src/email/index.js';
import { api, bearer, createUser, db, PASSWORD, raw, resetDb } from './helpers.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-kid', alg: 'RS256', use: 'sig' };
const WORK_TENANT = '72f988bf-86f1-41af-91ab-2d7cd011db47';

type Key = 'google' | 'microsoft';
const P = {
  google: {
    clientId: 'test-client.apps.googleusercontent.com',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
    base: () => ({ iss: 'https://accounts.google.com' }),
    verified: () => ({ email_verified: true }),
    unverified: () => ({ email_verified: false }),
  },
  microsoft: {
    clientId: '00000000-1111-2222-3333-444444444444',
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    jwksUrl: 'https://login.microsoftonline.com/common/discovery/v2.0/keys',
    base: (tid = MICROSOFT_CONSUMER_TENANT) => ({ iss: `https://login.microsoftonline.com/${tid}/v2.0`, tid }),
    // Personal accounts: the email is the verified sign-in address.
    verified: () => ({}),
    // Work account without the xms_edov claim: the email attribute is not proven.
    unverified: () => ({ iss: `https://login.microsoftonline.com/${WORK_TENANT}/v2.0`, tid: WORK_TENANT }),
  },
} as const;

let tokenClaims: (nonce: string) => Record<string, unknown>;
let signOpts: { key?: typeof privateKey; aud?: string } = {};

function idToken(key: Key, claims: Record<string, unknown>) {
  return jwt.sign({ aud: signOpts.aud ?? P[key].clientId, ...claims }, signOpts.key ?? privateKey, { algorithm: 'RS256', keyid: 'test-kid', expiresIn: 300 });
}

function mockProviders() {
  const real = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    for (const key of ['google', 'microsoft'] as Key[]) {
      if (url === P[key].tokenUrl) {
        const body = new URLSearchParams(String(init?.body));
        expect(body.get('code_verifier')).toBeTruthy();
        expect(body.get('client_secret')).toBe(`${key}-secret`);
        expect(body.get('redirect_uri')).toBe(`${config.appUrl}/api/v1/auth/${key}/callback`);
        return new Response(JSON.stringify({ id_token: idToken(key, tokenClaims(body.get('code')!)) }));
      }
      if (url === P[key].jwksUrl) return new Response(JSON.stringify({ keys: [jwk] }));
    }
    return real(input, init);
  });
}

const cookiesOf = (res: { headers: Record<string, unknown> }) => ((res.headers['set-cookie'] as string[] | undefined) ?? []).map((c) => c.split(';')[0]).join('; ');

/**
 * Browser round trip: start (or a link request) → "provider" → callback. The provider echoes the
 * nonce into the ID token; the code we pass is the nonce so the token mock can read it.
 */
async function roundTrip(key: Key, claims: (base: Record<string, unknown>) => Record<string, unknown>, opts: { state?: string; linkAs?: string; cookie?: (c: string) => string } = {}) {
  const start = opts.linkAs
    ? await api().post(`/api/v1/me/identities/${key}/link`).set('Authorization', `Bearer ${opts.linkAs}`).send({})
    : await api().get(`/api/v1/auth/${key}/start?next=/rcas`);
  const location = opts.linkAs ? start.body.url : start.headers.location;
  expect(opts.linkAs ? start.status : start.status, JSON.stringify(start.body)).toBe(opts.linkAs ? 200 : 302);
  const url = new URL(location);
  expect(url.origin + url.pathname).toBe(P[key].authUrl);
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  expect(url.searchParams.get('scope')).toBe('openid email profile');
  const nonce = url.searchParams.get('nonce')!;
  tokenClaims = (n) => ({ nonce: n, ...claims(P[key].base() as Record<string, unknown>) });
  let cookie = cookiesOf(start);
  if (opts.cookie) cookie = opts.cookie(cookie);
  return api()
    .get(`/api/v1/auth/${key}/callback?code=${nonce}&state=${opts.state ?? url.searchParams.get('state')}`)
    .set('Cookie', cookie);
}

const signIn = (key: Key, claims: Record<string, unknown>, opts?: Parameters<typeof roundTrip>[2]) => roundTrip(key, (base) => ({ ...base, ...claims }), opts);
const user = (email: string) => raw(() => db.user.findUnique({ where: { email }, include: { identities: true } }));
const tokenFor = async (userId: string) => (await createSession(userId, 'vitest')).accessToken;

const outbox = () => (emailProvider() as ConsoleEmailProvider).outbox;
const linkNotices = async (to?: string) => {
  await flushEmails();
  return outbox().filter((m) => m.template === 'identity-linked' && (!to || m.to === to));
};

beforeEach(async () => {
  await resetDb();
  outbox().length = 0;
  signOpts = {};
  config.oauth.google.clientId = P.google.clientId;
  config.oauth.google.clientSecret = 'google-secret';
  config.oauth.microsoft.clientId = P.microsoft.clientId;
  config.oauth.microsoft.clientSecret = 'microsoft-secret';
  config.oauth.microsoft.tenant = 'common';
  mockProviders();
});

afterEach(() => {
  for (const k of ['google', 'microsoft'] as Key[]) config.oauth[k].clientId = config.oauth[k].clientSecret = undefined;
  vi.restoreAllMocks();
});

describe.each(['google', 'microsoft'] as Key[])('Sign in with %s', (key) => {
  it('is off (404) unless configured, and the public config says so', async () => {
    expect((await api().get('/api/v1/config/public')).body[`${key}_enabled`]).toBe(true);
    config.oauth[key].clientId = undefined;
    expect((await api().get(`/api/v1/auth/${key}/start`)).status).toBe(404);
    expect((await api().get('/api/v1/config/public')).body[`${key}_enabled`]).toBe(false);
  });

  it('first sign-in creates a verified account with a personal workspace, no password, and the identity row', async () => {
    const res = await signIn(key, { sub: `${key}-new`, email: 'NewPerson@Mail.test', name: 'New Person', ...P[key].verified() });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${config.appUrl}/rcas`);
    expect(cookiesOf(res)).toContain('rca_rt=');
    const u = (await user('newperson@mail.test'))!;
    expect(u).toMatchObject({ password_hash: null, name: 'New Person' });
    expect(u.email_verified_at).not.toBeNull();
    expect(u.identities).toEqual([expect.objectContaining({ provider: key.toUpperCase(), provider_account_id: `${key}-new`, email: 'newperson@mail.test' })]);
    expect(await raw(() => db.workspace.count({ where: { owner_id: u.id, is_personal: true } }))).toBe(1);

    // Signing in again finds the same account through the identity (even if the email changed at the provider).
    const again = await signIn(key, { sub: `${key}-new`, email: 'renamed@mail.test', ...P[key].verified() });
    expect(again.headers.location).toBe(`${config.appUrl}/rcas`);
    expect(await raw(() => db.user.count())).toBe(1);
    expect((await raw(() => db.userIdentity.findFirstOrThrow({ where: { provider_account_id: `${key}-new` } }))).last_used_at).not.toBeNull();
  });

  it('links to an existing account when the provider reports the email as verified (no duplicate account; password kept)', async () => {
    const existing = await createUser('Existing', { email: 'existing@x.test' });
    const res = await signIn(key, { sub: `${key}-link`, email: 'Existing@X.test', ...P[key].verified() });
    expect(res.headers.location).toBe(`${config.appUrl}/rcas`);
    const u = (await user('existing@x.test'))!;
    expect(u.id).toBe(existing.id);
    expect(u.identities.map((i) => i.provider_account_id)).toEqual([`${key}-link`]);
    expect(u.password_hash).not.toBeNull();
    expect(await raw(() => db.user.count())).toBe(1);
    // Password sign-in still works.
    expect((await api().post('/api/v1/auth/login').send({ email: 'existing@x.test', password: PASSWORD })).status).toBe(200);
  });

  it('refuses to auto-link (or create) when the provider does not report the email as verified', async () => {
    const existing = await createUser('Existing', { email: 'victim@x.test' });
    const refused = await signIn(key, { sub: `${key}-attacker`, email: 'victim@x.test', ...P[key].unverified() });
    expect(refused.headers.location).toBe(`${config.appUrl}/login?error=email_not_verified&provider=${key}`);
    expect(cookiesOf(refused)).not.toContain('rca_rt=');
    expect((await user('victim@x.test'))!.identities).toHaveLength(0);
    expect((await user('victim@x.test'))!.id).toBe(existing.id);
    const noAccount = await signIn(key, { sub: `${key}-nobody`, email: 'nobody@x.test', ...P[key].unverified() });
    expect(noAccount.headers.location).toContain('error=email_not_verified');
    expect(await user('nobody@x.test')).toBeNull();
  });

  it('pre-registration takeover: linking to a never-verified account removes the unproven password and signs out its sessions', async () => {
    const squatter = await createUser('Squatter', { email: 'owner@x.test', verified: false });
    const res = await signIn(key, { sub: `${key}-owner`, email: 'owner@x.test', ...P[key].verified() });
    expect(res.headers.location).toBe(`${config.appUrl}/rcas`);
    const u = (await user('owner@x.test'))!;
    expect(u.password_hash).toBeNull();
    expect(u.email_verified_at).not.toBeNull();
    expect((await api().get('/api/v1/me').set(bearer(squatter))).status).toBe(401);
    expect((await api().post('/api/v1/auth/login').send({ email: 'owner@x.test', password: PASSWORD })).status).toBe(401);
  });

  it('refuses a second, different account of the same provider for an email that already has one', async () => {
    await signIn(key, { sub: `${key}-first`, email: 'one@x.test', ...P[key].verified() });
    const res = await signIn(key, { sub: `${key}-second`, email: 'one@x.test', ...P[key].verified() });
    expect(res.headers.location).toContain('error=account_linked_elsewhere');
    expect((await user('one@x.test'))!.identities.map((i) => i.provider_account_id)).toEqual([`${key}-first`]);
  });

  it('refuses a wrong state, a forged signature, a token for another client and a replayed nonce', async () => {
    const claims = { sub: `${key}-x`, email: 'a@x.test', ...P[key].verified() };
    expect((await signIn(key, claims, { state: 'tampered' })).headers.location).toContain('error=oauth_state');
    signOpts = { key: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey };
    expect((await signIn(key, claims)).headers.location).toContain('error=oauth_failed');
    signOpts = { aud: 'someone-else' };
    expect((await signIn(key, claims)).headers.location).toContain('error=oauth_failed');
    signOpts = {};
    const replay = await roundTrip(key, (base) => ({ ...base, ...claims }));
    expect(replay.headers.location).toBe(`${config.appUrl}/rcas`);
    await resetDb();
    tokenClaims = () => ({ nonce: 'old-nonce', ...P[key].base(), ...claims });
    const start = await api().get(`/api/v1/auth/${key}/start`);
    const url = new URL(start.headers.location);
    const stale = await api().get(`/api/v1/auth/${key}/callback?code=x&state=${url.searchParams.get('state')}`).set('Cookie', cookiesOf(start));
    expect(stale.headers.location).toContain('error=oauth_failed');
    expect(await raw(() => db.user.count())).toBe(0);
  });

  it('a deleted account cannot come back through the provider', async () => {
    await signIn(key, { sub: `${key}-gone`, email: 'gone@x.test', ...P[key].verified() });
    await raw(() => db.user.update({ where: { email: 'gone@x.test' }, data: { deleted_at: new Date() } }));
    expect((await signIn(key, { sub: `${key}-gone`, email: 'gone@x.test', ...P[key].verified() })).headers.location).toContain('error=account_unavailable');
  });
});

describe('Microsoft specifics', () => {
  it('work and school accounts: the email counts as verified only with xms_edov; the issuer must match the tenant', async () => {
    const work = { ...P.microsoft.unverified(), sub: 'ms-work', email: 'alex@contoso.test' };
    expect((await signIn('microsoft', work)).headers.location).toContain('error=email_not_verified');
    expect((await signIn('microsoft', { ...work, xms_edov: true })).headers.location).toBe(`${config.appUrl}/rcas`);
    // An issuer that does not match the token's tenant is refused.
    const mismatch = await signIn('microsoft', { sub: 'ms-iss', email: 'b@x.test', tid: MICROSOFT_CONSUMER_TENANT, iss: `https://login.microsoftonline.com/${WORK_TENANT}/v2.0` });
    expect(mismatch.headers.location).toContain('error=oauth_failed');
  });

  it('MICROSOFT_TENANT restricts which accounts may sign in (endpoints and issuer rule)', async () => {
    const { provider } = await import('../src/auth/oauth/providers.js');
    const tokenOf = (tid: string) => ({ ...P.microsoft.base(tid), sub: 's', aud: 'a' });

    config.oauth.microsoft.tenant = WORK_TENANT;
    const single = provider('microsoft')!;
    expect(single.authUrl).toBe(`https://login.microsoftonline.com/${WORK_TENANT}/oauth2/v2.0/authorize`);
    expect(single.issuerOk(tokenOf(WORK_TENANT))).toBe(true);
    expect(single.issuerOk(tokenOf(MICROSOFT_CONSUMER_TENANT))).toBe(false);

    config.oauth.microsoft.tenant = 'consumers';
    expect(provider('microsoft')!.issuerOk(tokenOf(WORK_TENANT))).toBe(false);
    expect(provider('microsoft')!.issuerOk(tokenOf(MICROSOFT_CONSUMER_TENANT))).toBe(true);

    config.oauth.microsoft.tenant = 'organizations';
    expect(provider('microsoft')!.issuerOk(tokenOf(MICROSOFT_CONSUMER_TENANT))).toBe(false);
    expect(provider('microsoft')!.issuerOk(tokenOf(WORK_TENANT))).toBe(true);

    config.oauth.microsoft.tenant = 'common';
    expect(provider('microsoft')!.issuerOk(tokenOf(WORK_TENANT))).toBe(true);
    expect(provider('microsoft')!.issuerOk(tokenOf(MICROSOFT_CONSUMER_TENANT))).toBe(true);
    expect(provider('microsoft')!.issuerOk({ ...tokenOf(WORK_TENANT), tid: 'not-a-guid' })).toBe(false);
  });
});

describe('Connected accounts: link and unlink', () => {
  it('one user can have a password, Google and Microsoft at the same time (linked from settings, any email)', async () => {
    const me = await createUser('Multi', { email: 'multi@x.test' });
    expect((await api().post('/api/v1/me/identities/google/link').send({})).status).toBe(401);
    const g = await signIn('google', { sub: 'g-multi', email: 'multi.personal@gmail.test', email_verified: false }, { linkAs: me.token });
    expect(g.headers.location).toBe(`${config.appUrl}/settings?linked=google`);
    const m = await signIn('microsoft', { sub: 'm-multi', email: 'multi@outlook.test' }, { linkAs: me.token });
    expect(m.headers.location).toBe(`${config.appUrl}/settings?linked=microsoft`);
    const list = await api().get('/api/v1/me/identities').set(bearer(me));
    expect(list.body).toMatchObject({ has_password: true, providers: { google: true, microsoft: true } });
    expect(list.body.identities.map((i: { provider: string }) => i.provider).sort()).toEqual(['GOOGLE', 'MICROSOFT']);
    // Each identity now signs in to this account.
    expect((await signIn('google', { sub: 'g-multi', email: 'whatever@gmail.test', email_verified: true })).headers.location).toBe(`${config.appUrl}/rcas`);
    expect(await raw(() => db.user.count())).toBe(1);
    const audit = await raw(() => db.auditLog.findMany({ where: { entity_id: me.id, action: 'IDENTITY_LINK' } }));
    expect(audit).toHaveLength(2);
  });

  it('a browser cannot rewrite its flow cookie to link an identity to someone else', async () => {
    const attacker = await createUser('Attacker', { email: 'attacker@x.test' });
    const victim = await createUser('Victim', { email: 'victim@x.test' });
    const forged = jwt.sign({ sub: victim.id, provider: 'google' }, 'not-the-server-secret', { audience: 'rca-oauth-link', expiresIn: 600 });
    const res = await signIn('google', { sub: 'g-evil', email: 'evil@gmail.test', email_verified: true }, {
      linkAs: attacker.token,
      cookie: (c) => {
        const [name, value] = c.split(/=(.*)/s);
        const flow = JSON.parse(decodeURIComponent(value));
        return `${name}=${encodeURIComponent(JSON.stringify({ ...flow, link: forged }))}`;
      },
    });
    expect(res.headers.location).toContain('link_error=oauth_state');
    expect(await raw(() => db.userIdentity.count())).toBe(0);
  });

  it('an identity already linked to another user cannot be linked again', async () => {
    const a = await createUser('A', { email: 'a@x.test' });
    const b = await createUser('B', { email: 'b@x.test' });
    await signIn('google', { sub: 'g-shared', email: 'a@x.test', email_verified: true }, { linkAs: a.token });
    const res = await signIn('google', { sub: 'g-shared', email: 'a@x.test', email_verified: true }, { linkAs: b.token });
    expect(res.headers.location).toBe(`${config.appUrl}/settings?link_error=identity_linked_elsewhere&provider=google`);
    expect((await raw(() => db.userIdentity.findFirstOrThrow({ where: { provider_account_id: 'g-shared' } }))).user_id).toBe(a.id);
  });

  it('unlinking the last sign-in method is refused (409 LAST_LOGIN_METHOD); setting a password makes it possible', async () => {
    await signIn('google', { sub: 'g-only', email: 'only@gmail.test', email_verified: true });
    const u = (await user('only@gmail.test'))!;
    const token = await tokenFor(u.id);
    const auth = { Authorization: `Bearer ${token}` };

    const blocked = await api().delete('/api/v1/me/identities/google').set(auth);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe('LAST_LOGIN_METHOD');
    expect(await raw(() => db.userIdentity.count({ where: { user_id: u.id } }))).toBe(1);

    expect((await api().post('/api/v1/me/password').set(auth).send({ new_password: 'weak' })).status).toBe(400);
    expect((await api().post('/api/v1/me/password').set(auth).send({ new_password: 'Harbour-Lantern-Forty-2' })).status).toBe(200);
    expect((await api().post('/api/v1/me/password').set(auth).send({ new_password: 'Another-Harbour-Lantern-3' })).status).toBe(409);
    const ok = await api().delete('/api/v1/me/identities/google').set(auth);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ has_password: true, identities: [] });
    expect((await api().post('/api/v1/auth/login').send({ email: 'only@gmail.test', password: 'Harbour-Lantern-Forty-2' })).status).toBe(200);
    expect((await api().delete('/api/v1/me/identities/google').set(auth)).status).toBe(404);
  });

  it('two parallel unlinks of a passwordless user with two providers: exactly one succeeds', async () => {
    await signIn('google', { sub: 'g-two', email: 'two@x.test', email_verified: true });
    const u = (await user('two@x.test'))!;
    const token = await tokenFor(u.id);
    await signIn('microsoft', { sub: 'm-two', email: 'two@outlook.test' }, { linkAs: token });
    const results = await Promise.all(['google', 'microsoft'].map((k) => api().delete(`/api/v1/me/identities/${k}`).set('Authorization', `Bearer ${token}`)));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await raw(() => db.userIdentity.count({ where: { user_id: u.id } }))).toBe(1);
  });
});

describe('missing or non-true verification claims are treated as unverified (never verified by default)', () => {
  it('Google: a token that omits email_verified entirely refuses to auto-link and creates nothing', async () => {
    const existing = await createUser('Existing', { email: 'target@x.test' });
    tokenClaims = () => ({});
    // No email_verified key at all in the signed token.
    const res = await signIn('google', { sub: 'g-no-claim', email: 'target@x.test' });
    expect(res.headers.location).toBe(`${config.appUrl}/login?error=email_not_verified&provider=google`);
    expect(cookiesOf(res)).not.toContain('rca_rt=');
    expect((await user('target@x.test'))!.identities).toHaveLength(0);
    expect((await user('target@x.test'))!.id).toBe(existing.id);
    const fresh = await signIn('google', { sub: 'g-no-claim-2', email: 'fresh@x.test' });
    expect(fresh.headers.location).toContain('error=email_not_verified');
    expect(await user('fresh@x.test')).toBeNull();
    expect(await raw(() => db.userIdentity.count())).toBe(0);
  });

  it.each([['false'], [null], [0], [''], ['yes'], [{}]])('Google: email_verified = %j is not verified', async (value) => {
    await createUser('Existing', { email: 'target@x.test' });
    const res = await signIn('google', { sub: 'g-odd', email: 'target@x.test', email_verified: value });
    expect(res.headers.location).toContain('error=email_not_verified');
    expect(await raw(() => db.userIdentity.count())).toBe(0);
  });

  it('Microsoft work account: no xms_edov, xms_edov false, or an email_verified claim (which Microsoft does not define) are all unverified', async () => {
    await createUser('Existing', { email: 'target@contoso.test' });
    const work = { ...P.microsoft.unverified(), email: 'target@contoso.test' };
    for (const extra of [{}, { xms_edov: false }, { xms_edov: 'false' }, { email_verified: true }]) {
      const res = await signIn('microsoft', { ...work, sub: `ms-${JSON.stringify(extra)}`, ...extra });
      expect(res.headers.location, JSON.stringify(extra)).toContain('error=email_not_verified');
    }
    expect(await raw(() => db.userIdentity.count())).toBe(0);
  });

  it.each(['google', 'microsoft'] as Key[])('%s: a token without an email claim is refused', async (key) => {
    const res = await signIn(key, { sub: `${key}-no-email`, ...P[key].verified() });
    expect(res.headers.location).toContain('error=email_not_verified');
    expect(await raw(() => db.user.count())).toBe(0);
  });
});

describe('the account holder is notified of every new sign-in method', () => {
  it.each(['google', 'microsoft'] as Key[])('%s linked by verified email: email to the account address naming the provider and time; distinct security event', async (key) => {
    const existing = await createUser('Holder', { email: 'holder@x.test' });
    await signIn(key, { sub: `${key}-h`, email: 'holder@x.test', ...P[key].verified() });
    const [notice, ...more] = await linkNotices();
    expect(more).toHaveLength(0);
    expect(notice.to).toBe('holder@x.test');
    const label = key === 'google' ? 'Google' : 'Microsoft';
    expect(notice.subject).toBe(`${label} account connected to your RCA Dashboard account`);
    expect(notice.text).toContain(`A ${label} account (holder@x.test) was connected to your account on`);
    expect(notice.text).toMatch(/on \d{1,2} [A-Z][a-z]{2,3} \d{4}, \d{2}:\d{2} UTC \(\d{2}:\d{2} IST\)/);
    expect(notice.text).toContain(`because ${label} confirmed that they control this email address`);
    expect(notice.text).toContain(`${config.appUrl}/settings`);
    const events = await raw(() => db.auditLog.findMany({ where: { entity_id: existing.id, category: 'SECURITY' }, orderBy: { at: 'asc' } }));
    expect(events.map((e) => e.action)).toEqual(['IDENTITY_LINK', 'LOGIN']);
    expect(events[0].new_value).toMatchObject({ provider: key, provider_email: 'holder@x.test', via: 'verified_email' });
  });

  it('linked from Account settings: the notice goes to the account address (not the provider email) and says so', async () => {
    const me = await createUser('Setter', { email: 'setter@x.test' });
    await signIn('microsoft', { sub: 'm-set', email: 'setter.personal@outlook.test' }, { linkAs: me.token });
    const [notice] = await linkNotices();
    expect(notice.to).toBe('setter@x.test');
    expect(notice.text).toContain('A Microsoft account (setter.personal@outlook.test) was connected');
    expect(notice.text).toContain('It was connected from Account settings');
    // Linking the same identity again changes nothing and sends nothing.
    await signIn('microsoft', { sub: 'm-set', email: 'setter.personal@outlook.test' }, { linkAs: me.token });
    expect(await linkNotices()).toHaveLength(1);
  });

  it('pre-registration case: the notice says the unconfirmed password was removed', async () => {
    await createUser('Squat', { email: 'claimed@x.test', verified: false });
    await signIn('google', { sub: 'g-claimed', email: 'claimed@x.test', email_verified: true });
    const [notice] = await linkNotices('claimed@x.test');
    expect(notice.text).toContain('the password that was set on this account has been removed');
  });

  it('no notice for a brand-new account, a returning sign-in, or a refused attempt', async () => {
    await signIn('google', { sub: 'g-brand-new', email: 'new@x.test', email_verified: true });
    await signIn('google', { sub: 'g-brand-new', email: 'new@x.test', email_verified: true });
    await createUser('Victim', { email: 'victim@x.test' });
    await signIn('google', { sub: 'g-bad', email: 'victim@x.test', email_verified: false });
    expect(await linkNotices()).toHaveLength(0);
  });
});

