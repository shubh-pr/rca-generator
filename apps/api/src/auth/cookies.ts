import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { HttpError } from '../lib/errors.js';
import { randomToken, safeEqual } from './tokens.js';

export const REFRESH_COOKIE = 'rca_rt';
export const CSRF_COOKIE = 'rca_csrf';
export const CSRF_HEADER = 'x-csrf-token';

const base = () => ({
  secure: config.cookieSecure,
  sameSite: 'lax' as const,
  domain: config.cookieDomain,
});

/**
 * Refresh token: httpOnly, only sent to /api/v1/auth. CSRF token: readable by the web app, which echoes
 * it in X-CSRF-Token on the cookie-authenticated requests (double-submit).
 */
export function setSessionCookies(res: Response, refreshToken: string) {
  res.cookie(REFRESH_COOKIE, refreshToken, { ...base(), httpOnly: true, path: '/api/v1/auth', maxAge: config.refreshTokenTtlMs });
  res.cookie(CSRF_COOKIE, randomToken(), { ...base(), httpOnly: false, path: '/', maxAge: config.refreshTokenTtlMs });
}

export function clearSessionCookies(res: Response) {
  res.clearCookie(REFRESH_COOKIE, { ...base(), path: '/api/v1/auth' });
  res.clearCookie(CSRF_COOKIE, { ...base(), path: '/' });
}

/** CSRF protection for the endpoints authenticated by the refresh cookie (refresh, logout). */
export function requireCsrf(req: Request, _res: Response, next: NextFunction) {
  const origin = req.headers.origin;
  if (origin && origin !== config.corsOrigin) throw new HttpError(403, 'CSRF', 'Cross-site request refused');
  const cookie = req.cookies?.[CSRF_COOKIE];
  const header = req.get(CSRF_HEADER);
  if (!cookie || !header || !safeEqual(String(cookie), header)) throw new HttpError(403, 'CSRF', 'Missing or invalid CSRF token');
  next();
}
