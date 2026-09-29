import { Router, type Request } from 'express';
import { z } from 'zod';
import { currentUser } from '../auth/index.js';
import { securityEvent } from '../auth/security.js';
import { prisma } from '../db.js';
import { writeAudit } from '../lib/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { parse, zUuid } from '../lib/validate.js';
import { canInWorkspace, type WorkspaceAction } from '../policy/policy.js';
import { cappedRole } from '../policy/access.js';
import { assertCanInvite } from '../billing/entitlements.js';
import { checkRoleTeam, createInvitation } from '../services/invitations.js';
import { purgeWorkspace, removeStoredFiles } from '../services/purge.js';
import { unscoped } from '../tenancy/context.js';

export const workspacesRouter = Router();

const zRole = z.enum(['OWNER', 'EDITOR', 'CONTRIBUTOR', 'VIEWER']);
const zTeam = z.enum(['DEV', 'QA', 'PROD']);
const wid = (req: Request) => parse(z.object({ wid: zUuid }), { wid: req.params.wid }).wid;

/** The workspace and the caller's role; 404 when not a member (existence is not revealed). */
async function workspaceFor(req: Request, action: WorkspaceAction) {
  const me = currentUser(req);
  const id = wid(req);
  const [ws, member] = await Promise.all([
    prisma.workspace.findFirst({ where: { id } }),
    prisma.workspaceMember.findFirst({ where: { workspace_id: id, user_id: me.id } }),
  ]);
  if (!ws || !member) throw notFound('Workspace not found');
  // Without an active Team subscription, everyone but the primary owner is read-only.
  member.role = cappedRole(member.role, me.id, ws) ?? member.role;
  if (!canInWorkspace(member.role, action)) throw forbidden(action === 'members.manage' || action === 'workspace.manage' ? 'Only workspace owners can do this' : undefined);
  return { me, ws, member };
}

workspacesRouter.get('/workspaces', async (req, res) => {
  const me = currentUser(req);
  const rows = await prisma.workspaceMember.findMany({
    where: { user_id: me.id },
    include: { workspace: { select: { id: true, name: true, is_personal: true, owner_id: true, plan: true } } },
    orderBy: { created_at: 'asc' },
  });
  res.json({ data: rows.map((m) => ({ ...m.workspace, role: m.role, team: m.team })) });
});

const nameSchema = z.object({ name: z.string().trim().min(1, 'Name is required').max(120) }).strict();

/** A shared workspace for a team; the creator is its OWNER. */
workspacesRouter.post('/workspaces', async (req, res) => {
  const me = currentUser(req);
  const { name } = parse(nameSchema, req.body);
  const ws = await prisma.workspace.create({ data: { name, owner_id: me.id, members: { create: { user_id: me.id, role: 'OWNER' } } } });
  await securityEvent(me.id, 'CREATE', { workspace_id: ws.id, name }, req);
  res.status(201).json({ ...ws, role: 'OWNER', team: null });
});

workspacesRouter.patch('/workspaces/:wid', async (req, res) => {
  const { ws } = await workspaceFor(req, 'workspace.manage');
  const { name } = parse(nameSchema, req.body);
  res.json(await prisma.workspace.update({ where: { id: ws.id }, data: { name } }));
});

/** Delete a shared workspace and everything in it. Personal workspaces go with the account. */
workspacesRouter.delete('/workspaces/:wid', async (req, res) => {
  const { me, ws } = await workspaceFor(req, 'workspace.manage');
  const { confirm_name } = parse(z.object({ confirm_name: z.string() }), req.body ?? {});
  if (ws.is_personal) throw badRequest({ confirm_name: 'Your personal workspace is deleted together with your account' });
  if (confirm_name !== ws.name) throw badRequest({ confirm_name: 'Type the workspace name to confirm' });
  const { files, rcas } = await unscoped('delete workspace (owner confirmed)', () => prisma.$transaction((tx) => purgeWorkspace(tx, ws.id)));
  await removeStoredFiles(files);
  await securityEvent(me.id, 'DELETE', { workspace_id: ws.id, name: ws.name, rcas }, req);
  res.status(204).end();
});

