/**
 * Platform operator endpoints (users.is_platform_admin). They never return RCA content. The only way
 * to read a workspace's RCAs is the audited, time-limited support grant.
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import { currentUser } from '../auth/index.js';
import { securityEvent } from '../auth/security.js';
import { revokeAllSessions } from '../auth/sessions.js';
import { prisma } from '../db.js';
import { writeAudit } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { pageResult, parsePage } from '../lib/pagination.js';
import { parse, zUuid } from '../lib/validate.js';
import { unscoped } from '../tenancy/context.js';

export const adminRouter = Router();

/** Non-admins get 404, so the admin surface is not discoverable. */
function requireAdmin(req: Request) {
  const me = currentUser(req);
  if (!me.is_platform_admin) throw notFound('Route not found');
  return me;
}

adminRouter.get('/admin/users', async (req, res) => {
  requireAdmin(req);
  const { q } = parse(z.object({ q: z.string().trim().max(180).optional() }), { q: req.query.q || undefined });
  const p = parsePage(req.query, ['created_at', 'email'], '-created_at');
  const where = q ? { OR: [{ email: { contains: q, mode: 'insensitive' as const } }, { name: { contains: q, mode: 'insensitive' as const } }] } : {};
  const [data, total] = await unscoped('platform admin: list users', () =>
    Promise.all([
      prisma.user.findMany({
        where,
        select: { id: true, name: true, email: true, created_at: true, email_verified_at: true, last_login_at: true, deleted_at: true, is_active: true, is_platform_admin: true },
        orderBy: p.orderBy,
        skip: p.skip,
        take: p.take,
      }),
      prisma.user.count({ where }),
    ]),
  );
  res.json(pageResult(data, total, p));
});

/** Workspace metadata only (name, owner, counts): no RCA content. */
adminRouter.get('/admin/workspaces', async (req, res) => {
  requireAdmin(req);
  const { owner_id } = parse(z.object({ owner_id: zUuid.optional() }), { owner_id: req.query.owner_id || undefined });
  const p = parsePage(req.query, ['created_at'], '-created_at');
  const where = owner_id ? { members: { some: { user_id: owner_id } } } : {};
  const [rows, total] = await unscoped('platform admin: list workspaces', () =>
    Promise.all([
      prisma.workspace.findMany({
        where,
        select: { id: true, name: true, is_personal: true, created_at: true, owner: { select: { id: true, email: true } }, _count: { select: { members: true, rcas: true } } },
        orderBy: p.orderBy,
        skip: p.skip,
        take: p.take,
      }),
      prisma.workspace.count({ where }),
    ]),
  );
  res.json(pageResult(rows.map(({ _count, ...w }) => ({ ...w, member_count: _count.members, rca_count: _count.rcas })), total, p));
});

const grantSchema = z.object({
  workspace_id: zUuid,
  reason: z.string().trim().min(10, 'Describe the support or abuse case (at least 10 characters)').max(1000),
  minutes: z.number().int().min(5).max(240).default(60),
});

/**
 * Audited support access: read-only access to one workspace for a limited time. The event is written
 * to the workspace's own audit log, so its owners can see it.
 */
adminRouter.post('/admin/support-access', async (req, res) => {
  const me = requireAdmin(req);
  const body = parse(grantSchema, req.body);
  const ws = await unscoped('support access: workspace lookup', () => prisma.workspace.findUnique({ where: { id: body.workspace_id } }));
  if (!ws) throw badRequest({ workspace_id: 'Workspace not found' });
  const grant = await unscoped('support access: create grant', () =>
    prisma.$transaction(async (tx) => {
      const g = await tx.supportGrant.create({
        data: { admin_user_id: me.id, workspace_id: ws.id, reason: body.reason, expires_at: new Date(Date.now() + body.minutes * 60_000) },
      });
      await writeAudit(tx, {
        entity: 'workspaces',
        entity_id: ws.id,
        workspace_id: ws.id,
        category: 'DATA',
        action: 'SUPPORT_ACCESS',
        new_value: { grant_id: g.id, reason: body.reason, expires_at: g.expires_at, operator: me.name },
        user_id: me.id,
      });
      return g;
    }),
  );
  await securityEvent(me.id, 'SUPPORT_ACCESS', { workspace_id: ws.id, grant_id: grant.id }, req);
  res.status(201).json(grant);
});

adminRouter.delete('/admin/support-access/:gid', async (req, res) => {
  const me = requireAdmin(req);
  const { gid } = parse(z.object({ gid: zUuid }), req.params);
  const n = await unscoped('support access: end grant', () =>
    prisma.supportGrant.updateMany({ where: { id: gid, admin_user_id: me.id, expires_at: { gt: new Date() } }, data: { expires_at: new Date() } }),
  );
  if (!n.count) throw notFound('Grant not found');
  res.status(204).end();
});

/** Abuse handling: disable (and sign out) or re-enable an account. */
const toggleUser = (disable: boolean) => async (req: Request, res: import('express').Response) => {
  const me = requireAdmin(req);
  const { uid } = parse(z.object({ uid: zUuid }), { uid: req.params.uid });
  if (uid === me.id) throw badRequest({ uid: 'You cannot disable your own account' });
  const user = await unscoped('platform admin: toggle user', () => prisma.user.update({ where: { id: uid }, data: { is_active: !disable } }).catch(() => null));
  if (!user) throw notFound('User not found');
  if (disable) await revokeAllSessions(uid);
  await securityEvent(me.id, disable ? 'ACCOUNT_DELETE' : 'ROLE_CHANGE', { target_user_id: uid, action: disable ? 'disabled' : 'enabled' }, req);
  res.json({ id: user.id, is_active: user.is_active });
};

adminRouter.post('/admin/users/:uid/disable', toggleUser(true));
adminRouter.post('/admin/users/:uid/enable', toggleUser(false));
