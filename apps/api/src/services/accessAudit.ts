/**
 * Access changes (invitations, collaborators, members) on the RCA's and the workspace's own audit log,
 * in addition to the personal security events of the people involved. Only owners see these rows
 * (they name invitees and failed attempts); see ACCESS_ENTITIES in the audit routes.
 */
import { prisma } from '../db.js';
import { writeAudit, type AuditAction } from '../lib/audit.js';
import { unscoped } from '../tenancy/context.js';

export const ACCESS_ENTITIES = ['invitations', 'rca_collaborators', 'workspace_members'];

export type AccessTarget = { rca_id: string | null; workspace_id: string | null };

/**
 * Write one access event. `target` is the invitation's (or membership's) target: an RCA or a
 * workspace. Runs unscoped because the actor may not have access yet (an invitee accepting).
 */
export async function accessAudit(e: {
  action: AuditAction;
  entity: 'invitations' | 'rca_collaborators' | 'workspace_members';
  entity_id: string;
  target: AccessTarget;
  user_id: string | null;
  detail: Record<string, unknown>;
}) {
  await unscoped('access audit (invitations and collaborators)', async () => {
    let workspaceId = e.target.workspace_id;
    if (e.target.rca_id && !workspaceId) {
      workspaceId = (await prisma.rca.findUnique({ where: { id: e.target.rca_id }, select: { workspace_id: true } }))?.workspace_id ?? null;
    }
    await writeAudit(prisma, {
      entity: e.entity,
      entity_id: e.entity_id,
      rca_id: e.target.rca_id,
      workspace_id: workspaceId,
      category: 'DATA',
      action: e.action,
      new_value: e.detail,
      user_id: e.user_id,
    });
  });
}

/** Name and email of the person an access change is about, so the audit row is readable on its own. */
export function personRef(userId: string) {
  return unscoped('audit: person reference', () => prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true } }));
}

