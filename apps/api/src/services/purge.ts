import type { Tx } from '../db.js';
import { logger } from '../lib/logger.js';
import { storage } from '../storage/index.js';

/**
 * Hard-delete a workspace and everything in it, including its audit rows and stored files.
 * Must run inside an `unscoped` transaction; enables the audit purge exception for that transaction only.
 */
export async function purgeWorkspace(tx: Tx, workspaceId: string): Promise<{ rcas: number; files: string[] }> {
  await tx.$executeRawUnsafe(`SET LOCAL app.audit_purge = 'on'`);
  const files = (
    await tx.rcaAttachment.findMany({ where: { rca: { workspace_id: workspaceId }, file_path: { not: null } }, select: { file_path: true } })
  ).map((f) => f.file_path!);
  const rcas = await tx.rca.count({ where: { workspace_id: workspaceId } });
  await tx.auditLog.deleteMany({ where: { OR: [{ workspace_id: workspaceId }, { rca: { workspace_id: workspaceId } }] } });
  await tx.$executeRawUnsafe(`DELETE FROM rca_number_seq WHERE workspace_id = $1::uuid`, workspaceId);
  await tx.workspace.delete({ where: { id: workspaceId } });
  return { rcas, files };
}

/** Remove stored files after the database transaction committed. */
export async function removeStoredFiles(keys: string[]) {
  for (const key of keys) {
    await storage()
      .delete(key)
      .catch((err) => logger.warn('storage delete failed during purge', { error: String(err) }));
  }
}
