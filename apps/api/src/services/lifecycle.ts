/**
 * Account lifecycle: soft delete (immediate) and hard delete after the grace period (scheduled job).
 * GDPR Art. 17 / DPDP s.12: personal data and files are erased; other tenants' records keep working
 * with the user's references anonymised.
 */
import { revokeAllSessions } from '../auth/sessions.js';
import { securityEvent } from '../auth/security.js';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { sendEmail, templates } from '../email/index.js';
import { conflict } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { unscoped } from '../tenancy/context.js';
import { purgeWorkspace, removeStoredFiles } from './purge.js';

/**
 * Shared workspaces that block deletion: the user is their only OWNER while other people are members.
 * (Workspaces with no other members are deleted with the account; co-owned ones are handed over.)
 */
export async function blockingWorkspaces(userId: string) {
  return unscoped('deletion check', async () => {
    const owned = await prisma.workspaceMember.findMany({ where: { user_id: userId, role: 'OWNER' }, include: { workspace: true } });
    const blocking: { id: string; name: string }[] = [];
    for (const m of owned) {
      if (m.workspace.is_personal) continue;
      const [otherOwners, others] = await Promise.all([
        prisma.workspaceMember.count({ where: { workspace_id: m.workspace_id, role: 'OWNER', NOT: { user_id: userId } } }),
        prisma.workspaceMember.count({ where: { workspace_id: m.workspace_id, NOT: { user_id: userId } } }),
      ]);
      if (others > 0 && otherOwners === 0) blocking.push({ id: m.workspace.id, name: m.workspace.name });
    }
    return blocking;
  });
}

/** Soft delete: the account cannot log in from now on; data is erased after the grace period. */
export async function softDeleteAccount(userId: string) {
  const blocking = await blockingWorkspaces(userId);
  if (blocking.length) {
    throw conflict('Transfer ownership of these shared workspaces, or delete them, before deleting your account', { workspaces: blocking });
  }
  const purgeAfter = new Date(Date.now() + config.accountDeletionGraceMs);
  const user = await unscoped('soft delete account', () =>
    prisma.$transaction(async (tx) => {
      // Co-owned shared workspaces the user primarily owns are handed to another owner now.
      const primary = await tx.workspace.findMany({ where: { owner_id: userId, is_personal: false } });
      for (const ws of primary) {
        const next = await tx.workspaceMember.findFirst({ where: { workspace_id: ws.id, role: 'OWNER', NOT: { user_id: userId } }, orderBy: { created_at: 'asc' } });
        if (next) await tx.workspace.update({ where: { id: ws.id }, data: { owner_id: next.user_id } });
      }
      // Pending invitations sent by the user stop working.
      await tx.invitation.updateMany({ where: { invited_by: userId, accepted_at: null, revoked_at: null }, data: { revoked_at: new Date() } });
      return tx.user.update({ where: { id: userId }, data: { deleted_at: new Date(), purge_after: purgeAfter } });
    }),
  );
  await revokeAllSessions(userId);
  await securityEvent(userId, 'ACCOUNT_DELETE', { purge_after: purgeAfter });
  sendEmail(user.email, 'account-deleted', templates.accountDeleted(user.name, Math.round(config.accountDeletionGraceMs / 86_400_000)));
  return { purge_after: purgeAfter };
}

/** Hard delete one soft-deleted account and everything that is only theirs. */
export async function purgeAccount(userId: string) {
  return unscoped('purge account', async () => {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.deleted_at) return { purged: false };
    const files: string[] = [];
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.audit_purge = 'on'`);
        // Workspaces still primarily owned by the user (personal, or shared without other members).
        const owned = await tx.workspace.findMany({ where: { owner_id: userId } });
        for (const ws of owned) {
          const others = await tx.workspaceMember.count({ where: { workspace_id: ws.id, NOT: { user_id: userId } } });
          if (others > 0) {
            // Someone joined after the deletion request: hand over instead of deleting their data.
            const next = await tx.workspaceMember.findFirst({ where: { workspace_id: ws.id, NOT: { user_id: userId } }, orderBy: { created_at: 'asc' } });
            await tx.workspaceMember.update({ where: { id: next!.id }, data: { role: 'OWNER', team: null } });
            await tx.workspace.update({ where: { id: ws.id }, data: { owner_id: next!.user_id } });
            continue;
          }
          files.push(...(await purgeWorkspace(tx, ws.id)).files);
        }
        // In other tenants' RCAs: actions they owned go to that workspace's primary owner.
        const actions = await tx.rcaAction.findMany({ where: { owner_id: userId }, select: { id: true, section: { select: { rca: { select: { workspace: { select: { owner_id: true } } } } } } } });
        for (const a of actions) await tx.rcaAction.update({ where: { id: a.id }, data: { owner_id: a.section.rca.workspace.owner_id } });
        // Their own security log goes; data-change rows elsewhere keep the event without the person.
        await tx.auditLog.deleteMany({ where: { category: 'SECURITY', user_id: userId } });
        await tx.auditLog.updateMany({ where: { user_id: userId }, data: { user_id: null } });
        // Remaining references (created_by, uploaded_by, signed by, assignees) are nulled by the FKs; tokens,
        // memberships, collaborations, quotas and grants cascade.
        await tx.user.delete({ where: { id: userId } });
      },
      { timeout: 120_000 },
    );
    await removeStoredFiles(files);
    return { purged: true, files: files.length };
  });
}

/** Scheduled job: purge every account whose grace period has ended. Serialised across instances. */
export async function purgeDueAccounts(now = new Date()) {
  return unscoped('account purge job', () =>
    prisma.$transaction(
      async (tx) => {
        // Transaction-scoped lock: released automatically, never leaks on a pooled connection.
        const lock = await tx.$queryRawUnsafe<{ locked: boolean }[]>(`SELECT pg_try_advisory_xact_lock(hashtext('rca:purge-accounts')) AS locked`);
        if (!lock[0]?.locked) return { skipped: true };
        const due = await prisma.user.findMany({ where: { deleted_at: { not: null }, purge_after: { lte: now } }, select: { id: true } });
        let purged = 0;
        for (const u of due) {
          try {
            if ((await purgeAccount(u.id)).purged) purged += 1;
          } catch (err) {
            logger.error('account purge failed', { user_id: u.id, error: String(err) });
          }
        }
        // Housekeeping: expired tokens and old support grants.
        const dayAgo = new Date(now.getTime() - 86_400_000);
        await prisma.refreshToken.deleteMany({ where: { expires_at: { lt: dayAgo } } });
        await prisma.emailToken.deleteMany({ where: { expires_at: { lt: dayAgo } } });
        await prisma.supportGrant.deleteMany({ where: { expires_at: { lt: new Date(now.getTime() - 90 * 86_400_000) } } });
        return { purged, due: due.length };
      },
      { timeout: 30 * 60_000, maxWait: 10_000 },
    ),
  );
}
