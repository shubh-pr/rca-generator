import type { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { currentUser } from '../auth/index.js';
import { prisma } from '../db.js';
import { diff, writeAudit } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { can, ensure } from '../lib/permissions.js';
import { idParam, parse, zDate, zUuid } from '../lib/validate.js';
import { findRcaOr404, userRef } from '../services/rcaQueries.js';
import { ensureRcaEditable } from '../services/rcaRules.js';

export const followupsRouter = Router();

const createSchema = z
  .object({
    risk: z.string().trim().min(1, 'Risk / follow-up is required'),
    owner_id: zUuid.nullable().optional(),
    due_date: zDate.nullable().optional(),
    /** Set to move an open action to follow-ups. */
    action_id: zUuid.optional(),
  })
  .strict();
const updateSchema = createSchema.omit({ action_id: true }).partial().strict();
const params = z.object({ id: zUuid, fid: zUuid });

async function checkOwner(ownerId: string | null | undefined) {
  if (!ownerId) return;
  const u = await prisma.user.findUnique({ where: { id: ownerId } });
  if (!u || !u.is_active) throw badRequest({ owner_id: 'Must be an active user' });
}

followupsRouter.get('/rcas/:id/followups', async (req, res) => {
  const { id } = parse(idParam, req.params);
  await findRcaOr404(prisma, id);
  const data = await prisma.rcaFollowup.findMany({ where: { rca_id: id }, orderBy: { created_at: 'asc' }, include: { owner: userRef } });
  res.json({ data });
});

followupsRouter.post('/rcas/:id/followups', async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParam, req.params);
  const rca = await findRcaOr404(prisma, id);
  ensure(can.manageFollowups(me));
  const body = parse(createSchema, req.body);
  ensureRcaEditable(rca);
  await checkOwner(body.owner_id);
  if (body.action_id) {
    const action = await prisma.rcaAction.findFirst({ where: { id: body.action_id, section: { rca_id: id } }, include: { followup: true } });
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
    const row = await tx.rcaFollowup.create({ data: { ...body, rca_id: id, created_by: me.id }, include: { owner: userRef } });
    await writeAudit(tx, { entity: 'rca_followup', entity_id: row.id, rca_id: id, action: 'CREATE', new_value: body, user_id: me.id });
    return row;
  });
  res.status(201).json(followup);
});

async function loadFollowup(id: string, fid: string) {
  const rca = await findRcaOr404(prisma, id);
  const f = await prisma.rcaFollowup.findFirst({ where: { id: fid, rca_id: id } });
  if (!f) throw notFound('Follow-up not found');
  return { rca, f };
}

followupsRouter.patch('/rcas/:id/followups/:fid', async (req, res) => {
  const me = currentUser(req);
  const { id, fid } = parse(params, req.params);
  const { rca, f } = await loadFollowup(id, fid);
  ensure(can.manageFollowups(me));
  const body = parse(updateSchema, req.body);
  ensureRcaEditable(rca);
  await checkOwner(body.owner_id);
  if (f.action_id && (body.owner_id === null || body.due_date === null)) {
    throw badRequest({ [body.owner_id === null ? 'owner_id' : 'due_date']: 'A moved action needs an owner and a due date' });
  }
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.rcaFollowup.update({ where: { id: fid }, data: body as Prisma.RcaFollowupUpdateInput, include: { owner: userRef } });
    await writeAudit(tx, { entity: 'rca_followup', entity_id: fid, rca_id: id, action: 'UPDATE', ...diff(f, body), user_id: me.id });
    return row;
  });
  res.json(updated);
});

followupsRouter.delete('/rcas/:id/followups/:fid', async (req, res) => {
  const me = currentUser(req);
  const { id, fid } = parse(params, req.params);
  const { rca, f } = await loadFollowup(id, fid);
  ensure(can.manageFollowups(me));
  ensureRcaEditable(rca);
  await prisma.$transaction(async (tx) => {
    await tx.rcaFollowup.delete({ where: { id: fid } });
    await writeAudit(tx, { entity: 'rca_followup', entity_id: fid, rca_id: id, action: 'DELETE', old_value: f, user_id: me.id });
  });
  res.status(204).end();
});
