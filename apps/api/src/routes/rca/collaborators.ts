import { Router } from 'express';
import { z } from 'zod';
import { currentUser } from '../../auth/index.js';
import { securityEvent } from '../../auth/security.js';
import { accessAudit, personRef } from '../../services/accessAudit.js';
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
  // Read fresh on every open: a contributor whose section is submitted (or whose RCA is not a draft) has nothing to edit.
  const sections = await prisma.rcaTeamSection.findMany({ where: { rca_id: rca.id }, select: { team: true, section_status: true } });
  const status = await prisma.rca.findUniqueOrThrow({ where: { id: rca.id }, select: { status: true } });
  res.json({
    data: rows.map((c) => {
      const section = c.team ? sections.find((s) => s.team === c.team) : undefined;
      return {
        user_id: c.user.id,
        name: c.user.name,
        email: c.user.email,
        role: c.role,
        team: c.team,
        section_status: section?.section_status ?? null,
        nothing_to_edit: c.role === 'CONTRIBUTOR' && (section?.section_status === 'SUBMITTED' || status.status !== 'DRAFT'),
      };
    }),
  });
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
  await accessAudit({
    action: 'ROLE_CHANGE',
    entity: 'rca_collaborators',
    entity_id: c.id,
    target: { rca_id: rca.id, workspace_id: rca.workspace_id },
    user_id: me.id,
    detail: { person: await personRef(uid), from: { role: c.role, team: c.team }, to: { role: body.role, team: body.team ?? null } },
  });
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
  await accessAudit({
    action: 'MEMBER_REMOVE',
    entity: 'rca_collaborators',
    entity_id: c.id,
    target: { rca_id: rca.id, workspace_id: rca.workspace_id },
    user_id: me.id,
    detail: { person: await personRef(uid), role: c.role, team: c.team },
  });
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
  await accessAudit({
    action: 'INVITE_REVOKE',
    entity: 'invitations',
    entity_id: iid,
    target: { rca_id: rca.id, workspace_id: rca.workspace_id },
    user_id: me.id,
    detail: { invitation_id: iid, email: inv.email, role: inv.role, team: inv.team },
  });
  res.status(204).end();
});
