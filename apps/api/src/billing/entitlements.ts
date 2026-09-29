/**
 * The single source of truth for what a workspace's billing state allows (docs/BILLING_PLAN.md
 * section 3). Every rule (bucket, watermark, invites, collaborator write access) asks this module.
 */
import type { BillingPlan, SubscriptionStatus } from '@prisma/client';
import type { Db } from '../db.js';
import { HttpError } from '../lib/errors.js';
import { pricing } from './pricing.js';

export interface BillingState {
  plan: BillingPlan;
  subscription_status: SubscriptionStatus;
  current_period_end: Date | null;
  seats: number;
}

/** Entitled = an ACTIVE subscription whose paid period has not ended. PAST_DUE and CANCELED are not. */
export function isSubscribed(ws: BillingState, now = new Date()): boolean {
  return ws.subscription_status === 'ACTIVE' && ws.plan !== 'NONE' && !!ws.current_period_end && ws.current_period_end > now;
}

/** Team features (invites, collaborator write access) need an entitled TEAM subscription. */
export function hasTeam(ws: BillingState, now = new Date()): boolean {
  return isSubscribed(ws, now) && ws.plan === 'TEAM';
}

/** Watermark on exports: the RCA was never paid for and its workspace is not subscribed. */
export function needsWatermark(rca: { paid_at: Date | null }, ws: BillingState, now = new Date()): boolean {
  return !rca.paid_at && !isSubscribed(ws, now);
}

/** RCAs that occupy the free bucket: not deleted and never individually paid. */
export function unpaidRcaCount(db: Db, workspaceId: string) {
  return db.rca.count({ where: { workspace_id: workspaceId, is_deleted: false, paid_at: null } });
}

export const bucketFull = (limit: number) =>
  new HttpError(422, 'BUCKET_FULL', `The free plan holds ${limit} unpaid RCAs per workspace. Unlock or delete one, or subscribe to create more.`, undefined, {
    limit,
  });

/** Creating an RCA: blocked when not subscribed and the bucket already holds FREE_RCA_LIMIT unpaid RCAs. */
export async function assertBucketRoom(db: Db, ws: BillingState & { id: string }) {
  if (isSubscribed(ws)) return;
  const limit = pricing().freeRcaLimit;
  if ((await unpaidRcaCount(db, ws.id)) >= limit) throw bucketFull(limit);
}

/** People who use a Team seat: everyone with access except the primary owner, plus pending invitations. */
export async function seatsInUse(db: Db, ws: { id: string; owner_id: string }) {
  const [members, collaborators, invites] = await Promise.all([
    db.workspaceMember.findMany({ where: { workspace_id: ws.id, NOT: { user_id: ws.owner_id } }, select: { user_id: true } }),
    db.rcaCollaborator.findMany({ where: { rca: { workspace_id: ws.id }, NOT: { user_id: ws.owner_id } }, select: { user_id: true } }),
    db.invitation.findMany({
      where: { accepted_at: null, revoked_at: null, expires_at: { gt: new Date() }, OR: [{ workspace_id: ws.id }, { rca: { workspace_id: ws.id } }] },
      select: { email: true },
    }),
  ]);
  const people = new Set([...members.map((m) => m.user_id), ...collaborators.map((c) => c.user_id)]);
  return people.size + new Set(invites.map((i) => i.email)).size;
}

/** Invites need an entitled TEAM subscription with a free seat. */
export async function assertCanInvite(db: Db, ws: BillingState & { id: string; owner_id: string }) {
  if (!hasTeam(ws)) {
    throw new HttpError(403, 'SUBSCRIPTION_REQUIRED', 'Inviting people needs an active Team subscription for this workspace.', undefined, { plan_required: 'TEAM' });
  }
  const used = await seatsInUse(db, ws);
  if (used >= ws.seats) {
    throw new HttpError(403, 'SEAT_LIMIT_REACHED', `All ${ws.seats} collaborator seats are in use. Add seats under Billing.`, undefined, { seats: ws.seats, used });
  }
}
