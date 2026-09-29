import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../db.js';
import { unauthorized } from '../lib/errors.js';
import type { AuthUser } from '../policy/access.js';
import { runWithScope, unscoped, type TenantScope } from '../tenancy/context.js';
import { verifyAccessToken } from './jwt.js';
import { isSessionActive } from './sessions.js';

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
    sessionId?: string;
  }
}

/** Workspaces, directly shared RCAs and active support grants of a user. */
export async function buildScope(userId: string, isPlatformAdmin: boolean): Promise<TenantScope> {
  return unscoped('resolve tenant scope for the authenticated user', async () => {
    const [members, collabs, grants] = await Promise.all([
      prisma.workspaceMember.findMany({ where: { user_id: userId }, select: { workspace_id: true } }),
      prisma.rcaCollaborator.findMany({ where: { user_id: userId }, select: { rca_id: true } }),
      isPlatformAdmin
        ? prisma.supportGrant.findMany({ where: { admin_user_id: userId, expires_at: { gt: new Date() } }, select: { workspace_id: true } })
        : Promise.resolve([]),
    ]);
    return {
      kind: 'user' as const,
      userId,
      workspaceIds: members.map((m) => m.workspace_id),
      rcaIds: collabs.map((c) => c.rca_id),
      supportWorkspaceIds: grants.map((g) => g.workspace_id),
    };
  });
}

/**
 * Require a valid bearer token for an active user; sets req.user and runs the rest of the request
 * inside that user's tenant scope.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw unauthorized();
  const claims = verifyAccessToken(token);
  if (!claims) throw unauthorized('Invalid or expired token');
  const user = await prisma.user.findUnique({ where: { id: claims.sub } });
  if (!user || !user.is_active || user.deleted_at) throw unauthorized('User is inactive or no longer exists');
  // Logging out (or "log out of all devices") ends the session immediately, not when the token expires.
  if (!(await isSessionActive(user.id, claims.sid))) throw unauthorized('Session ended. Please log in again.');
  req.sessionId = claims.sid;
  req.user = {
    id: user.id,
    name: user.name,
    email: user.email,
    email_verified_at: user.email_verified_at,
    is_platform_admin: user.is_platform_admin,
  };
  const scope = await buildScope(user.id, user.is_platform_admin);
  runWithScope(scope, () => next());
}

/** Current user; only valid after requireAuth. */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

export function currentSessionId(req: Request): string | undefined {
  return req.sessionId;
}
