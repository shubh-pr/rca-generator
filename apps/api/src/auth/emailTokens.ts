import type { EmailTokenType } from '@prisma/client';
import { prisma } from '../db.js';
import { unscoped } from '../tenancy/context.js';
import { randomToken, sha256 } from './tokens.js';

export const TOKEN_TTL_MS: Record<EmailTokenType, number> = {
  VERIFY_EMAIL: 24 * 3_600_000,
  CHANGE_EMAIL: 24 * 3_600_000,
  RESET_PASSWORD: 3_600_000,
};

/** New single-use token; earlier unused tokens of the same type are invalidated. */
export function issueEmailToken(userId: string, type: EmailTokenType, newEmail?: string) {
  return unscoped('issue email token', async () => {
    const token = randomToken();
    await prisma.$transaction([
      prisma.emailToken.updateMany({ where: { user_id: userId, type, used_at: null }, data: { used_at: new Date() } }),
      prisma.emailToken.create({
        data: { user_id: userId, type, token_hash: sha256(token), new_email: newEmail ?? null, expires_at: new Date(Date.now() + TOKEN_TTL_MS[type]) },
      }),
    ]);
    return token;
  });
}

/** Mark a token used and return it, or null when unknown, expired or already used. Atomic (single use). */
export function consumeEmailToken(token: string, types: EmailTokenType[]) {
  return unscoped('consume email token', async () => {
    const row = await prisma.emailToken.findUnique({ where: { token_hash: sha256(token) }, include: { user: true } });
    if (!row || !types.includes(row.type) || row.used_at || row.expires_at < new Date() || row.user.deleted_at) return null;
    const claimed = await prisma.emailToken.updateMany({ where: { id: row.id, used_at: null }, data: { used_at: new Date() } });
    return claimed.count === 1 ? row : null;
  });
}
