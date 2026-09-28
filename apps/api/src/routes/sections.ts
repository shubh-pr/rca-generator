import type { Prisma, Team } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { currentUser } from '../auth/index.js';
import { prisma, type Db } from '../db.js';
import { diff, writeAudit } from '../lib/audit.js';
import { badRequest, businessRule, conflict, notFound, type FieldErrors } from '../lib/errors.js';
import { can, ensure } from '../lib/permissions.js';
import { parse, zDate, zText, zUuid } from '../lib/validate.js';
import { findRcaOr404, sectionInclude, serializeSection } from '../services/rcaQueries.js';
import { ensureRcaEditable } from '../services/rcaRules.js';

export const sectionsRouter = Router();

const zTeam = z.enum(['DEV', 'QA', 'PROD']);
const sectionParams = z.object({ id: zUuid, team: zTeam });
const actionParams = sectionParams.extend({ aid: zUuid });
const zActionStatus = z.enum(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED']);

const saveSchema = z
  .object({
    version: z.number({ error: 'version is required' }).int().min(1),
    contributor_id: zUuid.nullable().optional(),
    cause_category: z
      .enum(['CODE_DEFECT', 'CONFIG', 'REQUIREMENT_GAP', 'TEST_GAP', 'DEPLOYMENT', 'INFRA', 'THIRD_PARTY', 'DATA'])
      .nullable()
      .optional(),
    escape_analysis: zText().optional(),
    extra_1: zText().optional(),
    extra_2: zText().optional(),
    prev_process: zText().optional(),
    prev_automation: zText().optional(),
    prev_owner_date: zText(160).optional(),
    target_date: zDate.nullable().optional(),
    actual_date: zDate.nullable().optional(),
    completion_status: zActionStatus.optional(),
    verified_by: zUuid.nullable().optional(),
    whys: z
      .array(z.object({ why_no: z.number().int().min(1).max(5), answer: zText() }))
      .max(5)
      .refine((w) => new Set(w.map((x) => x.why_no)).size === w.length, 'Each why_no may appear once')
      .optional(),
  })
  .strict();

async function loadSection(db: Db, rcaId: string, team: Team) {
  const section = await db.rcaTeamSection.findUnique({ where: { rca_id_team: { rca_id: rcaId, team } }, include: sectionInclude });
  if (!section) throw notFound('Section not found');
  return section;
}

async function checkUsers(ids: Record<string, string | null | undefined>) {
  const fields: FieldErrors = {};
  for (const [key, id] of Object.entries(ids)) {
    if (!id) continue;
    const u = await prisma.user.findUnique({ where: { id } });
    if (!u || !u.is_active) fields[key] = 'Must be an active user';
  }
  if (Object.keys(fields).length) throw badRequest(fields);
}

function ensureNotSubmitted(section: { section_status: string }) {
  if (section.section_status === 'SUBMITTED') {
    throw conflict('Section is already SUBMITTED. Ask the RCA Team Leader or Admin to unlock it.');
  }
}

sectionsRouter.get('/rcas/:id/sections/:team', async (req, res) => {
  const { id, team } = parse(sectionParams, req.params);
  await findRcaOr404(prisma, id);
  res.json(serializeSection(await loadSection(prisma, id, team)));
});

// SPEC 3.4: each team section is saved separately and every save carries the last-seen version.
sectionsRouter.put('/rcas/:id/sections/:team', async (req, res) => {
  const me = currentUser(req);
  const { id, team } = parse(sectionParams, req.params);
  const rca = await findRcaOr404(prisma, id);
  ensure(can.editSection(me, team), `You cannot edit the ${team} section`);
  const { version, whys, ...fields } = parse(saveSchema, req.body);
  ensureRcaEditable(rca);
  const current = await loadSection(prisma, id, team);
  ensureNotSubmitted(current);
  if (current.version !== version) {
    throw conflict('Section was changed by someone else. Reload to get the latest version.', { current_version: current.version }, 'VERSION_CONFLICT');
  }
  await checkUsers({ contributor_id: fields.contributor_id, verified_by: fields.verified_by });

  // SPEC 3.3: completion status COMPLETED requires an actual date and Verified by.
  const completion = fields.completion_status ?? current.completion_status;
  if (completion === 'COMPLETED') {
    const errs: FieldErrors = {};
    if (!(fields.actual_date === undefined ? current.actual_date : fields.actual_date)) errs.actual_date = 'Required when completion is COMPLETED';
    if (!(fields.verified_by === undefined ? current.verified_by : fields.verified_by)) errs.verified_by = 'Required when completion is COMPLETED';
    if (Object.keys(errs).length) throw badRequest(errs);
  }

  await prisma.$transaction(async (tx) => {
    // Compare-and-set on version: a concurrent save of the same section loses with 409.
    const updated = await tx.rcaTeamSection.updateMany({
      where: { id: current.id, version },
      data: { ...fields, section_status: 'IN_PROGRESS', version: { increment: 1 }, updated_by: me.id },
    });
    if (updated.count === 0) {
      throw conflict('Section was changed by someone else. Reload to get the latest version.', undefined, 'VERSION_CONFLICT');
    }
    for (const w of whys ?? []) {
      await tx.rcaWhy.update({ where: { section_id_why_no: { section_id: current.id, why_no: w.why_no } }, data: { answer: w.answer } });
    }
    const oldWhys = Object.fromEntries(current.whys.map((w) => [`why_${w.why_no}`, w.answer]));
    const newWhys = Object.fromEntries((whys ?? []).map((w) => [`why_${w.why_no}`, w.answer]));
    const changes = diff({ ...current, ...oldWhys }, { ...fields, ...newWhys, section_status: 'IN_PROGRESS' });
    await writeAudit(tx, {
      entity: 'rca_team_section',
      entity_id: current.id,
      rca_id: id,
      action: 'UPDATE',
      old_value: { ...changes.old_value, team, version },
      new_value: { ...changes.new_value, team, version: version + 1 },
      user_id: me.id,
    });
  });
  res.json(serializeSection(await loadSection(prisma, id, team)));
});

/** SPEC 3.3: submitting needs cause category, Why 1 and Why 5, escape analysis and at least one action. */
function submitProblems(s: Awaited<ReturnType<typeof loadSection>>): FieldErrors {
  const fields: FieldErrors = {};
  const answer = (n: number) => s.whys.find((w) => w.why_no === n)?.answer?.trim();
  if (!s.cause_category) fields.cause_category = 'Cause category is required';
  if (!answer(1)) fields['whys.1'] = 'Why 1 is required';
  if (!answer(5)) fields['whys.5'] = 'Why 5 (root cause) is required';
  if (!s.escape_analysis?.trim()) fields.escape_analysis = 'Escape analysis is required';
  if (s.actions.length === 0) fields.actions = 'At least one action is required';
  return fields;
}

sectionsRouter.post('/rcas/:id/sections/:team/submit', async (req, res) => {
  const me = currentUser(req);
  const { id, team } = parse(sectionParams, req.params);
  const rca = await findRcaOr404(prisma, id);
  ensure(can.editSection(me, team), `You cannot submit the ${team} section`);
  const { version } = parse(z.object({ version: z.number().int().optional() }), req.body ?? {});
  if (rca.status !== 'DRAFT') throw conflict(`RCA is ${rca.status}; sections can only be submitted while it is DRAFT`);
  const s = await loadSection(prisma, id, team);
  ensureNotSubmitted(s);
  if (version !== undefined && version !== s.version) {
    throw conflict('Section was changed by someone else. Reload to get the latest version.', { current_version: s.version }, 'VERSION_CONFLICT');
  }
  const problems = submitProblems(s);
  if (Object.keys(problems).length) throw businessRule('Section is not complete', undefined, problems);

  await prisma.$transaction(async (tx) => {
    const updated = await tx.rcaTeamSection.updateMany({
      where: { id: s.id, version: s.version },
      data: { section_status: 'SUBMITTED', submitted_at: new Date(), version: { increment: 1 }, updated_by: me.id },
    });
    if (updated.count === 0) throw conflict('Section was changed by someone else. Reload to get the latest version.', undefined, 'VERSION_CONFLICT');
    await writeAudit(tx, {
      entity: 'rca_team_section',
      entity_id: s.id,
      rca_id: id,
      action: 'SUBMIT',
      old_value: { team, section_status: s.section_status },
      new_value: { team, section_status: 'SUBMITTED' },
      user_id: me.id,
    });
  });
  res.json(serializeSection(await loadSection(prisma, id, team)));
});

sectionsRouter.post('/rcas/:id/sections/:team/reopen', async (req, res) => {
  const me = currentUser(req);
  const { id, team } = parse(sectionParams, req.params);
  const rca = await findRcaOr404(prisma, id);
  ensure(can.reopenSection(me), 'Only the RCA Team Leader or Admin can unlock a section');
  if (rca.status !== 'DRAFT') throw conflict(`RCA is ${rca.status}; use send back (IN_REVIEW) or reopen the RCA (CLOSED) first`);
  const s = await loadSection(prisma, id, team);
  if (s.section_status !== 'SUBMITTED') throw conflict('Section is not submitted');
  await prisma.$transaction(async (tx) => {
    await tx.rcaTeamSection.update({
      where: { id: s.id },
      data: { section_status: 'IN_PROGRESS', submitted_at: null, version: { increment: 1 }, updated_by: me.id },
    });
    await writeAudit(tx, {
      entity: 'rca_team_section',
      entity_id: s.id,
      rca_id: id,
      action: 'REOPEN',
      old_value: { team, section_status: 'SUBMITTED' },
      new_value: { team, section_status: 'IN_PROGRESS' },
      user_id: me.id,
    });
  });
  res.json(serializeSection(await loadSection(prisma, id, team)));
});

// ---------- Actions (SPEC 4.7) ----------

const actionSchema = z
  .object({
    action: z.string().trim().min(1, 'Action is required'),
    owner_id: zUuid,
    due_date: zDate,
    status: zActionStatus.default('NOT_STARTED'),
    completed_on: zDate.nullable().optional(),
  })
  .strict();

const actionUpdateSchema = z
  .object({
    action: z.string().trim().min(1, 'Action is required'),
    owner_id: zUuid,
    due_date: zDate,
    status: zActionStatus,
    completed_on: zDate.nullable(),
  })
  .partial()
  .strict();

/** Fields that stay editable after the section is submitted (progress tracking until close). */
const TRACKING_FIELDS = new Set(['status', 'completed_on']);

function checkDueDate(due: Date | undefined, rcaDate: Date) {
  if (due && due < rcaDate) throw badRequest({ due_date: 'Due date cannot be before the RCA date' });
}

async function loadAction(sectionId: string, aid: string) {
  const action = await prisma.rcaAction.findFirst({ where: { id: aid, section_id: sectionId } });
  if (!action) throw notFound('Action not found');
  return action;
}

sectionsRouter.post('/rcas/:id/sections/:team/actions', async (req, res) => {
  const me = currentUser(req);
  const { id, team } = parse(sectionParams, req.params);
  const rca = await findRcaOr404(prisma, id);
  ensure(can.editSection(me, team), `You cannot add actions to the ${team} section`);
  const body = parse(actionSchema, req.body);
  ensureRcaEditable(rca);
  const section = await loadSection(prisma, id, team);
  ensureNotSubmitted(section);
  checkDueDate(body.due_date, rca.rca_date);
  await checkUsers({ owner_id: body.owner_id });

  const created = await prisma.$transaction(async (tx) => {
    const max = await tx.rcaAction.aggregate({ where: { section_id: section.id }, _max: { seq: true } });
    const row = await tx.rcaAction.create({
      data: { ...body, section_id: section.id, seq: (max._max.seq ?? 0) + 1, created_by: me.id },
    });
    await writeAudit(tx, { entity: 'rca_action', entity_id: row.id, rca_id: id, action: 'CREATE', new_value: { ...row, team }, user_id: me.id });
    return row;
  });
  res.status(201).json(created);
});

sectionsRouter.patch('/rcas/:id/sections/:team/actions/:aid', async (req, res) => {
  const me = currentUser(req);
  const { id, team, aid } = parse(actionParams, req.params);
  const rca = await findRcaOr404(prisma, id);
  ensure(can.editSection(me, team), `You cannot edit actions of the ${team} section`);
  const body = parse(actionUpdateSchema, req.body);
  ensureRcaEditable(rca);
  const section = await loadSection(prisma, id, team);
  const existing = await loadAction(section.id, aid);
  if (section.section_status === 'SUBMITTED' && Object.keys(body).some((k) => !TRACKING_FIELDS.has(k))) {
    throw conflict('Section is SUBMITTED; only action status and completed date can change');
  }
  checkDueDate(body.due_date, rca.rca_date);
  await checkUsers({ owner_id: body.owner_id });

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.rcaAction.update({ where: { id: aid }, data: body as Prisma.RcaActionUpdateInput });
    await writeAudit(tx, { entity: 'rca_action', entity_id: aid, rca_id: id, action: 'UPDATE', ...diff(existing, body), user_id: me.id });
    return row;
  });
  res.json(updated);
});

sectionsRouter.delete('/rcas/:id/sections/:team/actions/:aid', async (req, res) => {
  const me = currentUser(req);
  const { id, team, aid } = parse(actionParams, req.params);
  const rca = await findRcaOr404(prisma, id);
  ensure(can.editSection(me, team), `You cannot delete actions of the ${team} section`);
  ensureRcaEditable(rca);
  const section = await loadSection(prisma, id, team);
  const existing = await loadAction(section.id, aid);
  ensureNotSubmitted(section);
  await prisma.$transaction(async (tx) => {
    await tx.rcaAction.delete({ where: { id: aid } });
    await writeAudit(tx, { entity: 'rca_action', entity_id: aid, rca_id: id, action: 'DELETE', old_value: existing, user_id: me.id });
  });
  res.status(204).end();
});