workspacesRouter.get('/workspaces/:wid/members', async (req, res) => {
  const { ws } = await workspaceFor(req, 'workspace.view');
  const rows = await prisma.workspaceMember.findMany({
    where: { workspace_id: ws.id },
    include: { user: { select: { id: true, name: true, email: true, deleted_at: true } } },
    orderBy: { created_at: 'asc' },
  });
  res.json({
    data: rows
      .filter((m) => !m.user.deleted_at)
      .map((m) => ({ user_id: m.user.id, name: m.user.name, email: m.user.email, role: m.role, team: m.team, is_primary_owner: m.user.id === ws.owner_id })),
  });
});

async function ownerCount(workspaceId: string) {
  return prisma.workspaceMember.count({ where: { workspace_id: workspaceId, role: 'OWNER' } });
}

workspacesRouter.patch('/workspaces/:wid/members/:uid', async (req, res) => {
  const { me, ws } = await workspaceFor(req, 'members.manage');
  const { uid } = parse(z.object({ uid: zUuid }), { uid: req.params.uid });
  const body = parse(z.object({ role: zRole, team: zTeam.nullable().optional() }).strict(), req.body);
  checkRoleTeam(body.role, body.team, false);
  const member = await prisma.workspaceMember.findFirst({ where: { workspace_id: ws.id, user_id: uid } });
  if (!member) throw notFound('Member not found');
  if (member.role === 'OWNER' && body.role !== 'OWNER') {
    if (uid === ws.owner_id) throw conflict('Transfer ownership before changing the primary owner\'s role');
    if ((await ownerCount(ws.id)) <= 1) throw conflict('A workspace needs at least one owner');
  }
  const updated = await prisma.workspaceMember.update({ where: { id: member.id }, data: { role: body.role, team: body.team ?? null } });
  await securityEvent(me.id, 'ROLE_CHANGE', { workspace_id: ws.id, user_id: uid, from: member.role, to: body.role, team: body.team ?? null }, req);
  res.json(updated);
});

/** Owners remove members; any member may remove themselves (leave). */
workspacesRouter.delete('/workspaces/:wid/members/:uid', async (req, res) => {
  const me = currentUser(req);
  const { uid } = parse(z.object({ uid: zUuid }), { uid: req.params.uid });
  const { ws, member: mine } = await workspaceFor(req, 'workspace.view');
  if (uid !== me.id && !canInWorkspace(mine.role, 'members.manage')) throw forbidden('Only workspace owners can remove members');
  const member = await prisma.workspaceMember.findFirst({ where: { workspace_id: ws.id, user_id: uid } });
  if (!member) throw notFound('Member not found');
  if (uid === ws.owner_id) throw conflict('Transfer ownership before removing the primary owner');
  if (member.role === 'OWNER' && (await ownerCount(ws.id)) <= 1) throw conflict('A workspace needs at least one owner');
  await prisma.$transaction(async (tx) => {
    await tx.workspaceMember.delete({ where: { id: member.id } });
    // Sign-off rows assigned to them in this workspace go back to "any owner or editor".
    await tx.rcaSignoff.updateMany({ where: { assignee_user_id: uid, signed_at: null, rca: { workspace_id: ws.id } }, data: { assignee_user_id: null } });
  });
  await securityEvent(me.id, 'MEMBER_REMOVE', { workspace_id: ws.id, user_id: uid }, req);
  res.status(204).end();
});

