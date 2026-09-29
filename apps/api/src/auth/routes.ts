import type { Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { sendEmail, templates } from '../email/index.js';
import { badRequest, conflict, HttpError, unauthorized } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { createAccount } from '../services/accounts.js';
import { unscoped } from '../tenancy/context.js';
import { verifyCaptcha } from './captcha.js';
import { clearSessionCookies, REFRESH_COOKIE, requireCsrf, setSessionCookies } from './cookies.js';
import { consumeEmailToken, issueEmailToken } from './emailTokens.js';
import { meView } from './me.js';
import { currentSessionId, currentUser, requireAuth } from './middleware.js';
import { burnPasswordCheck, hashPassword, MAX_PASSWORD_LENGTH, needsRehash, passwordProblem, verifyPassword } from './password.js';
import { enforce, HOUR, MINUTE } from './rateLimit.js';
import { securityEvent } from './security.js';
import { createSession, listSessions, revokeAllSessions, revokeFamily, rotateRefreshToken } from './sessions.js';
import { sha256 } from './tokens.js';

export const authRouter = Router();

const zEmail = z.string().trim().toLowerCase().email('Enter a valid email').max(180);
const zPassword = z.string().min(1, 'Password is required').max(MAX_PASSWORD_LENGTH);
const ip = (req: Request) => req.ip ?? 'unknown';
const ua = (req: Request) => req.get('user-agent') ?? undefined;
const users = <T>(fn: () => Promise<T>) => unscoped('auth flow', fn);

function checkNewPassword(password: string, email?: string, field = 'password') {
  const problem = passwordProblem(password, email);
  if (problem) throw badRequest({ [field]: problem });
}

async function startSession(req: Request, res: Response, userId: string) {
  const session = await createSession(userId, ua(req));
  setSessionCookies(res, session.refreshToken);
  return session;
}

// ---------- Signup and email verification ----------

const signupSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  email: zEmail,
  password: zPassword,
  accept_terms: z.literal(true, { error: 'Accept the Terms of Service and Privacy Policy' }),
  captcha_token: z.string().max(4096).optional(),
});

const SIGNUP_MESSAGE = 'Check your email. If the address can be used, we sent a link to verify it.';

/** Always 202 with the same message: the response never reveals whether the email is registered. */
authRouter.post('/auth/signup', async (req, res) => {
  enforce([{ key: `signup:ip:${ip(req)}`, limit: config.rateLimit.signupPerIp, windowMs: HOUR }]);
  const body = parse(signupSchema, req.body);
  checkNewPassword(body.password, body.email);
  await verifyCaptcha(body.captcha_token, req.ip);
  const passwordHash = await hashPassword(body.password); // spent for existing emails too (equal timing)
  const existing = await users(() => prisma.user.findUnique({ where: { email: body.email } }));
  if (existing) {
    if (!existing.deleted_at) sendEmail(existing.email, 'account-exists', templates.accountExists(existing.name));
  } else {
    const user = await createAccount({ name: body.name, email: body.email, password_hash: passwordHash });
    const token = await issueEmailToken(user.id, 'VERIFY_EMAIL');
    sendEmail(user.email, 'verify-email', templates.verifyEmail(user.name, token));
    await securityEvent(user.id, 'SIGNUP', {}, req);
  }
  res.status(202).json({ message: SIGNUP_MESSAGE });
});

authRouter.post('/auth/verify-email', async (req, res) => {
  const { token } = parse(z.object({ token: z.string().min(10).max(200) }), req.body);
  const row = await consumeEmailToken(token, ['VERIFY_EMAIL', 'CHANGE_EMAIL']);
  if (!row) throw badRequest({ token: 'This link is invalid or has expired. Request a new one.' });
  if (row.type === 'CHANGE_EMAIL') {
    const taken = await users(() => prisma.user.findUnique({ where: { email: row.new_email! } }));
    if (taken && taken.id !== row.user_id) throw conflict('This email address is already in use');
    await users(() => prisma.user.update({ where: { id: row.user_id }, data: { email: row.new_email!, email_verified_at: new Date() } }));
    await securityEvent(row.user_id, 'EMAIL_CHANGE', { from: row.user.email, to: row.new_email });
    res.json({ verified: true, email_changed: true });
    return;
  }
  await users(() => prisma.user.update({ where: { id: row.user_id }, data: { email_verified_at: row.user.email_verified_at ?? new Date() } }));
  await securityEvent(row.user_id, 'EMAIL_VERIFIED');
  res.json({ verified: true });
});

const emailOnly = z.object({ email: zEmail, captcha_token: z.string().max(4096).optional() });

authRouter.post('/auth/resend-verification', async (req, res) => {
  const body = parse(emailOnly, req.body);
  enforce([
    { key: `email:ip:${ip(req)}`, limit: config.rateLimit.emailPerIp, windowMs: HOUR },
    { key: `verify:acct:${body.email}`, limit: config.rateLimit.emailPerAccount, windowMs: HOUR },
  ]);
  const user = await users(() => prisma.user.findUnique({ where: { email: body.email } }));
  if (user && !user.deleted_at && !user.email_verified_at) {
    const token = await issueEmailToken(user.id, 'VERIFY_EMAIL');
    sendEmail(user.email, 'verify-email', templates.verifyEmail(user.name, token));
  }
  res.status(202).json({ message: 'If the account exists and is not verified yet, we sent a new link.' });
});

