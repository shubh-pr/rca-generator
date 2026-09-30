import { Router } from 'express';
import { z } from 'zod';
import { currentUser, requireAuth } from '../auth/index.js';
import { enforce, HOUR } from '../auth/rateLimit.js';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { acceptInvitation, logDeadInvitationLink, lookupInvitation, maskEmail } from '../services/invitations.js';
import { unscoped } from '../tenancy/context.js';

/** Invitation links: a public lookup (no RCA or workspace content) and an authenticated accept. */
export const invitationsRouter = Router();

const tokenSchema = z.object({ token: z.string().min(10).max(200) });

invitationsRouter.get('/invitations/lookup', async (req, res) => {
  enforce([{ key: `invite-lookup:ip:${req.ip}`, limit: config.rateLimit.emailPerIp * 10, windowMs: HOUR }]);
  const { token } = parse(tokenSchema, { token: req.query.token });
  const inv = await lookupInvitation(token);
  if (!inv) {
    await logDeadInvitationLink(token);
    throw notFound('This invitation is invalid, expired or was already used');
  }
  const hasAccount = !!(await unscoped('invitation lookup', () => prisma.user.findUnique({ where: { email: inv.email }, select: { id: true } })));
  res.json({
    target: inv.workspace_id ? 'workspace' : 'rca',
    role: inv.role,
    team: inv.team,
    inviter_name: inv.inviter?.name ?? 'Someone',
    email: maskEmail(inv.email),
    has_account: hasAccount,
    expires_at: inv.expires_at,
  });
});

invitationsRouter.post('/invitations/accept', requireAuth, async (req, res) => {
  const me = currentUser(req);
  const { token } = parse(tokenSchema, req.body);
  const inv = await acceptInvitation(token, me);
  res.json({ accepted: true, workspace_id: inv.workspace_id, rca_id: inv.rca_id });
});
