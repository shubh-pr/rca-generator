import type { Team, WorkspaceRole } from '@prisma/client';
import { randomToken, sha256 } from '../auth/tokens.js';
import { securityEvent } from '../auth/security.js';
import { prisma } from '../db.js';
import { sendEmail, templates } from '../email/index.js';
import { badRequest, conflict } from '../lib/errors.js';
import { unscoped } from '../tenancy/context.js';
import { accessAudit } from './accessAudit.js';

export const INVITE_TTL_MS = 7 * 86_400_000;

export interface InviteInput {
  email: string;
  role: WorkspaceRole;
  team?: Team | null;
}

export function checkRoleTeam(role: WorkspaceRole, team: Team | null | undefined, rcaLevel: boolean) {
  if (role === 'CONTRIBUTOR' && rcaLevel && !team) throw badRequest({ team: 'Choose the team section this contributor may edit' });
  if (role !== 'CONTRIBUTOR' && team) throw badRequest({ team: 'Only contributors have a team' });
}

/**
 * Invite someone to a workspace or an RCA. A repeated invitation to the same target replaces the
 * pending one. The email names the inviter and role only, never RCA content.
 */
export async function createInvitation(inviter: { id: string; name: string }, target: { workspace_id: string } | { rca_id: string }, input: InviteInput) {
  const email = input.email.toLowerCase();
  const existingUser = await unscoped('invitee lookup', () => prisma.user.findUnique({ where: { email } }));
  if (existingUser) {
    const already =
      'workspace_id' in target
        ? await prisma.workspaceMember.findFirst({ where: { workspace_id: target.workspace_id, user_id: existingUser.id } })
        : await prisma.rcaCollaborator.findFirst({ where: { rca_id: target.rca_id, user_id: existingUser.id } });
    if (already) throw conflict('This person already has access. Change their role in the list of people with access instead.');
  }
  const token = randomToken();
  const invitation = await prisma.$transaction(async (tx) => {
    await tx.invitation.updateMany({ where: { email, ...target, accepted_at: null, revoked_at: null }, data: { revoked_at: new Date() } });
    return tx.invitation.create({
      data: {
        email,
        ...target,
        role: input.role,
        team: input.team ?? null,
        token_hash: sha256(token),
        invited_by: inviter.id,
        expires_at: new Date(Date.now() + INVITE_TTL_MS),
      },
    });
  });
  sendEmail(email, 'invitation', templates.invitation(inviter.name, 'workspace_id' in target ? 'workspace' : 'rca', input.role, token));
  await securityEvent(inviter.id, 'INVITE', { invitation_id: invitation.id, email, role: input.role, team: input.team ?? null, ...target });
  await accessAudit({
    action: 'INVITE',
    entity: 'invitations',
    entity_id: invitation.id,
    target: { rca_id: invitation.rca_id, workspace_id: invitation.workspace_id },
    user_id: inviter.id,
    detail: { invitation_id: invitation.id, email, role: input.role, team: input.team ?? null, expires_at: invitation.expires_at },
  });
  return invitation;
}

/** Public details of an invitation (no RCA content, no workspace data). */
export async function lookupInvitation(token: string) {
  const inv = await unscoped('invitation lookup by token', () =>
    prisma.invitation.findUnique({ where: { token_hash: sha256(token) }, include: { inviter: { select: { name: true } } } }),
  );
  if (!inv || inv.revoked_at || inv.accepted_at || inv.expires_at < new Date()) return null;
  return inv;
}

type Invitation = NonNullable<Awaited<ReturnType<typeof lookupInvitation>>>;

/**
 * Apply one invitation to a user (inside an unscoped context: the user is not a member yet). If the
 * user already has access by the time they accept, the invitation's role and team are applied (never
 * silently kept from before). The workspace's primary owner is never changed by an invitation.
 */
