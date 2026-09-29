/**
 * Sign in with Google / Microsoft: OAuth 2.0 authorization-code flow with PKCE (S256), state and nonce,
 * handled on the server. The ID token is verified against the provider's published keys (RS256),
 * audience = our client ID, provider-specific issuer, expiry and nonce.
 *
 *   GET  /auth/:provider/start      → provider login page (sign in or sign up)
 *   GET  /auth/:provider/callback   → session cookies, back to the app (or to settings after linking)
 *   POST /me/identities/:provider/link   (signed in) → { url }: the same flow, linking to the current user
 *   DELETE /me/identities/:provider      (signed in) → unlink, refused for the last sign-in method
 *
 * Flow data (state, PKCE verifier, nonce, target) lives in a 10-minute httpOnly cookie bound to this
 * browser and to the provider's callback path. A link request carries a signed claim for the user, so a
 * browser cannot rewrite its own cookie to link an identity to somebody else's account.
 */
import { createHash, createPublicKey, randomBytes, type webcrypto } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../../config.js';
import { prisma } from '../../db.js';
import { notFound } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { parse } from '../../lib/validate.js';
import { unscoped } from '../../tenancy/context.js';
import { setSessionCookies } from '../cookies.js';
import { currentUser, requireAuth } from '../middleware.js';
import { enforce, MINUTE } from '../rateLimit.js';
import { securityEvent } from '../security.js';
import { createSession } from '../sessions.js';
import { linkIdentity, listIdentities, signInWithIdentity, unlinkIdentity } from './identities.js';
import { enabledProviders, isEnabled, provider, redirectUri, type IdClaims, type OidcProvider } from './providers.js';

const FLOW_TTL_MS = 10 * MINUTE;
const LINK_AUDIENCE = 'rca-oauth-link';
const b64url = (b: Buffer) => b.toString('base64url');
const cookieName = (p: OidcProvider) => `rca_oauth_${p.key}`;
const cookiePath = (p: OidcProvider) => `/api/v1/auth/${p.key}`;

interface FlowCookie {
  state: string;
  verifier: string;
  nonce: string;
  next: string;
  /** Signed JWT naming the user to link to (link flow only). */
  link?: string;
}

/** Where to go after sign-in: only same-site paths. */
function safeNext(next: unknown): string {
  return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/dashboard';
}

function enabledOr404(key: string): OidcProvider {
  const p = provider(key);
  if (!isEnabled(p)) throw notFound('This sign-in provider is not enabled');
  return p;
}

