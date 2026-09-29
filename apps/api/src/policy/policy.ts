/**
 * The single authorization policy (docs/B2C_PLAN.md section 4). Routes never check roles themselves;
 * they call `authorize(ctx, action, resource)` or `can(...)`. State rules (locked, closed, versions)
 * stay in the services.
 */
import type { SignoffRole, Team, WorkspaceRole } from '@prisma/client';
import { forbidden } from '../lib/errors.js';

export const ROLE_RANK: Record<WorkspaceRole, number> = { OWNER: 4, EDITOR: 3, CONTRIBUTOR: 2, VIEWER: 1 };

/** Access of one user to one RCA, resolved by `loadRcaAccess`. */
export interface RcaAccessContext {
  userId: string;
  /** Highest of workspace membership and RCA collaborator role; VIEWER for support access. */
  role: WorkspaceRole;
  /** Teams a CONTRIBUTOR may edit (empty for other roles; OWNER/EDITOR edit every team). */
  teams: Team[];
  /** True when the access comes only from a platform-admin support grant. */
  isSupport: boolean;
  /** The user's role in the RCA's workspace (null for RCA-only collaborators). */
  workspaceRole?: WorkspaceRole | null;
  /** Set when billing reduced the user's role (collaborators without an active Team subscription). */
  readOnlyReason?: 'SUBSCRIPTION_INACTIVE' | null;
}

export type RcaAction =
  | 'rca.view'
  | 'rca.export'
  | 'rca.edit'
  | 'rca.delete'
  | 'rca.review'
  | 'rca.close'
  | 'rca.reopen'
  | 'section.edit'
  | 'section.unlock'
  | 'timeline.add'
  | 'timeline.edit'
  | 'followup.manage'
  | 'attachment.add'
  | 'attachment.delete'
  | 'signoff.sign'
  | 'signoff.assign'
  | 'audit.view'
  | 'collaborators.view'
  | 'collaborators.manage';

export interface Resource {
  team?: Team;
  uploaded_by?: string | null;
  assignee_user_id?: string | null;
}

const atLeast = (ctx: RcaAccessContext, role: WorkspaceRole) => ROLE_RANK[ctx.role] >= ROLE_RANK[role];

export function can(ctx: RcaAccessContext, action: RcaAction, resource: Resource = {}): boolean {
  if (ctx.isSupport) return action === 'rca.view' || action === 'audit.view';
  switch (action) {
    case 'rca.view':
    case 'rca.export':
    case 'audit.view':
    case 'collaborators.view':
      return true;
    case 'rca.edit':
    case 'rca.review':
    case 'rca.close':
    case 'rca.reopen':
    case 'section.unlock':
    case 'timeline.edit':
    case 'followup.manage':
    case 'signoff.assign':
      return atLeast(ctx, 'EDITOR');
    case 'rca.delete':
      return ctx.role === 'OWNER';
    case 'section.edit':
      if (atLeast(ctx, 'EDITOR')) return true;
      return ctx.role === 'CONTRIBUTOR' && !!resource.team && ctx.teams.includes(resource.team);
    case 'timeline.add':
    case 'attachment.add':
      return atLeast(ctx, 'CONTRIBUTOR');
    case 'attachment.delete':
      if (atLeast(ctx, 'EDITOR')) return true;
      return ctx.role === 'CONTRIBUTOR' && !!resource.uploaded_by && resource.uploaded_by === ctx.userId;
    case 'collaborators.manage':
      // Inviting people to an RCA is for owners of the RCA's workspace (SPEC_B2C: "a workspace owner can invite").
      return ctx.workspaceRole === 'OWNER';
    case 'signoff.sign':
      if (resource.assignee_user_id) return resource.assignee_user_id === ctx.userId;
      return atLeast(ctx, 'EDITOR');
    default: {
      const never: never = action;
      return never;
    }
  }
}

export function authorize(ctx: RcaAccessContext, action: RcaAction, resource?: Resource, message?: string): void {
  if (!can(ctx, action, resource)) throw forbidden(message);
}

// ---------- Workspace-level actions ----------

export type WorkspaceAction = 'workspace.view' | 'rca.create' | 'members.manage' | 'workspace.manage' | 'audit.view';

export function canInWorkspace(role: WorkspaceRole | null, action: WorkspaceAction): boolean {
  if (!role) return false;
  switch (action) {
    case 'workspace.view':
      return true;
    case 'rca.create':
    case 'audit.view':
      return ROLE_RANK[role] >= ROLE_RANK.EDITOR;
    case 'members.manage':
    case 'workspace.manage':
      return role === 'OWNER';
    default: {
      const never: never = action;
      return never;
    }
  }
}

/** Flags the web app uses to enable controls (the server still checks every request). */
export function permissionFlags(
  ctx: RcaAccessContext,
  signoffs: { role: SignoffRole; assignee_user_id: string | null }[],
  attachments: { id: string; uploaded_by: string | null }[],
) {
  const teams: Team[] = ['DEV', 'QA', 'PROD'];
  return {
    role: ctx.role,
    teams: ctx.teams,
    read_only_reason: ctx.readOnlyReason ?? null,
    support: ctx.isSupport,
    edit: can(ctx, 'rca.edit'),
    delete: can(ctx, 'rca.delete'),
    review: can(ctx, 'rca.review'),
    close: can(ctx, 'rca.close'),
    reopen: can(ctx, 'rca.reopen'),
    unlock_section: can(ctx, 'section.unlock'),
    add_timeline: can(ctx, 'timeline.add'),
    edit_timeline: can(ctx, 'timeline.edit'),
    manage_followups: can(ctx, 'followup.manage'),
    add_attachment: can(ctx, 'attachment.add'),
    assign_signoff: can(ctx, 'signoff.assign'),
    export: can(ctx, 'rca.export'),
    manage_collaborators: can(ctx, 'collaborators.manage'),
    edit_section: Object.fromEntries(teams.map((t) => [t, can(ctx, 'section.edit', { team: t })])) as Record<Team, boolean>,
    sign: Object.fromEntries(signoffs.map((s) => [s.role, can(ctx, 'signoff.sign', s)])) as Record<SignoffRole, boolean>,
    delete_attachment: Object.fromEntries(attachments.map((a) => [a.id, can(ctx, 'attachment.delete', a)])) as Record<string, boolean>,
  };
}
