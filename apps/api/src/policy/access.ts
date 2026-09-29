import type { Team, WorkspaceRole } from '@prisma/client';
import type { Db } from '../db.js';
import { notFound } from '../lib/errors.js';
import { currentScope } from '../tenancy/context.js';
import { ROLE_RANK, type RcaAccessContext } from './policy.js';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  email_verified_at: Date | null;
  is_platform_admin: boolean;
}

function higher(a: WorkspaceRole | null, b: WorkspaceRole | null): WorkspaceRole | null {
  if (!a) return b;
  if (!b) return a;
  return ROLE_RANK[a] >= ROLE_RANK[b] ? a : b;
}

/**
 * Resolve the user's access to an RCA. Anything the user cannot see is a 404 (never 403), so the
 * existence of other tenants' RCAs does not leak.
 */
export async function loadRcaAccess(db: Db, user: AuthUser, rcaId: string) {
  // The tenant extension already limits this lookup to visible RCAs.
  const rca = await db.rca.findFirst({ where: { id: rcaId, is_deleted: false } });
  if (!rca) throw notFound('RCA not found');
  const [member, collaborator] = await Promise.all([
    db.workspaceMember.findFirst({ where: { workspace_id: rca.workspace_id, user_id: user.id } }),
    db.rcaCollaborator.findFirst({ where: { rca_id: rca.id, user_id: user.id } }),
  ]);
  const role = higher(member?.role ?? null, collaborator?.role ?? null);
  const scope = currentScope();
  const support = scope?.kind === 'user' && scope.supportWorkspaceIds.includes(rca.workspace_id);
  if (!role && !support) throw notFound('RCA not found');
  const teams = new Set<Team>();
  if (member?.role === 'CONTRIBUTOR' && member.team) teams.add(member.team);
  if (collaborator?.role === 'CONTRIBUTOR' && collaborator.team) teams.add(collaborator.team);
  const ctx: RcaAccessContext = {
    userId: user.id,
    role: role ?? 'VIEWER',
    teams: [...teams],
    isSupport: !role && support,
    workspaceRole: member?.role ?? null,
  };
  return { rca, ctx };
}

export type RcaAccess = Awaited<ReturnType<typeof loadRcaAccess>>;

/** The user's role in a workspace, or null. */
export async function workspaceRole(db: Db, userId: string, workspaceId: string): Promise<WorkspaceRole | null> {
  const m = await db.workspaceMember.findFirst({ where: { workspace_id: workspaceId, user_id: userId } });
  return m?.role ?? null;
}

/** People who can be picked as action owners, follow-up owners or sign-off assignees on an RCA. */
export async function rcaParticipants(db: Db, rca: { id: string; workspace_id: string }) {
  const [members, collaborators] = await Promise.all([
    db.workspaceMember.findMany({ where: { workspace_id: rca.workspace_id }, include: { user: { select: { id: true, name: true, email: true, deleted_at: true } } } }),
    db.rcaCollaborator.findMany({ where: { rca_id: rca.id }, include: { user: { select: { id: true, name: true, email: true, deleted_at: true } } } }),
  ]);
  const byId = new Map<string, { id: string; name: string; email: string; role: WorkspaceRole; team: Team | null }>();
  for (const m of [...members, ...collaborators]) {
    if (m.user.deleted_at) continue;
    const prev = byId.get(m.user.id);
    if (!prev || ROLE_RANK[m.role] > ROLE_RANK[prev.role]) {
      byId.set(m.user.id, { id: m.user.id, name: m.user.name, email: m.user.email, role: m.role, team: m.team ?? prev?.team ?? null });
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}