async function apply(inv: Invitation | { id: string; email: string; workspace_id: string | null; rca_id: string | null; role: WorkspaceRole; team: Team | null }, userId: string) {
  let previous: { role: WorkspaceRole; team: Team | null } | null = null;
  const done = await prisma.$transaction(async (tx) => {
    const claimed = await tx.invitation.updateMany({ where: { id: inv.id, accepted_at: null, revoked_at: null }, data: { accepted_at: new Date(), accepted_by: userId } });
    if (claimed.count === 0) return false;
    if (inv.workspace_id) {
      const existing = await tx.workspaceMember.findFirst({ where: { workspace_id: inv.workspace_id, user_id: userId }, include: { workspace: { select: { owner_id: true } } } });
      if (!existing) await tx.workspaceMember.create({ data: { workspace_id: inv.workspace_id, user_id: userId, role: inv.role, team: inv.team } });
      else if (existing.workspace.owner_id !== userId && (existing.role !== inv.role || existing.team !== inv.team)) {
        previous = { role: existing.role, team: existing.team };
        await tx.workspaceMember.update({ where: { id: existing.id }, data: { role: inv.role, team: inv.team } });
      }
    } else if (inv.rca_id) {
      const existing = await tx.rcaCollaborator.findFirst({ where: { rca_id: inv.rca_id, user_id: userId } });
      if (!existing) await tx.rcaCollaborator.create({ data: { rca_id: inv.rca_id, user_id: userId, role: inv.role, team: inv.team } });
      else if (existing.role !== inv.role || existing.team !== inv.team) {
        previous = { role: existing.role, team: existing.team };
        await tx.rcaCollaborator.update({ where: { id: existing.id }, data: { role: inv.role, team: inv.team } });
      }
    }
    return true;
  });
  if (!done) return;
  const detail = { invitation_id: inv.id, email: inv.email, role: inv.role, team: inv.team, ...(previous ? { previous } : {}) };
  await securityEvent(userId, 'INVITE_ACCEPT', { ...detail, workspace_id: inv.workspace_id, rca_id: inv.rca_id });
  await accessAudit({ action: 'INVITE_ACCEPT', entity: 'invitations', entity_id: inv.id, target: { rca_id: inv.rca_id, workspace_id: inv.workspace_id }, user_id: userId, detail });
}

type AcceptFailure = 'invalid_token' | 'expired' | 'already_used' | 'revoked' | 'wrong_account' | 'email_not_verified';

/**
 * A failed attempt to accept: logged for the person trying (security log) and, when the invitation is
 * known, on its RCA/workspace audit log so the owner can see what happened.
 */
async function acceptFailed(reason: AcceptFailure, user: { id: string; email: string }, inv: { id: string; email: string; rca_id: string | null; workspace_id: string | null; expires_at: Date } | null) {
  const detail = { reason, invitation_id: inv?.id ?? null, invited_email: inv?.email ?? null, attempted_by_email: user.email, ...(inv ? { expires_at: inv.expires_at } : {}) };
  await securityEvent(user.id, 'INVITE_ACCEPT_FAILED', { ...detail, rca_id: inv?.rca_id ?? null, workspace_id: inv?.workspace_id ?? null });
  if (inv) await accessAudit({ action: 'INVITE_ACCEPT_FAILED', entity: 'invitations', entity_id: inv.id, target: { rca_id: inv.rca_id, workspace_id: inv.workspace_id }, user_id: user.id, detail });
}

/** Accept by token: the invitation must be for the user's verified email address. */
export async function acceptInvitation(token: string, user: { id: string; email: string; email_verified_at: Date | null }) {
  const inv = await lookupInvitation(token);
  if (!inv) {
    // Find out why, for the audit log (the user still gets the same generic message).
    const any = await unscoped('diagnose invitation token', () => prisma.invitation.findUnique({ where: { token_hash: sha256(token) } }));
    const reason: AcceptFailure = !any ? 'invalid_token' : any.accepted_at ? 'already_used' : any.revoked_at ? 'revoked' : 'expired';
    await acceptFailed(reason, user, any);
    throw badRequest({ token: 'This invitation is invalid, expired or was already used' });
  }
  if (inv.email !== user.email.toLowerCase()) {
    await acceptFailed('wrong_account', user, inv);
    throw badRequest({ token: `This invitation was sent to a different email address (${maskEmail(inv.email)})` });
  }
  if (!user.email_verified_at) {
    await acceptFailed('email_not_verified', user, inv);
    throw badRequest({ token: 'Verify your email address first' });
  }
  await unscoped('accept invitation', () => apply(inv, user.id));
  return inv;
}

/** New users: once their email is verified, every pending invitation for it is applied. */
export async function acceptPendingInvitationsFor(user: { id: string; email: string }) {
  return unscoped('auto-accept invitations after verification', async () => {
    const pending = await prisma.invitation.findMany({ where: { email: user.email.toLowerCase(), accepted_at: null, revoked_at: null, expires_at: { gt: new Date() } } });
    for (const inv of pending) await apply(inv, user.id);
    return pending.length;
  });
}

export function maskEmail(email: string) {
  const [local, domain] = email.split('@');
  return `${local.slice(0, 2)}${'•'.repeat(Math.max(1, local.length - 2))}@${domain}`;
}
