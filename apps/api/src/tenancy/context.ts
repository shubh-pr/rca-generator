import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * What the current request may see. Set by the auth middleware for every authenticated request;
 * background work must opt out explicitly with `unscoped()`.
 */
export type TenantScope =
  | {
      kind: 'user';
      userId: string;
      /** Workspaces the user is a member of. */
      workspaceIds: string[];
      /** RCAs shared with the user directly (rca_collaborators). */
      rcaIds: string[];
      /** Workspaces a platform admin can read through an active, audited support grant. */
      supportWorkspaceIds: string[];
    }
  | { kind: 'unscoped'; reason: string };

const storage = new AsyncLocalStorage<TenantScope>();

export function runWithScope<T>(scope: TenantScope, fn: () => T): T {
  return storage.run(scope, fn);
}

/**
 * Run tenant queries without the visibility filter (auth flows, jobs, scripts). Always give a reason.
 * The result is awaited inside the context: Prisma queries are lazy and would otherwise execute after
 * the context has been left.
 */
export function unscoped<T>(reason: string, fn: () => T | PromiseLike<T>): Promise<T> {
  return storage.run({ kind: 'unscoped', reason }, async () => await fn());
}

/** Like runWithScope for async work (awaits inside the scope; see `unscoped`). */
export function withScope<T>(scope: TenantScope, fn: () => T | PromiseLike<T>): Promise<T> {
  return storage.run(scope, async () => await fn());
}

export function currentScope(): TenantScope | undefined {
  return storage.getStore();
}