/** Create the flow cookie and return the provider's authorization URL. */
function beginFlow(res: Response, p: OidcProvider, next: string, link?: string): string {
  const flow: FlowCookie = { state: b64url(randomBytes(24)), verifier: b64url(randomBytes(32)), nonce: b64url(randomBytes(24)), next, ...(link ? { link } : {}) };
  res.cookie(cookieName(p), JSON.stringify(flow), { httpOnly: true, secure: config.cookieSecure, sameSite: 'lax', path: cookiePath(p), maxAge: FLOW_TTL_MS });
  const url = new URL(p.authUrl);
  url.search = new URLSearchParams({
    client_id: p.clientId!,
    redirect_uri: redirectUri(p),
    response_type: 'code',
    scope: 'openid email profile',
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: b64url(createHash('sha256').update(flow.verifier).digest()),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  return url.toString();
}

// ---------- ID token verification ----------

type Jwk = webcrypto.JsonWebKey & { kid?: string };
const jwksCache = new Map<string, { keys: Jwk[]; fetchedAt: number }>();

async function signingKey(jwksUrl: string, kid: string) {
  let cached = jwksCache.get(jwksUrl);
  if (!cached || Date.now() - cached.fetchedAt > 3_600_000 || !cached.keys.some((k) => k.kid === kid)) {
    const res = await fetch(jwksUrl, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`JWKS ${res.status}`);
    cached = { keys: ((await res.json()) as { keys: Jwk[] }).keys, fetchedAt: Date.now() };
    jwksCache.set(jwksUrl, cached);
  }
  const jwk = cached.keys.find((k) => k.kid === kid);
  if (!jwk) throw new Error('unknown signing key');
  return createPublicKey({ key: jwk, format: 'jwk' }).export({ type: 'spki', format: 'pem' }).toString();
}

/** Verify an ID token: RS256 signature from the provider's JWKS, audience, expiry, issuer rule and nonce. */
export async function verifyIdToken(p: OidcProvider, idToken: string, nonce: string): Promise<IdClaims> {
  const header = jwt.decode(idToken, { complete: true })?.header;
  if (!header?.kid || header.alg !== 'RS256') throw new Error('bad token header');
  const pem = await signingKey(p.jwksUrl, header.kid);
  const claims = jwt.verify(idToken, pem, { algorithms: ['RS256'], audience: p.clientId!, clockTolerance: 60 }) as IdClaims;
  if (!p.issuerOk(claims)) throw new Error('unexpected issuer');
  if (!claims.sub) throw new Error('no subject');
  if (!claims.nonce || claims.nonce !== nonce) throw new Error('nonce mismatch');
  return claims;
}

async function exchangeCode(p: OidcProvider, code: string, verifier: string): Promise<string | null> {
  const res = await fetch(p.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: p.clientId!, client_secret: p.clientSecret!, redirect_uri: redirectUri(p), grant_type: 'authorization_code', code_verifier: verifier }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  return ((await res.json()) as { id_token?: string }).id_token ?? null;
}

// ---------- Routes ----------

export const oauthRouter = Router();

oauthRouter.get('/auth/:provider/start', (req, res) => {
  const p = enabledOr404(String(req.params.provider));
  enforce([{ key: `oauth:ip:${req.ip}`, limit: config.rateLimit.loginPerIp, windowMs: 15 * MINUTE }]);
  res.redirect(beginFlow(res, p, safeNext(req.query.next)));
});

oauthRouter.get('/auth/:provider/callback', async (req: Request, res: Response) => {
  const p = provider(String(req.params.provider));
  if (!isEnabled(p)) {
    res.status(404).end();
    return;
  }
  let flow: FlowCookie | null = null;
  try {
    flow = JSON.parse(String(req.cookies?.[cookieName(p)] ?? 'null')) as FlowCookie | null;
  } catch {
    flow = null;
  }
  res.clearCookie(cookieName(p), { path: cookiePath(p) });
  const linking = !!flow?.link;
  const fail = (code: string) => res.redirect(linking ? `${config.appUrl}/settings?link_error=${code}&provider=${p.key}` : `${config.appUrl}/login?error=${code}&provider=${p.key}`);

  if (!flow || typeof req.query.state !== 'string' || req.query.state !== flow.state) return fail('oauth_state');
  if (typeof req.query.code !== 'string') return fail(typeof req.query.error === 'string' ? 'oauth_cancelled' : 'oauth_failed');
  try {
    const idToken = await exchangeCode(p, req.query.code, flow.verifier);
    if (!idToken) return fail('oauth_failed');
    const claims = await verifyIdToken(p, idToken, flow.nonce);

    if (flow.link) {
      let userId: string;
      try {
        userId = (jwt.verify(flow.link, config.jwtSecret, { audience: LINK_AUDIENCE, algorithms: ['HS256'] }) as { sub: string; provider: string }).sub;
      } catch {
        return fail('oauth_state');
      }
      const result = await linkIdentity(userId, p, claims);
      if ('refused' in result) return fail(result.refused);
      await securityEvent(userId, 'IDENTITY_LINK', { provider: p.key }, req);
      return res.redirect(`${config.appUrl}/settings?linked=${p.key}`);
    }

    const result = await signInWithIdentity(p, claims);
    if ('refused' in result) return fail(result.refused);
    await unscoped('oauth login bookkeeping', () => prisma.user.update({ where: { id: result.userId }, data: { last_login_at: new Date() } }));
    const session = await createSession(result.userId, req.get('user-agent') ?? undefined);
    setSessionCookies(res, session.refreshToken);
    if (result.linked && !result.created) await securityEvent(result.userId, 'IDENTITY_LINK', { provider: p.key, by: 'verified_email' }, req);
    await securityEvent(result.userId, result.created ? 'SIGNUP' : 'LOGIN', { method: p.key }, req);
    // The web app exchanges the refresh cookie for an access token on load.
    res.redirect(`${config.appUrl}${flow.next}`);
  } catch (err) {
    logger.warn('oauth sign-in failed', { provider: p.key, error: String(err) });
    fail('oauth_failed');
  }
});

/** Which providers are connected, and whether a password is set (Account settings). */
oauthRouter.get('/me/identities', requireAuth, async (req, res) => {
  res.json({ ...(await listIdentities(currentUser(req).id)), providers: enabledProviders() });
});

/** Start linking a provider to the signed-in user. The browser then navigates to `url`. */
oauthRouter.post('/me/identities/:provider/link', requireAuth, (req, res) => {
  const p = enabledOr404(String(req.params.provider));
  const me = currentUser(req);
  const link = jwt.sign({ sub: me.id, provider: p.key }, config.jwtSecret, { audience: LINK_AUDIENCE, algorithm: 'HS256', expiresIn: Math.floor(FLOW_TTL_MS / 1000) });
  res.json({ url: beginFlow(res, p, '/settings', link) });
});

oauthRouter.delete('/me/identities/:provider', requireAuth, async (req, res) => {
  const { provider: key } = parse(z.object({ provider: z.enum(['google', 'microsoft']) }), req.params);
  const me = currentUser(req);
  await unlinkIdentity(me.id, key === 'google' ? 'GOOGLE' : 'MICROSOFT');
  await securityEvent(me.id, 'IDENTITY_UNLINK', { provider: key }, req);
  res.json(await listIdentities(me.id));
});
