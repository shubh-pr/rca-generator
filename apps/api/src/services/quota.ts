/**
 * Usage limits per user (the primary owner of a workspace pays for it). Limits come from
 * usage_quotas overrides or the env defaults; this is the single place to plug in paid plans.
 */
import { config } from '../config.js';
import { prisma, type Tx } from '../db.js';
import { HttpError } from '../lib/errors.js';
import { currentScope, unscoped, withScope } from '../tenancy/context.js';

export const quotaExceeded = (message: string, details: Record<string, unknown>) => new HttpError(422, 'QUOTA_EXCEEDED', message, undefined, details);

export async function limitsFor(userId: string) {
  const row = await unscoped('quota limits', () => prisma.usageQuota.findUnique({ where: { user_id: userId } }));
  return {
    storageBytes: row?.storage_limit_bytes != null ? Number(row.storage_limit_bytes) : config.quota.storageBytes,
    rcaCount: row?.rca_limit ?? config.quota.rcaCount,
  };
}

/** Current usage, computed from the data (always correct), across workspaces the user primarily owns. */
export async function usageFor(db: Tx | typeof prisma, userId: string) {
  const [bytes, rcas] = await Promise.all([
    db.rcaAttachment.aggregate({ where: { rca: { workspace: { owner_id: userId } } }, _sum: { size: true } }),
    db.rca.count({ where: { is_deleted: false, workspace: { owner_id: userId } } }),
  ]);
  return { storageBytes: bytes._sum.size ?? 0, rcaCount: rcas };
}

async function snapshot(db: Tx, userId: string) {
  const u = await usageFor(db, userId);
  await db.usageQuota.upsert({
    where: { user_id: userId },
    update: { storage_bytes_used: BigInt(u.storageBytes), rca_count: u.rcaCount },
    create: { user_id: userId, storage_bytes_used: BigInt(u.storageBytes), rca_count: u.rcaCount },
  });
  return u;
}

/** Serialise quota checks of one user (advisory transaction lock) so parallel requests cannot overshoot. */
async function lockUser(tx: Tx, userId: string) {
  await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `quota:${userId}`);
}

/** Create a workspace owned by `userId` unless they already own the maximum (checked under the user's quota lock). */
export async function withinWorkspaceQuota<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return unscoped('workspace quota', () =>
    prisma.$transaction(async (tx) => {
      await lockUser(tx, userId);
      const owned = await tx.workspace.count({ where: { owner_id: userId } });
      const limit = config.quota.ownedWorkspaces;
      if (owned >= limit) throw quotaExceeded(`You can own up to ${limit} workspaces. Delete one you no longer need.`, { limit, used: owned });
      return fn(tx);
    }),
  );
}

export async function ownerOfWorkspace(workspaceId: string) {
  return (await unscoped('workspace owner for quota', () => prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { owner_id: true } }))).owner_id;
}

/**
 * Run `fn(tx)` only if the workspace owner stays within limits after adding `add`. The check and the
 * change happen in ONE transaction under the owner's advisory lock; `fn` must write through `tx`.
 */
export async function withinQuota<T>(workspaceId: string, add: { rcas?: number; bytes?: number }, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const callerScope = currentScope();
  const ownerId = await ownerOfWorkspace(workspaceId);
  const limits = await limitsFor(ownerId);
  const result = await unscoped('quota check', () =>
    prisma.$transaction(
      async (tx) => {
        await lockUser(tx, ownerId);
        const u = await usageFor(tx, ownerId);
        if (add.rcas && u.rcaCount + add.rcas > limits.rcaCount) {
          throw quotaExceeded(`RCA limit reached (${limits.rcaCount}). Delete RCAs you no longer need.`, { limit: limits.rcaCount, used: u.rcaCount });
        }
        if (add.bytes && u.storageBytes + add.bytes > limits.storageBytes) {
          const mb = (n: number) => Math.round((n / 1024 / 1024) * 10) / 10;
          throw quotaExceeded(`Storage limit reached (${mb(limits.storageBytes)} MB). Remove attachments you no longer need.`, {
            limit_bytes: limits.storageBytes,
            used_bytes: u.storageBytes,
          });
        }
        // The change itself runs in the caller's tenant scope, not in the quota check's.
        return callerScope ? withScope(callerScope, () => fn(tx)) : fn(tx);
      },
      { timeout: 30_000, maxWait: 15_000 },
    ),
  );
  await refreshUsage(ownerId).catch(() => {});
  return result;
}

export function refreshUsage(userId: string) {
  return unscoped('usage snapshot', () => prisma.$transaction((tx) => snapshot(tx, userId)));
}

export async function usageReport(userId: string) {
  const [u, limits] = await Promise.all([unscoped('usage report', () => usageFor(prisma, userId)), limitsFor(userId)]);
  return { storage_bytes_used: u.storageBytes, storage_limit_bytes: limits.storageBytes, rca_count: u.rcaCount, rca_limit: limits.rcaCount };
}
