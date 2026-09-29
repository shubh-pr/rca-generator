import type { Request } from 'express';
import { prisma } from '../db.js';
import { writeAudit, type AuditAction } from '../lib/audit.js';
import { unscoped } from '../tenancy/context.js';

/**
 * Security event for a user's own log (login, password/email change, invitations, export, delete).
 * Only the user agent is kept, no IP address.
 */
export function securityEvent(userId: string, action: AuditAction, detail: Record<string, unknown> = {}, req?: Request) {
  const ua = req?.get('user-agent');
  return unscoped('security event', () =>
    writeAudit(prisma, {
      entity: 'users',
      entity_id: userId,
      category: 'SECURITY',
      action,
      new_value: { ...detail, ...(ua ? { user_agent: ua.slice(0, 200) } : {}) },
      user_id: userId,
    }),
  );
}
