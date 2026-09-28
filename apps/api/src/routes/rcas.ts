import type { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { currentUser } from '../auth/index.js';
import { prisma } from '../db.js';
import { diff, writeAudit } from '../lib/audit.js';
import { notFound } from '../lib/errors.js';
import { todayIst } from '../lib/dates.js';
import { pageResult, parsePage } from '../lib/pagination.js';
import { can, ensure } from '../lib/permissions.js';
import { idParam, parse, zDate, zDateTime, zText, zUuid } from '../lib/validate.js';
import { buildRcaWhere, parseRcaFilters, RCA_SORTABLE } from '../services/rcaFilters.js';
import { nextRcaNumber } from '../services/rcaNumber.js';
import { findRcaOr404, loadFullRca, overdueActionWhere, serializeRca, TEAMS, userRef } from '../services/rcaQueries.js';
import { checkHeaderRefs, checkIncidentTimes, ensureRcaEditable } from '../services/rcaRules.js';

export const rcasRouter = Router();

const SIGNOFF_ROLES = ['PROJECT_OWNER', 'RCA_LEAD', 'DEV_LEAD', 'QA_LEAD', 'PROD_LEAD'] as const;

/** Header + common + lessons fields (everything on the rca row a user may type). */
const editableFields = {
  rca_date: zDate,
  project_id: zUuid,
  team_leader_id: zUuid,
  ticket_id: zText(60).optional(),
  severity: z.enum(['P1', 'P2', 'P3', 'P4']),
  environment: z.enum(['PROD', 'UAT', 'STAGING']),
  incident_start: zDateTime,
  detected_at: zDateTime.nullable().optional(),
  resolved_at: zDateTime.nullable().optional(),
  prepared_by: zUuid.nullable().optional(),
  reviewed_by: zUuid.nullable().optional(),
  summary: z.string().trim().min(1, 'Problem statement is required'),
  impact_users: zText().optional(),
  impact_duration: zText(80).optional(),
  impact_data_revenue: zText().optional(),
  sla_breached: z.boolean().optional(),
  detection_method: z.enum(['MONITORING', 'CLIENT_REPORT', 'QA', 'OTHER']).nullable().optional(),
  immediate_fix: zText().optional(),
  immediate_fix_by: zText(120).optional(),
  lessons_well: zText().optional(),
  lessons_not_well: zText().optional(),
  lessons_key: zText().optional(),
};

const createSchema = z.object(editableFields).strict();
const updateSchema = z.object(editableFields).partial().strict();

rcasRouter.get('/rcas', async (req, res) => {
  const filters = parseRcaFilters(req.query);
  const p = parsePage(req.query, RCA_SORTABLE, '-rca_date');
  const where = buildRcaWhere(filters);
  const [rows, total] = await Promise.all([
    prisma.rca.findMany({
      where,
      orderBy: [p.orderBy, { rca_number: 'desc' }],
      skip: p.skip,
      take: p.take,
      select: {
        id: true,
        rca_number: true,
        rca_date: true,
        severity: true,
        environment: true,
        status: true,
        version: true,
        summary: true,
        ticket_id: true,
        closed_at: true,
        project: { select: { id: true, name: true, company: { select: { id: true, name: true } } } },
        team_leader: userRef,
        sections: { select: { team: true, section_status: true }, orderBy: { team: 'asc' } },
      },
    }),
    prisma.rca.count({ where }),
  ]);
  const overdue = await prisma.rcaAction.findMany({
    where: { ...overdueActionWhere(todayIst()), section: { rca_id: { in: rows.map((r) => r.id) } } },
    select: { section: { select: { rca_id: true } } },
  });
  const overdueIds = new Set(overdue.map((a) => a.section.rca_id));
  res.json(pageResult(rows.map((r) => ({ ...r, has_overdue: overdueIds.has(r.id) })), total, p));
});

rcasRouter.post('/rcas', async (req, res) => {
  const me = currentUser(req);
  ensure(can.createRca(me));
  const body = parse(createSchema, req.body);
  checkIncidentTimes(body);
  await checkHeaderRefs(prisma, body);

  const id = await prisma.$transaction(async (tx) => {
    const rca_number = await nextRcaNumber(tx, body.rca_date.getUTCFullYear());
    const created = await tx.rca.create({
      data: {
        ...body,
        rca_number,
        prepared_by: body.prepared_by === undefined ? me.id : body.prepared_by,
        created_by: me.id,
        updated_by: me.id,
        // SPEC 4.9: creating an RCA also creates its 3 team sections (each with 5 whys) and 5 sign-off rows.
        sections: {
          create: TEAMS.map((team) => ({ team, whys: { create: [1, 2, 3, 4, 5].map((why_no) => ({ why_no })) } })),
        },
        signoffs: { create: SIGNOFF_ROLES.map((role) => ({ role })) },
      },
    });
    await writeAudit(tx, {
      entity: 'rca',
      entity_id: created.id,
      rca_id: created.id,
      action: 'CREATE',
      new_value: created,
      user_id: me.id,
    });
    return created.id;
  });
  res.status(201).json(serializeRca(await loadFullRca(prisma, id)));
});

rcasRouter.get('/rcas/:id', async (req, res) => {
  const { id } = parse(idParam, req.params);
  res.json(serializeRca(await loadFullRca(prisma, id)));
});

rcasRouter.patch('/rcas/:id', async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParam, req.params);
  const existing = await findRcaOr404(prisma, id);
  ensure(can.editCommon(me));
  const body = parse(updateSchema, req.body);
  ensureRcaEditable(existing);
  checkIncidentTimes({
    incident_start: body.incident_start ?? existing.incident_start,
    detected_at: body.detected_at === undefined ? existing.detected_at : body.detected_at,
    resolved_at: body.resolved_at === undefined ? existing.resolved_at : body.resolved_at,
  });
  await checkHeaderRefs(prisma, body);

  await prisma.$transaction(async (tx) => {
    const updated = await tx.rca.update({ where: { id }, data: { ...body, updated_by: me.id } });
    const changes = diff(existing, body as Record<string, unknown>);
    await writeAudit(tx, { entity: 'rca', entity_id: id, rca_id: id, action: 'UPDATE', ...changes, user_id: me.id });
    return updated;
  });
  res.json(serializeRca(await loadFullRca(prisma, id)));
});

