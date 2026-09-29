import type { Prisma } from '@prisma/client';
import type { Db } from '../db.js';
import { toJson } from './json.js';

export type AuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'SUBMIT'
  | 'SIGN'
  | 'CLOSE'
  | 'REOPEN'
  | 'EXPORT'
  | 'SEND_BACK'
  | 'ASSIGN'
  | 'SUPPORT_ACCESS'
  | 'BILLING'
  // Security events (category SECURITY)
  | 'SIGNUP'
  | 'LOGIN'
  | 'LOGIN_FAILED'
  | 'LOGOUT'
  | 'LOGOUT_ALL'
  | 'EMAIL_VERIFIED'
  | 'PASSWORD_CHANGE'
  | 'PASSWORD_RESET'
  | 'EMAIL_CHANGE'
  | 'INVITE'
  | 'INVITE_ACCEPT'
  | 'INVITE_REVOKE'
  | 'MEMBER_REMOVE'
  | 'ROLE_CHANGE'
  | 'ACCOUNT_DELETE'
  | 'DATA_EXPORT';

export interface AuditEntry {
  entity: string;
  entity_id: string;
  rca_id?: string | null;
  workspace_id?: string | null;
  category?: 'DATA' | 'SECURITY';
  action: AuditAction;
  old_value?: unknown;
  new_value?: unknown;
  user_id: string | null;
}

/** Append one immutable audit row. Call with the transaction client of the change it records. */
export async function writeAudit(db: Db, e: AuditEntry) {
  await db.auditLog.create({
    data: {
      entity: e.entity,
      entity_id: e.entity_id,
      rca_id: e.rca_id ?? null,
      workspace_id: e.workspace_id ?? null,
      category: e.category ?? 'DATA',
      action: e.action,
      old_value: (toJson(e.old_value) ?? undefined) as Prisma.InputJsonValue | undefined,
      new_value: (toJson(e.new_value) ?? undefined) as Prisma.InputJsonValue | undefined,
      user_id: e.user_id,
    },
  });
}

/** Audit row for a change inside an RCA (workspace filled in for filtering). */
export function rcaAudit(rca: { id: string; workspace_id: string }, e: Omit<AuditEntry, 'rca_id' | 'workspace_id'>): AuditEntry {
  return { ...e, rca_id: rca.id, workspace_id: rca.workspace_id };
}

/** Keep only the keys whose values changed, for compact UPDATE audit rows. */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const oldValue: Record<string, unknown> = {};
  const newValue: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    const a = JSON.stringify(toJson(before[key]));
    const b = JSON.stringify(toJson(after[key]));
    if (a !== b) {
      oldValue[key] = before[key] ?? null;
      newValue[key] = after[key] ?? null;
    }
  }
  return { old_value: oldValue, new_value: newValue };
}
