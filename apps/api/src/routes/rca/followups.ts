import type { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { currentUser } from '../../auth/index.js';
import { prisma } from '../../db.js';
import { diff, rcaAudit, writeAudit } from '../../lib/audit.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { parse, zDate, zUuid } from '../../lib/validate.js';
import { rcaParticipants } from '../../policy/access.js';
import { authorize } from '../../policy/policy.js';
import { userRef } from '../../services/rcaQueries.js';
import { ensureRcaEditable } from '../../services/rcaRules.js';
import { rcaOf } from './access.js';

export const followupsRouter = Router({ mergeParams: true });

const createSchema = z
  .object({
    risk: z.string().trim().min(1, 'Risk / follow-up is required').max(5000),
    owner_id: zUuid.nullable().optional(),
    due_date: zDate.nullable().optional(),
    /** Set to move an open action to follow-ups. */
    action_id: zUuid.optional(),
  })
  .strict();
const updateSchema = createSchema.omit({ action_id: true }).partial().strict();
const fidParam = (req: { params: Record<string, string> }) => parse(z.object({ fid: zUuid }), { fid: req.params.fid }).fid;

async function checkOwner(rca: { id: string; workspace_id: string }, ownerId: string | null | undefined) {
  if (!ownerId) return;
  if (!(await rcaParticipants(prisma, rca)).some((p) => p.id === ownerId)) throw badRequest({ owner_id: 'Must be a person with access to this RCA' });
}

followupsRouter.get('/followups', async (req, res) => {
  const { rca, ctx } = rcaOf(req);
  authorize(ctx, 'rca.view');
  const data = await prisma.rcaFollowup.findMany({ where: { rca_id: rca.id }, orderBy: { created_at: 'asc' }, include: { owner: userRef } });
  res.json({ data });
});

followupsRouter.post('/followups', async (req, res) => {
  const me = currentUser(req);
  const { rca, ctx } = rcaOf(req);
  authorize(ctx, 'followup.manage');
  const body = parse(createSchema, req.body);
  ensureRcaEditable(rca);
  await checkOwner(rca, body.owner_id);
  if (body.action_id) {
    const action = await prisma.rcaAction.findFirst({ where: { id: body.action_id, section: { rca_id: rca.id } }, include: { followup: true } });
    if (!action) throw badRequest({ action_id: 'Action does not belong to this RCA' });
    if (action.status === 'COMPLETED') throw conflict('Action is already COMPLETED');
    if (action.followup) throw conflict('Action was already moved to follow-ups');
    // "Moved to Follow-ups with an owner and date" (SPEC 3.1).
    const missing: Record<string, string> = {};
    if (!body.owner_id) missing.owner_id = 'Owner is required when moving an action';
    if (!body.due_date) missing.due_date = 'Due date is required when moving an action';
    if (Object.keys(missing).length) throw badRequest(missing);
  }
  const followup = await prisma.$transaction(async (tx) => {
    const row = await tx.rcaFollowup.create({ data: { ...body, rca_id: rca.id, created_by: me.id }, include: { owner: userRef } });
    await writeAudit(tx, rcaAudit(rca, { entity: 'rca_followup', entity_id: row.id, action: 'CREATE', new_value: body, user_id: me.id }));
    return row;
  });
  res.status(201).json(followup);
});

async function loadFollowup(rcaId: string, fid: string) {
  const f = await prisma.rcaFollowup.findFirst({ where: { id: fid, rca_id: rcaId } });
  if (!f) throw notFound('Follow-up not found');
  return f;
}

followupsRouter.patch('/followups/:fid', async (req, res) => {
  const me = currentUser(req);
  const { rca, ctx } = rcaOf(req);
  const f = await loadFollowup(rca.id, fidParam(req));
  authorize(ctx, 'followup.manage');
  const body = parse(updateSchema, req.body);
  ensureRcaEditable(rca);
  await checkOwner(rca, body.owner_id);
  if (f.action_id && (body.owner_id === null || body.due_date === null)) {
    throw badRequest({ [body.owner_id === null ? 'owner_id' : 'due_date']: 'A moved action needs an owner and a due date' });
  }
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.rcaFollowup.update({ where: { id: f.id }, data: body as Prisma.RcaFollowupUpdateInput, include: { owner: userRef } });
    await writeAudit(tx, rcaAudit(rca, { entity: 'rca_followup', entity_id: f.id, action: 'UPDATE', ...diff(f, body), user_id: me.id }));
    return row;
  });
  res.json(updated);
});

followupsRouter.delete('/followups/:fid', async (req, res) => {
  const me = currentUser(req);
  const { rca, ctx } = rcaOf(req);
  const f = await loadFollowup(rca.id, fidParam(req));
  authorize(ctx, 'followup.manage');
  ensureRcaEditable(rca);
  await prisma.$transaction(async (tx) => {
    await tx.rcaFollowup.delete({ where: { id: f.id } });
    await writeAudit(tx, rcaAudit(rca, { entity: 'rca_followup', entity_id: f.id, action: 'DELETE', old_value: f, user_id: me.id }));
  });
  res.status(204).end();
});