/** Make another member the primary owner (the account whose quota the workspace uses). */
workspacesRouter.post('/workspaces/:wid/transfer', async (req, res) => {
  const { me, ws } = await workspaceFor(req, 'members.manage');
  const { user_id } = parse(z.object({ user_id: zUuid }).strict(), req.body);
  if (ws.owner_id !== me.id) throw forbidden('Only the primary owner can transfer the workspace');
  if (ws.is_personal) throw badRequest({ user_id: 'A personal workspace cannot be transferred' });
  const target = await prisma.workspaceMember.findFirst({ where: { workspace_id: ws.id, user_id } });
  if (!target) throw badRequest({ user_id: 'The new owner must be a member of the workspace' });
  await prisma.$transaction(async (tx) => {
    await tx.workspaceMember.update({ where: { id: target.id }, data: { role: 'OWNER', team: null } });
    await tx.workspace.update({ where: { id: ws.id }, data: { owner_id: user_id } });
    await writeAudit(tx, { entity: 'workspaces', entity_id: ws.id, workspace_id: ws.id, category: 'SECURITY', action: 'ROLE_CHANGE', old_value: { owner_id: me.id }, new_value: { owner_id: user_id }, user_id: me.id });
  });
  res.json(await prisma.workspace.findFirst({ where: { id: ws.id } }));
});

// ---------- Workspace invitations ----------

const inviteSchema = z.object({ email: z.string().trim().toLowerCase().email('Enter a valid email').max(180), role: zRole, team: zTeam.nullable().optional() }).strict();

workspacesRouter.get('/workspaces/:wid/invitations', async (req, res) => {
  const { ws } = await workspaceFor(req, 'members.manage');
  const data = await prisma.invitation.findMany({
    where: { workspace_id: ws.id, accepted_at: null, revoked_at: null, expires_at: { gt: new Date() } },
    select: { id: true, email: true, role: true, team: true, expires_at: true, created_at: true },
    orderBy: { created_at: 'desc' },
  });
  res.json({ data });
});

workspacesRouter.post('/workspaces/:wid/invitations', async (req, res) => {
  const { me, ws } = await workspaceFor(req, 'members.manage');
  const body = parse(inviteSchema, req.body);
  checkRoleTeam(body.role, body.team, false);
  if (ws.is_personal && body.role === 'OWNER') throw badRequest({ role: 'A personal workspace has a single owner' });
  await assertCanInvite(prisma, ws);
  const inv = await createInvitation(me, { workspace_id: ws.id }, body);
  res.status(201).json({ id: inv.id, email: inv.email, role: inv.role, team: inv.team, expires_at: inv.expires_at });
});

workspacesRouter.delete('/workspaces/:wid/invitations/:iid', async (req, res) => {
  const { me, ws } = await workspaceFor(req, 'members.manage');
  const { iid } = parse(z.object({ iid: zUuid }), { iid: req.params.iid });
  const inv = await prisma.invitation.findFirst({ where: { id: iid, workspace_id: ws.id, accepted_at: null, revoked_at: null } });
  if (!inv) throw notFound('Invitation not found');
  await prisma.invitation.update({ where: { id: iid }, data: { revoked_at: new Date() } });
  await securityEvent(me.id, 'INVITE_REVOKE', { invitation_id: iid, workspace_id: ws.id }, req);
  res.status(204).end();
});

// ---------- Labels ----------

/** Company and project names already used in the workspace, for autocomplete. */
workspacesRouter.get('/workspaces/:wid/labels', async (req, res) => {
  const { ws } = await workspaceFor(req, 'workspace.view');
  const [companies, projects] = await Promise.all([
    prisma.rca.findMany({ where: { workspace_id: ws.id, company_name: { not: null } }, distinct: ['company_name'], select: { company_name: true }, take: 200 }),
    prisma.rca.findMany({ where: { workspace_id: ws.id, project_name: { not: null } }, distinct: ['project_name'], select: { project_name: true }, take: 200 }),
  ]);
  res.json({ companies: companies.map((c) => c.company_name!).sort(), projects: projects.map((p) => p.project_name!).sort() });
});
