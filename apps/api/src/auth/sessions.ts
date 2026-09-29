import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { unscoped } from '../tenancy/context.js';
import { signAccessToken } from './jwt.js';
import { randomToken, sha256 } from './tokens.js';

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  familyId: string;
}

async function issue(userId: string, familyId: string, userAgent: string | undefined): Promise<IssuedSession & { id: string }> {
  const refreshToken = randomToken();
  const row = await prisma.refreshToken.create({
    data: {
      user_id: userId,
      family_id: familyId,
      token_hash: sha256(refreshToken),
      expires_at: new Date(Date.now() + config.refreshTokenTtlMs),
      user_agent: userAgent?.slice(0, 255) ?? null,
      last_used_at: new Date(),
    },
  });
  return { id: row.id, accessToken: signAccessToken({ sub: userId, sid: familyId }), refreshToken, familyId };
}

/** New login session (new refresh-token family). */
export function createSession(userId: string, userAgent?: string): Promise<IssuedSession> {
  return unscoped('create session', () => issue(userId, randomUUID(), userAgent));
}

export type RotateResult = { ok: true; session: IssuedSession; userId: string } | { ok: false; reason: 'invalid' | 'expired' | 'reused' };

/**
 * Rotate a refresh token: the presented token is revoked and replaced. Presenting a token that was
 * already rotated means it was stolen or replayed, so the whole session family is revoked.
 */
export function rotateRefreshToken(presented: string, userAgent?: string): Promise<RotateResult> {
  return unscoped('rotate refresh token', async () => {
    const row = await prisma.refreshToken.findUnique({ where: { token_hash: sha256(presented) }, include: { user: true } });
    if (!row) return { ok: false, reason: 'invalid' } as const;
    if (row.revoked_at) {
      await revokeFamily(row.family_id);
      return { ok: false, reason: 'reused' } as const;
    }
    if (row.expires_at < new Date() || row.user.deleted_at || !row.user.is_active) return { ok: false, reason: 'expired' } as const;
    return prisma.$transaction(async (tx) => {
      // Compare-and-set: two parallel refreshes with the same token cannot both succeed.
      const claimed = await tx.refreshToken.updateMany({ where: { id: row.id, revoked_at: null }, data: { revoked_at: new Date() } });
      if (claimed.count === 0) return { ok: false, reason: 'reused' } as const;
      const next = await issue(row.user_id, row.family_id, userAgent ?? row.user_agent ?? undefined);
      await tx.refreshToken.update({ where: { id: row.id }, data: { replaced_by_id: next.id } });
      return { ok: true, session: next, userId: row.user_id } as const;
    });
  });
}

export const revokeFamily = (familyId: string) =>
  unscoped('revoke session', () => prisma.refreshToken.updateMany({ where: { family_id: familyId, revoked_at: null }, data: { revoked_at: new Date() } }));

/** Revoke every session of the user, optionally keeping one (the current device). */
export const revokeAllSessions = (userId: string, exceptFamilyId?: string) =>
  unscoped('revoke all sessions', () =>
    prisma.refreshToken.updateMany({
      where: { user_id: userId, revoked_at: null, ...(exceptFamilyId ? { NOT: { family_id: exceptFamilyId } } : {}) },
      data: { revoked_at: new Date() },
    }),
  );

/** A session is active while its family has an unrevoked, unexpired refresh token. */
export async function isSessionActive(userId: string, familyId: string): Promise<boolean> {
  const n = await unscoped('check session', () =>
    prisma.refreshToken.count({ where: { user_id: userId, family_id: familyId, revoked_at: null, expires_at: { gt: new Date() } } }),
  );
  return n > 0;
}

/** Active sessions of the user (one row per login), newest activity first. */
export async function listSessions(userId: string) {
  const rows = await unscoped('list sessions', () =>
    prisma.refreshToken.findMany({ where: { user_id: userId, revoked_at: null, expires_at: { gt: new Date() } }, orderBy: { created_at: 'asc' } }),
  );
  const first = await unscoped('session start times', () =>
    prisma.refreshToken.groupBy({ by: ['family_id'], where: { family_id: { in: rows.map((r) => r.family_id) } }, _min: { created_at: true } }),
  );
  return rows
    .map((r) => ({
      id: r.family_id,
      user_agent: r.user_agent,
      created_at: first.find((f) => f.family_id === r.family_id)?._min.created_at ?? r.created_at,
      last_used_at: r.last_used_at ?? r.created_at,
    }))
    .sort((a, b) => b.last_used_at.getTime() - a.last_used_at.getTime());
}