// ---------- Login, refresh, logout ----------

const loginSchema = z.object({ email: zEmail, password: zPassword });
const LOGIN_FAILED = 'Invalid email or password';

authRouter.post('/auth/login', async (req, res) => {
  const body = parse(loginSchema, req.body);
  enforce([
    { key: `login:ip:${ip(req)}`, limit: config.rateLimit.loginPerIp, windowMs: 15 * MINUTE },
    { key: `login:acct:${body.email}`, limit: config.rateLimit.loginPerAccount, windowMs: 15 * MINUTE },
  ]);
  const user = await users(() => prisma.user.findUnique({ where: { email: body.email } }));
  if (!user || user.deleted_at || !user.is_active || !user.password_hash) {
    await burnPasswordCheck(body.password);
    throw unauthorized(LOGIN_FAILED);
  }
  if (user.locked_until && user.locked_until > new Date()) {
    await burnPasswordCheck(body.password);
    throw new HttpError(429, 'RATE_LIMITED', 'Too many attempts. Please wait and try again.');
  }
  if (!(await verifyPassword(body.password, user.password_hash))) {
    const failures = user.failed_login_count + 1;
    const lock = failures >= config.rateLimit.lockoutThreshold;
    await users(() =>
      prisma.user.update({
        where: { id: user.id },
        data: lock ? { failed_login_count: 0, locked_until: new Date(Date.now() + config.rateLimit.lockoutMs) } : { failed_login_count: failures },
      }),
    );
    await securityEvent(user.id, 'LOGIN_FAILED', { locked: lock }, req);
    throw unauthorized(LOGIN_FAILED);
  }
  await users(async () =>
    prisma.user.update({
      where: { id: user.id },
      data: {
        failed_login_count: 0,
        locked_until: null,
        last_login_at: new Date(),
        ...(needsRehash(user.password_hash!) ? { password_hash: await hashPassword(body.password) } : {}),
      },
    }),
  );
  const session = await startSession(req, res, user.id);
  await securityEvent(user.id, 'LOGIN', {}, req);
  res.json({ access_token: session.accessToken, expires_in: config.accessTokenTtlSeconds, user: await meView(user.id) });
});

/** Exchange the refresh cookie for a new access token (rotating the refresh token). */
authRouter.post('/auth/refresh', requireCsrf, async (req, res) => {
  const presented = req.cookies?.[REFRESH_COOKIE];
  if (!presented) throw unauthorized('No session');
  const result = await rotateRefreshToken(String(presented), ua(req));
  if (!result.ok) {
    clearSessionCookies(res);
    throw unauthorized(result.reason === 'reused' ? 'Session ended for security reasons. Please log in again.' : 'Session expired. Please log in again.');
  }
  setSessionCookies(res, result.session.refreshToken);
  res.json({ access_token: result.session.accessToken, expires_in: config.accessTokenTtlSeconds, user: await meView(result.userId) });
});

authRouter.post('/auth/logout', requireCsrf, async (req, res) => {
  const presented = req.cookies?.[REFRESH_COOKIE];
  if (presented) {
    const row = await users(() => prisma.refreshToken.findUnique({ where: { token_hash: sha256(String(presented)) } }));
    if (row) {
      await revokeFamily(row.family_id);
      await securityEvent(row.user_id, 'LOGOUT', {}, req);
    }
  }
  clearSessionCookies(res);
  res.status(204).end();
});

// ---------- Password reset ----------

authRouter.post('/auth/forgot-password', async (req, res) => {
  const body = parse(emailOnly, req.body);
  enforce([
    { key: `email:ip:${ip(req)}`, limit: config.rateLimit.emailPerIp, windowMs: HOUR },
    { key: `reset:acct:${body.email}`, limit: config.rateLimit.emailPerAccount, windowMs: HOUR },
  ]);
  await verifyCaptcha(body.captcha_token, req.ip);
  const user = await users(() => prisma.user.findUnique({ where: { email: body.email } }));
  if (user && !user.deleted_at && user.is_active) {
    const token = await issueEmailToken(user.id, 'RESET_PASSWORD');
    sendEmail(user.email, 'reset-password', templates.resetPassword(user.name, token));
  }
  res.status(202).json({ message: 'If an account exists for this email, we sent a link to reset the password.' });
});