rcasRouter.delete('/rcas/:id', async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParam, req.params);
  await findRcaOr404(prisma, id);
  ensure(can.deleteRca(me));
  await prisma.$transaction(async (tx) => {
    await tx.rca.update({ where: { id }, data: { is_deleted: true, updated_by: me.id } });
    await writeAudit(tx, {
      entity: 'rca',
      entity_id: id,
      rca_id: id,
      action: 'DELETE',
      old_value: { is_deleted: false },
      new_value: { is_deleted: true },
      user_id: me.id,
    });
  });
  res.status(204).end();
});

// ---------- Timeline (SPEC 4.5) ----------

const timelineSchema = z
  .object({
    event_time: zDateTime,
    event: z.string().trim().min(1, 'Event is required'),
    team_or_person: zText(120).optional(),
    sort_order: z.number().int().nullable().optional(),
  })
  .strict();

const timelineParams = z.object({ id: zUuid, tid: zUuid });

rcasRouter.get('/rcas/:id/timeline', async (req, res) => {
  const { id } = parse(idParam, req.params);
  await findRcaOr404(prisma, id);
  const data = await prisma.rcaTimeline.findMany({
    where: { rca_id: id },
    orderBy: [{ sort_order: 'asc' }, { event_time: 'asc' }],
  });
  res.json({ data });
});

rcasRouter.post('/rcas/:id/timeline', async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParam, req.params);
  const rca = await findRcaOr404(prisma, id);
  ensure(can.addTimeline(me));
  const body = parse(timelineSchema, req.body);
  ensureRcaEditable(rca);
  const event = await prisma.$transaction(async (tx) => {
    const max = await tx.rcaTimeline.aggregate({ where: { rca_id: id }, _max: { sort_order: true } });
    const created = await tx.rcaTimeline.create({
      data: { ...body, sort_order: body.sort_order ?? (max._max.sort_order ?? 0) + 1, rca_id: id, created_by: me.id },
    });
    await writeAudit(tx, { entity: 'rca_timeline', entity_id: created.id, rca_id: id, action: 'CREATE', new_value: created, user_id: me.id });
    return created;
  });
  res.status(201).json(event);
});

async function findTimelineOr404(id: string, tid: string) {
  const rca = await findRcaOr404(prisma, id);
  const event = await prisma.rcaTimeline.findFirst({ where: { id: tid, rca_id: id } });
  if (!event) throw notFound('Timeline event not found');
  return { rca, event };
}

rcasRouter.patch('/rcas/:id/timeline/:tid', async (req, res) => {
  const me = currentUser(req);
  const { id, tid } = parse(timelineParams, req.params);
  const { rca, event } = await findTimelineOr404(id, tid);
  ensure(can.editTimeline(me));
  const body = parse(timelineSchema.partial(), req.body);
  ensureRcaEditable(rca);
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.rcaTimeline.update({ where: { id: tid }, data: body as Prisma.RcaTimelineUpdateInput });
    await writeAudit(tx, { entity: 'rca_timeline', entity_id: tid, rca_id: id, action: 'UPDATE', ...diff(event, body), user_id: me.id });
    return row;
  });
  res.json(updated);
});

rcasRouter.delete('/rcas/:id/timeline/:tid', async (req, res) => {
  const me = currentUser(req);
  const { id, tid } = parse(timelineParams, req.params);
  const { rca, event } = await findTimelineOr404(id, tid);
  ensure(can.editTimeline(me));
  ensureRcaEditable(rca);
  await prisma.$transaction(async (tx) => {
    await tx.rcaTimeline.delete({ where: { id: tid } });
    await writeAudit(tx, { entity: 'rca_timeline', entity_id: tid, rca_id: id, action: 'DELETE', old_value: event, user_id: me.id });
  });
  res.status(204).end();
});
