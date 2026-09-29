/**
 * Google sign-in: OAuth 2.0 authorization-code flow with PKCE, handled on the server.
 * Enabled only when GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set.
 * An existing account is linked only when Google reports the email address as verified.
 */
import { createHash, createPublicKey, randomBytes, type webcrypto } from 'node:crypto';
import type { Request, Response } from 'express';
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { logger } from '../lib/logger.js';
import { createAccount } from '../services/accounts.js';
import { acceptPendingInvitationsFor } from '../services/invitations.js';
import { unscoped } from '../tenancy/context.js';
import { setSessionCookies } from './cookies.js';
import { enforce, MINUTE } from './rateLimit.js';
import { securityEvent } from './security.js';
import { createSession } from './sessions.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
const STATE_COOKIE = 'rca_oauth';

export const googleRouter = Router();

const enabled = () => !!(config.google.clientId && config.google.clientSecret);
const redirectUri = () => `${config.appUrl}/api/v1/auth/google/callback`;
const b64url = (b: Buffer) => b.toString('base64url');

/** Where to go after login: only same-site paths. */
function safeNext(next: unknown): string {
  return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
}

googleRouter.get('/auth/google/start', (req, res) => {
  if (!enabled()) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Google sign-in is not enabled' });
    return;
  }
  enforce([{ key: `google:ip:${req.ip}`, limit: config.rateLimit.loginPerIp, windowMs: 15 * MINUTE }]);
  const state = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  // State, PKCE verifier and target are bound to this browser (prevents login CSRF and code injection).
  res.cookie(STATE_COOKIE, JSON.stringify({ state, verifier, next: safeNext(req.query.next) }), {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax',
    path: '/api/v1/auth/google',
    maxAge: 10 * MINUTE,
  });
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: config.google.clientId!,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  res.redirect(url.toString());
});

interface GoogleClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

let jwks: { keys: (Record<string, string> & { kid: string })[]; fetchedAt: number } | null = null;

async function signingKey(kid: string) {
  if (!jwks || Date.now() - jwks.fetchedAt > 3_600_000 || !jwks.keys.some((k) => k.kid === kid)) {
    const res = await fetch(JWKS_URL, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`JWKS ${res.status}`);
    jwks = { keys: ((await res.json()) as { keys: (Record<string, string> & { kid: string })[] }).keys, fetchedAt: Date.now() };
  }
  const jwk = jwks.keys.find((k) => k.kid === kid);
  if (!jwk) throw new Error('unknown signing key');
  return createPublicKey({ key: jwk as webcrypto.JsonWebKey, format: 'jwk' });
}

/** Verify Google's ID token: RS256 signature from Google's JWKS, issuer, audience and expiry. */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleClaims> {
  const header = jwt.decode(idToken, { complete: true })?.header;
  if (!header?.kid || header.alg !== 'RS256') throw new Error('bad token header');
  const key = await signingKey(header.kid);
  const pem = key.export({ type: 'spki', format: 'pem' }).toString();
  const claims = jwt.verify(idToken, pem, { algorithms: ['RS256'], audience: config.google.clientId!, issuer: ISSUERS as [string, ...string[]] }) as GoogleClaims;
  if (!claims.sub) throw new Error('no subject');
  return claims;
}

function fail(res: Response, reason: string) {
  res.clearCookie(STATE_COOKIE, { path: '/api/v1/auth/google' });
  res.redirect(`${config.appUrl}/login?error=${encodeURIComponent(reason)}`);
}

/** Find, link or create the account for verified Google claims. Returns null with a reason when refused. */
export async function accountForGoogle(c: GoogleClaims): Promise<{ userId: string; created: boolean } | { refused: string }> {
  return unscoped('google sign-in', async () => {
    const bySub = await prisma.user.findUnique({ where: { google_sub: c.sub } });
    if (bySub) return bySub.deleted_at || !bySub.is_active ? { refused: 'account_unavailable' } : { userId: bySub.id, created: false };
    const email = c.email?.toLowerCase();
    if (!email || c.email_verified !== true) return { refused: 'google_email_not_verified' };
    const byEmail = await prisma.user.findUnique({ where: { email } });
    if (byEmail) {
      if (byEmail.deleted_at || !byEmail.is_active) return { refused: 'account_unavailable' };
      if (byEmail.google_sub && byEmail.google_sub !== c.sub) return { refused: 'account_linked_elsewhere' };
      // Link: Google has verified that this person controls the address.
      await prisma.user.update({ where: { id: byEmail.id }, data: { google_sub: c.sub, email_verified_at: byEmail.email_verified_at ?? new Date() } });
      if (!byEmail.email_verified_at) await acceptPendingInvitationsFor(byEmail);
      return { userId: byEmail.id, created: false };
    }
    const user = await createAccount({ name: (c.name ?? email.split('@')[0]).slice(0, 120), email, password_hash: null, email_verified_at: new Date(), google_sub: c.sub });
    await acceptPendingInvitationsFor(user);
    return { userId: user.id, created: true };
  });
}

googleRouter.get('/auth/google/callback', async (req: Request, res: Response) => {
  if (!enabled()) {
    res.status(404).end();
    return;
  }
  let saved: { state: string; verifier: string; next: string } | null = null;
  try {
    saved = JSON.parse(String(req.cookies?.[STATE_COOKIE] ?? 'null'));
  } catch {
    saved = null;
  }
  if (!saved || typeof req.query.state !== 'string' || req.query.state !== saved.state) return fail(res, 'google_state');
  if (typeof req.query.code !== 'string') return fail(res, typeof req.query.error === 'string' ? 'google_cancelled' : 'google_code');
  try {
    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: req.query.code,
        client_id: config.google.clientId!,
        client_secret: config.google.clientSecret!,
        redirect_uri: redirectUri(),
        grant_type: 'authorization_code',
        code_verifier: saved.verifier,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!tokenRes.ok) return fail(res, 'google_token');
    const { id_token } = (await tokenRes.json()) as { id_token?: string };
    if (!id_token) return fail(res, 'google_token');
    const claims = await verifyGoogleIdToken(id_token);
    const result = await accountForGoogle(claims);
    if ('refused' in result) return fail(res, result.refused);
    await unscoped('google login bookkeeping', () => prisma.user.update({ where: { id: result.userId }, data: { last_login_at: new Date() } }));
    const session = await createSession(result.userId, req.get('user-agent') ?? undefined);
    setSessionCookies(res, session.refreshToken);
    await securityEvent(result.userId, result.created ? 'SIGNUP' : 'LOGIN', { method: 'google' }, req);
    res.clearCookie(STATE_COOKIE, { path: '/api/v1/auth/google' });
    // The web app exchanges the refresh cookie for an access token on load.
    res.redirect(`${config.appUrl}${saved.next}`);
  } catch (err) {
    logger.warn('google sign-in failed', { error: String(err) });
    fail(res, 'google_failed');
  }
});
