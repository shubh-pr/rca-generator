import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export interface TokenClaims {
  sub: string;
  /** Session (refresh-token family) id; must still be active on every request. */
  sid: string;
}

/** Short-lived access token, kept in memory by the web app (never in localStorage). */
export function signAccessToken(claims: TokenClaims): string {
  return jwt.sign(claims, config.jwtSecret, { expiresIn: config.accessTokenTtlSeconds, algorithm: 'HS256' });
}

export function verifyAccessToken(token: string): TokenClaims | null {
  try {
    const decoded = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    if (typeof decoded === 'string' || typeof decoded.sub !== 'string' || typeof decoded.sid !== 'string') return null;
    return { sub: decoded.sub, sid: decoded.sid };
  } catch {
    return null;
  }
}
