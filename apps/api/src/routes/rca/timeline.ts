import type { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { currentUser } from '../../auth/index.js';
import { prisma } from '../../db.js';
import { diff, rcaAudit, writeAudit } from '../../lib/audit.js';
import { notFound } from '../../lib/errors.js';
import { parse, zDateTime, zText, zUuid } from '../../lib/validate.js';
import { authorize } from '../../policy/policy.js';
import { ensureRcaEditable } from '../../services/rcaRules.js';
import { rcaOf } from './access.js';

export const timelineRouter = Router({ mergeParams: true });

const timelineSchema = z
  .object({
    event_time: zDateTime,
    event: z.string().trim().min(1, 'Event is required').max(2000),
    team_or_person: zText(120).optional(),
    sort_order: z.number().int().nullable().optional(),
  })
  .strict();

async function findEvent(rcaId: string, tid: string) {
  const event = await prisma.rcaTimeline.findFirst({ where: { id: tid, rca_id: rcaId } });
  if (!event) throw notFound('Timeline event not found');
  return event;
}

timelineRouter.get('/timeline', async (req, res) => {
  const { rca, ctx } = rcaOf(req);
  authorize(ctx, 'rca.view');
  const data = await prisma.rcaTimeline.findMany({ where: { rca_id: rca.id }, orderBy: [{ sort_order: 'asc' }, { event_time: 'asc' }] });
  res.json({ data });
});

timelineRouter.post('/timeline', async (req, res) => {
  const me = currentUser(req);
  const { rca, ctx } = rcaOf(req);
  authorize(ctx, 'timeline.add');
  const body = parse(timelineSchema, req.body);
  ensureRcaEditable(rca);
  const event = await prisma.$transaction(async (tx) => {
    const max = await tx.rcaTimeline.aggregate({ where: { rca_id: rca.id }, _max: { sort_order: true } });
    const created = await tx.rcaTimeline.create({
      data: { ...body, sort_order: body.sort_order ?? (max._max.sort_order ?? 0) + 1, rca_id: rca.id, created_by: me.id },
    });
    await writeAudit(tx, rcaAudit(rca, { entity: 'rca_timeline', entity_id: created.id, action: 'CREATE', new_value: created, user_id: me.id }));
    return created;
  });
  res.status(201).json(event);
});

timelineRouter.patch('/timeline/:tid', async (req, res) => {
  const me = currentUser(req);
  const { rca, ctx } = rcaOf(req);
  const { tid } = parse(z.object({ tid: zUuid }), { tid: req.params.tid });
  const event = await findEvent(rca.id, tid);
  authorize(ctx, 'timeline.edit');
  const body = parse(timelineSchema.partial(), req.body);
  ensureRcaEditable(rca);
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.rcaTimeline.update({ where: { id: tid }, data: body as Prisma.RcaTimelineUpdateInput });
    await writeAudit(tx, rcaAudit(rca, { entity: 'rca_timeline', entity_id: tid, action: 'UPDATE', ...diff(event, body), user_id: me.id }));
    return row;
  });
  res.json(updated);
});

timelineRouter.delete('/timeline/:tid', async (req, res) => {
  const me = currentUser(req);
  const { rca, ctx } = rcaOf(req);
  const { tid } = parse(z.object({ tid: zUuid }), { tid: req.params.tid });
  const event = await findEvent(rca.id, tid);
  authorize(ctx, 'timeline.edit');
  ensureRcaEditable(rca);
  await prisma.$transaction(async (tx) => {
    await tx.rcaTimeline.delete({ where: { id: tid } });
    await writeAudit(tx, rcaAudit(rca, { entity: 'rca_timeline', entity_id: tid, action: 'DELETE', old_value: event, user_id: me.id }));
  });
  res.status(204).end();
});
