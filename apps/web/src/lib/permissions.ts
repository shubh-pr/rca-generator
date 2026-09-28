// Workspace-level helpers. RCA-level permissions come from the API (`rca.permissions`), evaluated by
// the server's policy module; the UI never re-implements role rules for an RCA.
import type { Me, WorkspaceRef } from '../api/types';

export const canCreateIn = (w: WorkspaceRef) => w.role === 'OWNER' || w.role === 'EDITOR';

/** Workspaces the user may create RCAs in. */
export const creatableWorkspaces = (u: Me | null) => (u?.workspaces ?? []).filter(canCreateIn);

/** Workspaces whose audit log the user may see (OWNER / EDITOR). */
export const auditWorkspaces = (u: Me | null) => (u?.workspaces ?? []).filter(canCreateIn);

export function homeFor(_u: Me): string {
  return '/dashboard';
}