authRouter.post('/auth/reset-password', async (req, res) => {
  const body = parse(z.object({ token: z.string().min(10).max(200), password: zPassword }), req.body);
  enforce([{ key: `reset:ip:${ip(req)}`, limit: config.rateLimit.emailPerIp * 3, windowMs: HOUR }]);
  // Validate the new password before spending the single-use token.
  checkNewPassword(body.password);
  const row = await consumeEmailToken(body.token, ['RESET_PASSWORD']);
  if (!row) throw badRequest({ token: 'This link is invalid or has expired. Request a new one.' });
  checkNewPassword(body.password, row.user.email);
  await users(async () =>
    prisma.user.update({
      where: { id: row.user_id },
      data: {
        password_hash: await hashPassword(body.password),
        failed_login_count: 0,
        locked_until: null,
        // Following the emailed link proves control of the inbox.
        email_verified_at: row.user.email_verified_at ?? new Date(),
      },
    }),
  );
  await revokeAllSessions(row.user_id);
  await securityEvent(row.user_id, 'PASSWORD_RESET', {}, req);
  res.json({ message: 'Password changed. Log in with your new password.' });
});

// ---------- Authenticated account security ----------

export const accountRouter = Router();
accountRouter.use(['/auth/change-password', '/auth/logout-all', '/auth/sessions', '/me'], requireAuth);

/** First-login welcome screen was answered (or skipped). */
accountRouter.post('/me/onboarded', async (req, res) => {
  const me = currentUser(req);
  await users(() => prisma.user.update({ where: { id: me.id }, data: { onboarded_at: new Date() } }));
  res.json(await meView(me.id));
});

accountRouter.post('/auth/change-password', async (req, res) => {
  const me = currentUser(req);
  const body = parse(z.object({ current_password: zPassword, new_password: zPassword }), req.body);
  const user = await users(() => prisma.user.findUniqueOrThrow({ where: { id: me.id } }));
  if (!user.password_hash || !(await verifyPassword(body.current_password, user.password_hash))) {
    throw badRequest({ current_password: 'Current password is not correct' });
  }
  checkNewPassword(body.new_password, user.email, 'new_password');
  await users(async () => prisma.user.update({ where: { id: me.id }, data: { password_hash: await hashPassword(body.new_password) } }));
  await revokeAllSessions(me.id, currentSessionId(req));
  await securityEvent(me.id, 'PASSWORD_CHANGE', {}, req);
  res.json({ message: 'Password changed. Other devices were signed out.' });
});

accountRouter.post('/auth/logout-all', async (req, res) => {
  const me = currentUser(req);
  await revokeAllSessions(me.id);
  await securityEvent(me.id, 'LOGOUT_ALL', {}, req);
  clearSessionCookies(res);
  res.status(204).end();
});

accountRouter.get('/auth/sessions', async (req, res) => {
  const me = currentUser(req);
  const sid = currentSessionId(req);
  res.json({ data: (await listSessions(me.id)).map((s) => ({ ...s, current: s.id === sid })) });
});

accountRouter.delete('/auth/sessions/:sid', async (req, res) => {
  const me = currentUser(req);
  const { sid } = parse(z.object({ sid: z.string().uuid() }), req.params);
  const owned = await users(() => prisma.refreshToken.count({ where: { user_id: me.id, family_id: sid } }));
  if (!owned) throw new HttpError(404, 'NOT_FOUND', 'Session not found');
  await revokeFamily(sid);
  await securityEvent(me.id, 'LOGOUT', { session: sid, remote: true }, req);
  res.status(204).end();
});

accountRouter.get('/me', async (req, res) => {
  res.json(await meView(currentUser(req).id));
});

const updateMeSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(120).optional(),
    email: zEmail.optional(),
    current_password: zPassword.optional(),
  })
  .strict();

/** Change name immediately; an email change needs the password and is confirmed from the new inbox. */
accountRouter.patch('/me', async (req, res) => {
  const me = currentUser(req);
  const body = parse(updateMeSchema, req.body);
  const user = await users(() => prisma.user.findUniqueOrThrow({ where: { id: me.id } }));
  let emailChangePending = false;
  if (body.email && body.email !== user.email) {
    if (!user.password_hash || !body.current_password || !(await verifyPassword(body.current_password, user.password_hash))) {
      throw badRequest({ current_password: 'Enter your current password to change the email' });
    }
    enforce([{ key: `email-change:acct:${me.id}`, limit: config.rateLimit.emailPerAccount, windowMs: HOUR }]);
    const taken = await users(() => prisma.user.findUnique({ where: { email: body.email! } }));
    // A taken address gets no mail; the response is the same either way.
    if (!taken) {
      const token = await issueEmailToken(me.id, 'CHANGE_EMAIL', body.email);
      sendEmail(body.email, 'change-email', templates.changeEmail(user.name, token));
    }
    emailChangePending = true;
  }
  if (body.name && body.name !== user.name) await users(() => prisma.user.update({ where: { id: me.id }, data: { name: body.name } }));
  res.json({ ...(await meView(me.id)), email_change_pending: emailChangePending });
});

/** Settings the web app needs before login (no secrets). */
export const publicConfigRouter = Router();
publicConfigRouter.get('/config/public', (_req, res) => {
  res.json({
    turnstile_site_key: config.turnstile.enabled ? config.turnstile.siteKey : null,
    google_enabled: !!config.google.clientId,
    password_min_length: 10,
  });
});
