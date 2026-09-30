import type { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { currentUser } from '../auth/index.js';
import { verifyPassword } from '../auth/password.js';
import { enforce, MINUTE } from '../auth/rateLimit.js';
import { securityEvent } from '../auth/security.js';
import { clearSessionCookies } from '../auth/cookies.js';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { badRequest } from '../lib/errors.js';
import { pageResult, parsePage } from '../lib/pagination.js';
import { parse } from '../lib/validate.js';
import { streamDataExport } from '../services/dataExport.js';
import { blockingWorkspaces, softDeleteAccount } from '../services/lifecycle.js';
import { usageReport } from '../services/quota.js';
import { unscoped } from '../tenancy/context.js';

/** The current user's own data: usage, export, security log, account deletion. */
export const meDataRouter = Router();

meDataRouter.get('/me/usage', async (req, res) => {
  res.json(await usageReport(currentUser(req).id));
});

/**
 * Security events of this account (logins, password/email changes, invitations, exports, deletion),
 * plus the user's own RCA exports (stored on the RCA's log). `refs` resolves the ids already stored in
 * the events (RCA numbers, workspace names, people, invitations) so the log can say what happened;
 * nothing extra is recorded for this.
 */
meDataRouter.get('/me/security-events', async (req, res) => {
  const me = currentUser(req);
  const p = parsePage(req.query, ['at'], '-at');
  const where: Prisma.AuditLogWhereInput = { user_id: me.id, OR: [{ category: 'SECURITY' }, { category: 'DATA', action: 'EXPORT', entity: 'rca' }] };
  const [data, total] = await unscoped('own security log', () =>
    Promise.all([
      prisma.auditLog.findMany({ where, orderBy: [p.orderBy, { id: 'asc' }], skip: p.skip, take: p.take, select: { id: true, action: true, entity: true, new_value: true, at: true, workspace_id: true, rca_id: true } }),
      prisma.auditLog.count({ where }),
    ]),
  );
  res.json({ ...pageResult(data, total, p), refs: await securityRefs(data) });
});

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

/** Resolve the ids stored in these events (only fields needed to describe the user's own actions). */
async function securityRefs(rows: { rca_id: string | null; workspace_id: string | null; new_value: unknown }[]) {
  const rcaIds = new Set<string>();
  const wsIds = new Set<string>();
  const userIds = new Set<string>();
  const invIds = new Set<string>();
  for (const r of rows) {
    const v = (r.new_value ?? {}) as Record<string, unknown>;
    for (const id of [r.rca_id, str(v.rca_id)]) if (id) rcaIds.add(id);
    for (const id of [r.workspace_id, str(v.workspace_id)]) if (id) wsIds.add(id);
    for (const id of [str(v.user_id), str(v.target_user_id)]) if (id) userIds.add(id);
    if (str(v.invitation_id)) invIds.add(str(v.invitation_id)!);
  }
  return unscoped('resolve ids in own security log', async () => {
    const [rcas, workspaces, users, invitations] = await Promise.all([
      prisma.rca.findMany({ where: { id: { in: [...rcaIds] } }, select: { id: true, rca_number: true } }),
      prisma.workspace.findMany({ where: { id: { in: [...wsIds] } }, select: { id: true, name: true } }),
      prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, name: true, email: true } }),
      prisma.invitation.findMany({ where: { id: { in: [...invIds] } }, select: { id: true, email: true, role: true, team: true, rca_id: true, workspace_id: true } }),
    ]);
    return {
      rcas: Object.fromEntries(rcas.map((r) => [r.id, r.rca_number])),
      workspaces: Object.fromEntries(workspaces.map((w) => [w.id, w.name])),
      users: Object.fromEntries(users.map((u) => [u.id, { name: u.name, email: u.email }])),
      invitations: Object.fromEntries(invitations.map((i) => [i.id, { email: i.email, role: i.role, team: i.team, rca_id: i.rca_id, workspace_id: i.workspace_id }])),
    };
  });
}

/** Download all of my data as a zip (JSON + PDFs + my uploads). */
meDataRouter.get('/me/export', async (req, res) => {
  const me = currentUser(req);
  enforce([{ key: `data-export:${me.id}`, limit: 3, windowMs: 60 * MINUTE }]);
  await securityEvent(me.id, 'DATA_EXPORT', {}, req);
  const baseUrl = config.pdf.internalBaseUrlOverride ?? `http://127.0.0.1:${req.socket.localPort}`;
  await streamDataExport(me.id, res, baseUrl);
});

/** What blocks deletion, so the settings page can explain it before the user confirms. */
meDataRouter.get('/me/deletion-check', async (req, res) => {
  const me = currentUser(req);
  res.json({ blocking_workspaces: await blockingWorkspaces(me.id), grace_days: Math.round(config.accountDeletionGraceMs / 86_400_000) });
});

const deleteSchema = z.object({
  password: z.string().max(200).optional(),
  confirm: z.literal('DELETE', { error: 'Type DELETE to confirm' }),
});

/** Delete my account: blocked immediately, personal data erased after the grace period. */
meDataRouter.delete('/me', async (req, res) => {
  const me = currentUser(req);
  const body = parse(deleteSchema, req.body ?? {});
  const user = await unscoped('account deletion', () => prisma.user.findUniqueOrThrow({ where: { id: me.id } }));
  if (user.password_hash && !(body.password && (await verifyPassword(body.password, user.password_hash)))) {
    throw badRequest({ password: 'Enter your current password' });
  }
  const result = await softDeleteAccount(me.id);
  clearSessionCookies(res);
  res.json({ deleted: true, purge_after: result.purge_after });
});
