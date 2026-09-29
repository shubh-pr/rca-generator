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

/** Security events of this account (logins, password/email changes, invitations, exports, deletion). */
meDataRouter.get('/me/security-events', async (req, res) => {
  const me = currentUser(req);
  const p = parsePage(req.query, ['at'], '-at');
  const where = { category: 'SECURITY', user_id: me.id };
  const [data, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: [p.orderBy, { id: 'asc' }], skip: p.skip, take: p.take, select: { id: true, action: true, new_value: true, at: true, workspace_id: true } }),
    prisma.auditLog.count({ where }),
  ]);
  res.json(pageResult(data, total, p));
});

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
