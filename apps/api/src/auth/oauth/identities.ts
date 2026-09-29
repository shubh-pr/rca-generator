/**
 * Accounts for provider identities: sign in, sign up, explicit linking from settings, and unlinking.
 * Sign-in matches (provider, provider_account_id) first. The email address is used only when the
 * provider says it is verified; otherwise linking and sign-up are refused (account takeover protection).
 */
import { Prisma, type IdentityProvider } from '@prisma/client';
import { prisma } from '../../db.js';
import { HttpError } from '../../lib/errors.js';
import { createAccount } from '../../services/accounts.js';
import { acceptPendingInvitationsFor } from '../../services/invitations.js';
import { unscoped } from '../../tenancy/context.js';
import { revokeAllSessions } from '../sessions.js';
import type { IdClaims, OidcProvider } from './providers.js';

export type SignInResult = { userId: string; created: boolean; linked: boolean } | { refused: RefusalCode };
export type RefusalCode = 'email_not_verified' | 'account_unavailable' | 'account_linked_elsewhere';
export type LinkResult = { ok: true } | { refused: 'identity_linked_elsewhere' | 'provider_already_linked' | 'account_unavailable' };

const unavailable = (u: { deleted_at: Date | null; is_active: boolean }) => !!u.deleted_at || !u.is_active;
const isUniqueViolation = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

/** Sign in or sign up with verified ID-token claims. */
export async function signInWithIdentity(p: OidcProvider, c: IdClaims, attempt = 0): Promise<SignInResult> {
  try {
    return await unscoped('oauth sign-in', async () => {
      const key = { provider_provider_account_id: { provider: p.db, provider_account_id: c.sub } };
      const known = await prisma.userIdentity.findUnique({ where: key, include: { user: true } });
      if (known) {
        if (unavailable(known.user)) return { refused: 'account_unavailable' as const };
        await prisma.userIdentity.update({ where: { id: known.id }, data: { last_used_at: new Date() } });
        return { userId: known.user_id, created: false, linked: false };
      }

      // A new identity: the email decides which account it belongs to, so it must be verified.
      const email = c.email?.trim().toLowerCase();
      if (!email || !p.emailVerified(c)) return { refused: 'email_not_verified' as const };

      const existing = await prisma.user.findUnique({ where: { email }, include: { identities: { where: { provider: p.db } } } });
      if (existing) {
        if (unavailable(existing)) return { refused: 'account_unavailable' as const };
        if (existing.identities.length) return { refused: 'account_linked_elsewhere' as const };
        const wasVerified = !!existing.email_verified_at;
        await prisma.$transaction(async (tx) => {
          await tx.userIdentity.create({ data: { user_id: existing.id, provider: p.db, provider_account_id: c.sub, email, last_used_at: new Date() } });
          await tx.user.update({
            where: { id: existing.id },
            // Nobody had proved control of this address before. A password set by whoever registered it
            // could belong to someone else, so it is removed (pre-registration takeover).
            data: wasVerified ? {} : { email_verified_at: new Date(), password_hash: null },
          });
        });
        if (!wasVerified) {
          await revokeAllSessions(existing.id);
          await acceptPendingInvitationsFor(existing);
        }
        return { userId: existing.id, created: false, linked: true };
      }

      const user = await createAccount({ name: (c.name?.trim() || email.split('@')[0]).slice(0, 120), email, password_hash: null, email_verified_at: new Date() });
      await prisma.userIdentity.create({ data: { user_id: user.id, provider: p.db, provider_account_id: c.sub, email, last_used_at: new Date() } });
      await acceptPendingInvitationsFor(user);
      return { userId: user.id, created: true, linked: true };
    });
  } catch (err) {
    // Two first sign-ins at once: the loser retries and finds what the winner created.
    if (isUniqueViolation(err) && attempt === 0) return signInWithIdentity(p, c, 1);
    throw err;
  }
}

/** Link an identity to the signed-in user (Account settings → Connected accounts). */
export async function linkIdentity(userId: string, p: OidcProvider, c: IdClaims): Promise<LinkResult> {
  return unscoped('oauth link', async () => {
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { identities: true } });
    if (!user || unavailable(user)) return { refused: 'account_unavailable' as const };
    const owner = await prisma.userIdentity.findUnique({ where: { provider_provider_account_id: { provider: p.db, provider_account_id: c.sub } } });
    if (owner) return owner.user_id === userId ? { ok: true as const } : { refused: 'identity_linked_elsewhere' as const };
    if (user.identities.some((i) => i.provider === p.db)) return { refused: 'provider_already_linked' as const };
    try {
      await prisma.userIdentity.create({ data: { user_id: userId, provider: p.db, provider_account_id: c.sub, email: c.email?.toLowerCase() ?? null } });
    } catch (err) {
      if (isUniqueViolation(err)) return { refused: 'identity_linked_elsewhere' as const };
      throw err;
    }
    return { ok: true as const };
  });
}

/** Remove a linked provider, unless it is the user's last way to sign in (409 LAST_LOGIN_METHOD). */
export async function unlinkIdentity(userId: string, provider: IdentityProvider) {
  return unscoped('oauth unlink', () =>
    prisma.$transaction(async (tx) => {
      // Serialise with other unlinks of this user so two parallel requests cannot remove both methods.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, include: { identities: true } });
      const identity = user.identities.find((i) => i.provider === provider);
      if (!identity) throw new HttpError(404, 'NOT_FOUND', 'This sign-in method is not connected');
      const methods = user.identities.length + (user.password_hash ? 1 : 0);
      if (methods <= 1) {
        throw new HttpError(409, 'LAST_LOGIN_METHOD', 'This is your only way to sign in. Set a password or connect another account before disconnecting it.');
      }
      await tx.userIdentity.delete({ where: { id: identity.id } });
    }),
  );
}

export async function listIdentities(userId: string) {
  return unscoped('list identities', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { identities: { orderBy: { linked_at: 'asc' } } } });
    return {
      has_password: !!user.password_hash,
      identities: user.identities.map((i) => ({ provider: i.provider, email: i.email, linked_at: i.linked_at, last_used_at: i.last_used_at })),
    };
  });
}
