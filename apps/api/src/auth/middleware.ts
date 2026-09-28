import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../db.js';
import { unauthorized } from '../lib/errors.js';
import type { AuthUser } from '../lib/permissions.js';
import { verifyAccessToken } from './jwt.js';

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

/** Require a valid bearer token for an active user; sets req.user. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw unauthorized();
  const claims = verifyAccessToken(token);
  if (!claims) throw unauthorized('Invalid or expired token');
  const user = await prisma.user.findUnique({ where: { id: claims.sub } });
  if (!user || !user.is_active) throw unauthorized('User is inactive or no longer exists');
  req.user = { id: user.id, name: user.name, email: user.email, role: user.role, team: user.team };
  next();
}

/** Current user; only valid after requireAuth. */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
