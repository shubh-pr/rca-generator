import { Prisma } from '@prisma/client';
import { currentScope, type TenantScope } from './context.js';

/** Thrown when tenant data is queried without a scope; always a programming error. */
export class TenantScopeError extends Error {}

type UserScope = Extract<TenantScope, { kind: 'user' }>;
type Where = Record<string, unknown>;

/** RCAs visible to the scope: in a member (or support) workspace, or shared directly. */
export function rcaVisible(s: UserScope): Where {
  return {
    OR: [{ workspace_id: { in: [...s.workspaceIds, ...s.supportWorkspaceIds] } }, { id: { in: s.rcaIds } }],
  };
}

/** Visibility filter per tenant model. Models not listed here are global (users, tokens, quotas…). */
const FILTERS: Record<string, (s: UserScope) => Where> = {
  Rca: rcaVisible,
  RcaTimeline: (s) => ({ rca: rcaVisible(s) }),
  RcaTeamSection: (s) => ({ rca: rcaVisible(s) }),
  RcaFollowup: (s) => ({ rca: rcaVisible(s) }),
  RcaAttachment: (s) => ({ rca: rcaVisible(s) }),
  RcaSignoff: (s) => ({ rca: rcaVisible(s) }),
  RcaCollaborator: (s) => ({ OR: [{ rca: rcaVisible(s) }, { user_id: s.userId }] }),
  RcaWhy: (s) => ({ section: { rca: rcaVisible(s) } }),
  RcaAction: (s) => ({ section: { rca: rcaVisible(s) } }),
  RcaNumberSeq: (s) => ({ workspace_id: { in: s.workspaceIds } }),
  Workspace: (s) => ({ id: { in: [...s.workspaceIds, ...s.supportWorkspaceIds] } }),
  WorkspaceMember: (s) => ({ OR: [{ workspace_id: { in: [...s.workspaceIds, ...s.supportWorkspaceIds] } }, { user_id: s.userId }] }),
  Invitation: (s) => ({ OR: [{ workspace_id: { in: s.workspaceIds } }, { rca: rcaVisible(s) }] }),
  AuditLog: (s) => ({
    OR: [
      { rca: rcaVisible(s) },
      { rca_id: null, workspace_id: { in: s.workspaceIds } },
      { category: 'SECURITY', user_id: s.userId },
    ],
  }),
};

/** Relations of User that lead into tenant data; reading them from a user row would bypass the filter. */
const USER_TENANT_RELATIONS = new Set([
  'owned_workspaces',
  'memberships',
  'collaborations',
  'created_rcas',
  'updated_rcas',
  'updated_sections',
  'owned_actions',
  'created_actions',
  'owned_followups',
  'created_followups',
  'created_timeline',
  'uploads',
  'signoffs',
  'assigned_signoffs',
  'audit_entries',
  'invitations_sent',
]);

const WHERE_OPS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
  'upsert',
]);
const CREATE_OPS = new Set(['create', 'createMany', 'createManyAndReturn', 'upsert']);

function withFilter(where: Where | undefined, filter: Where): Where {
  const w = where ?? {};
  const and = w.AND === undefined ? [] : Array.isArray(w.AND) ? w.AND : [w.AND];
  return { ...w, AND: [...and, filter] };
}

type Base = {
  rca: { count: (a: object) => Promise<number> };
  rcaTeamSection: { count: (a: object) => Promise<number> };
};

/** Parent checks for creates: the new row must hang off something the scope can see. */
async function checkCreate(base: Base, model: string, data: Record<string, unknown>, s: UserScope) {
  const fail = () => {
    throw new TenantScopeError(`Tenant scope violation: ${model}.create outside the current user's data`);
  };
  if (model === 'Rca') {
    if (!s.workspaceIds.includes(String(data.workspace_id))) fail();
    return;
  }
  if (model === 'AuditLog') return; // append-only log written by the server itself
  if (model === 'RcaNumberSeq') {
    if (!s.workspaceIds.includes(String(data.workspace_id))) fail();
    return;
  }
  if (model === 'Workspace') return; // creating a workspace creates a new tenant owned by the user
  if (model === 'WorkspaceMember') {
    if (!s.workspaceIds.includes(String(data.workspace_id)) && data.user_id !== s.userId) fail();
    return;
  }
  if (model === 'Invitation') {
    if (data.workspace_id) {
      if (!s.workspaceIds.includes(String(data.workspace_id))) fail();
      return;
    }
  }
  if (model === 'RcaWhy' || model === 'RcaAction') {
    const n = await base.rcaTeamSection.count({ where: { id: String(data.section_id), rca: rcaVisible(s) } });
    if (n === 0) fail();
    return;
  }
  if (typeof data.rca_id === 'string') {
    const n = await base.rca.count({ where: { id: data.rca_id, ...rcaVisible(s) } });
    if (n === 0) fail();
    return;
  }
  fail();
}

/**
 * Prisma extension that makes tenant scoping impossible to forget: every operation on a tenant model
 * gets the current user's visibility filter; without a scope it throws.
 */
export function tenantScopeExtension(base: Base) {
  return Prisma.defineExtension({
    name: 'tenant-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const filter = FILTERS[model];
          const scope = currentScope();
          const a = (args ?? {}) as Record<string, unknown>;
          if (model === 'User' && scope?.kind === 'user') {
            for (const key of ['include', 'select'] as const) {
              const sel = a[key] as Record<string, unknown> | undefined;
              if (sel && Object.keys(sel).some((k) => USER_TENANT_RELATIONS.has(k))) {
                throw new TenantScopeError(`Tenant scope violation: User.${operation} must not read tenant relations`);
              }
            }
          }
          if (!filter) return query(args);
          if (!scope) throw new TenantScopeError(`Tenant query ${model}.${operation} outside of a request scope`);
          if (scope.kind === 'unscoped') return query(args);

          if (CREATE_OPS.has(operation)) {
            const payload = operation === 'upsert' ? a.create : a.data;
            for (const row of Array.isArray(payload) ? payload : [payload]) {
              await checkCreate(base, model, (row ?? {}) as Record<string, unknown>, scope);
            }
          }
          if (WHERE_OPS.has(operation)) {
            a.where = withFilter(a.where as Where | undefined, filter(scope));
          }
          return query(a as typeof args);
        },
      },
    },
  });
}
