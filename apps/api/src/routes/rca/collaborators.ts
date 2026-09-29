import { Router } from 'express';
import { z } from 'zod';
import { currentUser } from '../../auth/index.js';
import { securityEvent } from '../../auth/security.js';
import { prisma } from '../../db.js';
import { notFound } from '../../lib/errors.js';
import { parse, zUuid } from '../../lib/validate.js';
import { authorize } from '../../policy/policy.js';
import { checkRoleTeam, createInvitation } from '../../services/invitations.js';
import { rcaOf } from './access.js';
import { assertCanInvite } from '../../billing/entitlements.js';

/** People invited to this one RCA (not the whole workspace), and their invitations. */
export const collaboratorsRouter = Router({ mergeParams: true });

const zRole = z.enum(['EDITOR', 'CONTRIBUTOR', 'VIEWER']);
const zTeam = z.enum(['DEV', 'QA', 'PROD']);
const uidParam = (req: { params: Record<string, string> }) => parse(z.object({ uid: zUuid }), { uid: req.params.uid }).uid;

collaboratorsRouter.get('/collaborators', async (req, res) => {
  const { rca, ctx } = rcaOf(req);
  authorize(ctx, 'collaborators.view');
  const rows = await prisma.rcaCollaborator.findMany({ where: { rca_id: rca.id }, include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { created_at: 'asc' } });
  res.json({ data: rows.map((c) => ({ user_id: c.user.id, name: c.user.name, email: c.user.email, role: c.role, team: c.team })) });
});

collaboratorsRouter.patch('/collaborators/:uid', async (req, res) => {
  const me = currentUser(req);
  const { rca, ctx } = rcaOf(req);
  authorize(ctx, 'collaborators.manage', undefined, 'Only workspace owners can manage who has access to this RCA');
  const uid = uidParam(req);
  const body = parse(z.object({ role: zRole, team: zTeam.nullable().optional() }).strict(), req.body);
  checkRoleTeam(body.role, body.team, true);
  const c = await prisma.rcaCollaborator.findFirst({ where: { rca_id: rca.id, user_id: uid } });
  if (!c) throw notFound('Collaborator not found');
  const updated = await prisma.rcaCollaborator.update({ where: { id: c.id }, data: { role: body.role, team: body.team ?? null } });
  await securityEvent(me.id, 'ROLE_CHANGE', { rca_id: rca.id, user_id: uid, from: c.role, to: body.role, team: body.team ?? null }, req);
  res.json(updated);
});

collaboratorsRouter.delete('/collaborators/:uid', async (req, res) => {
  const me = currentUser(req);
  const { rca, ctx } = rcaOf(req);
  authorize(ctx, 'collaborators.manage', undefined, 'Only workspace owners can manage who has access to this RCA');
  const uid = uidParam(req);
  const c = await prisma.rcaCollaborator.findFirst({ where: { rca_id: rca.id, user_id: uid } });
  if (!c) throw notFound('Collaborator not found');
  await prisma.$transaction(async (tx) => {
    await tx.rcaCollaborator.delete({ where: { id: c.id } });
    await tx.rcaSignoff.updateMany({ where: { rca_id: rca.id, assignee_user_id: uid, signed_at: null }, data: { assignee_user_id: null } });
  });
  await securityEvent(me.id, 'MEMBER_REMOVE', { rca_id: rca.id, user_id: uid }, req);
  res.status(204).end();
});

const inviteSchema = z.object({ email: z.string().trim().toLowerCase().email('Enter a valid email').max(180), role: zRole, team: zTeam.nullable().optional() }).strict();

collaboratorsRouter.get('/invitations', async (req, res) => {
  const { rca, ctx } = rcaOf(req);
  authorize(ctx, 'collaborators.manage', undefined, 'Only workspace owners can see invitations');
  const data = await prisma.invitation.findMany({
    where: { rca_id: rca.id, accepted_at: null, revoked_at: null, expires_at: { gt: new Date() } },
    select: { id: true, email: true, role: true, team: true, expires_at: true, created_at: true },
    orderBy: { created_at: 'desc' },
  });
  res.json({ data });
});

collaboratorsRouter.post('/invitations', async (req, res) => {
  const me = currentUser(req);
  const { rca, ctx } = rcaOf(req);
  authorize(ctx, 'collaborators.manage', undefined, 'Only workspace owners can invite people to this RCA');
  const body = parse(inviteSchema, req.body);
  checkRoleTeam(body.role, body.team, true);
  await assertCanInvite(prisma, await prisma.workspace.findUniqueOrThrow({ where: { id: rca.workspace_id } }));
  const inv = await createInvitation(me, { rca_id: rca.id }, body);
  res.status(201).json({ id: inv.id, email: inv.email, role: inv.role, team: inv.team, expires_at: inv.expires_at });
});

collaboratorsRouter.delete('/invitations/:iid', async (req, res) => {
  const me = currentUser(req);
  const { rca, ctx } = rcaOf(req);
  authorize(ctx, 'collaborators.manage');
  const { iid } = parse(z.object({ iid: zUuid }), { iid: req.params.iid });
  const inv = await prisma.invitation.findFirst({ where: { id: iid, rca_id: rca.id, accepted_at: null, revoked_at: null } });
  if (!inv) throw notFound('Invitation not found');
  await prisma.invitation.update({ where: { id: iid }, data: { revoked_at: new Date() } });
  await securityEvent(me.id, 'INVITE_REVOKE', { invitation_id: iid, rca_id: rca.id }, req);
  res.status(204).end();
});
