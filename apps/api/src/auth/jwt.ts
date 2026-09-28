import jwt, { type SignOptions } from 'jsonwebtoken';
import { config } from '../config.js';

export interface TokenClaims {
  sub: string;
  /** Session (refresh-token family) id; checked on every request once sessions exist. */
  sid?: string;
}

export function signAccessToken(claims: TokenClaims): string {
  return jwt.sign(claims, config.jwtSecret, { expiresIn: config.jwtExpiresIn as SignOptions['expiresIn'] });
}

export function verifyAccessToken(token: string): TokenClaims | null {
  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    if (typeof decoded === 'string' || typeof decoded.sub !== 'string') return null;
    return { sub: decoded.sub, sid: typeof decoded.sid === 'string' ? decoded.sid : undefined };
  } catch {
    return null;
  }
}
