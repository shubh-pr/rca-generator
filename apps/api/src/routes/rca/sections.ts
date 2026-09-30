import type { Prisma, Team } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { currentUser } from '../../auth/index.js';
import { prisma, type Db } from '../../db.js';
import { diff, rcaAudit, writeAudit } from '../../lib/audit.js';
import { badRequest, businessRule, conflict, notFound, type FieldErrors } from '../../lib/errors.js';
import { parse, zDate, zText, zUuid } from '../../lib/validate.js';
import { rcaParticipants } from '../../policy/access.js';
import { authorize } from '../../policy/policy.js';
import { sectionInclude, serializeSection } from '../../services/rcaQueries.js';
import { ensureRcaEditable } from '../../services/rcaRules.js';
import { rcaOf } from './access.js';

export const sectionsRouter = Router({ mergeParams: true });

const zTeam = z.enum(['DEV', 'QA', 'PROD']);
const zActionStatus = z.enum(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED']);
const teamParam = (req: { params: Record<string, string> }) => parse(z.object({ team: zTeam }), { team: req.params.team }).team;
const actionParam = (req: { params: Record<string, string> }) => parse(z.object({ aid: zUuid }), { aid: req.params.aid }).aid;

const saveSchema = z
  .object({
    version: z.number({ error: 'version is required' }).int().min(1),
    contributor_name: zText(120).optional(),
    cause_category: z
      .enum(['CODE_DEFECT', 'CONFIG', 'REQUIREMENT_GAP', 'TEST_GAP', 'DEPLOYMENT', 'INFRA', 'THIRD_PARTY', 'DATA'])
      .nullable()
      .optional(),
    escape_analysis: zText(10_000).optional(),
    extra_1: zText(10_000).optional(),
    extra_2: zText(10_000).optional(),
    prev_process: zText(10_000).optional(),
    prev_automation: zText(10_000).optional(),
    prev_owner_date: zText(160).optional(),
    target_date: zDate.nullable().optional(),
    actual_date: zDate.nullable().optional(),
    completion_status: zActionStatus.optional(),
    verified_by_name: zText(120).optional(),
    whys: z
      .array(z.object({ why_no: z.number().int().min(1).max(5), answer: zText(10_000) }))
      .max(5)
      .refine((w) => new Set(w.map((x) => x.why_no)).size === w.length, 'Each why_no may appear once')
      .optional(),
  })
  .strict();

async function loadSection(db: Db, rcaId: string, team: Team) {
  const section = await db.rcaTeamSection.findFirst({ where: { rca_id: rcaId, team }, include: sectionInclude });
  if (!section) throw notFound('Section not found');
  return section;
}

function ensureNotSubmitted(section: { section_status: string }) {
  if (section.section_status === 'SUBMITTED') {
    throw conflict('Section is already SUBMITTED. Ask an owner or editor to unlock it.');
  }
}

/**
 * 409 for a stale version. It says who saved in between, so a solo user who has the RCA open in two
 * tabs is not told "someone else" (details.changed_by_self, details.changed_by_name).
 */
async function versionConflict(rcaId: string, team: Team, meId: string) {
  const s = await loadSection(prisma, rcaId, team);
  const self = s.updated_by === meId;
  const message = self
    ? 'This section was saved from another tab or window since you opened it here. Reload to continue.'
    : `${s.updated_by_user?.name ?? 'Someone else'} changed this section since you opened it. Reload to get the latest version.`;
  return conflict(message, { current_version: s.version, changed_by_self: self, changed_by_name: self ? null : (s.updated_by_user?.name ?? null) }, 'VERSION_CONFLICT');
}

async function ensureParticipant(rca: { id: string; workspace_id: string }, userId: string | null | undefined, field: string) {
  if (!userId) return;
  if (!(await rcaParticipants(prisma, rca)).some((p) => p.id === userId)) throw badRequest({ [field]: 'Must be a person with access to this RCA' });
}

sectionsRouter.get('/sections/:team', async (req, res) => {
  const { rca, ctx } = rcaOf(req);
  authorize(ctx, 'rca.view');
  res.json(serializeSection(await loadSection(prisma, rca.id, teamParam(req))));
});

// SPEC 3.4: each team section is saved separately and every save carries the last-seen version.
sectionsRouter.put('/sections/:team', async (req, res) => {
  const me = currentUser(req);
  const { rca, ctx } = rcaOf(req);
  const team = teamParam(req);
  authorize(ctx, 'section.edit', { team }, `You cannot edit the ${team} section`);
  const { version, whys, ...fields } = parse(saveSchema, req.body);
  ensureRcaEditable(rca);
  const current = await loadSection(prisma, rca.id, team);
  ensureNotSubmitted(current);
  if (current.version !== version) throw await versionConflict(rca.id, team, me.id);

  // SPEC 3.3: completion status COMPLETED requires an actual date and Verified by.
  const completion = fields.completion_status ?? current.completion_status;
  if (completion === 'COMPLETED') {
    const errs: FieldErrors = {};
    if (!(fields.actual_date === undefined ? current.actual_date : fields.actual_date)) errs.actual_date = 'Required when completion is COMPLETED';
    if (!(fields.verified_by_name === undefined ? current.verified_by_name : fields.verified_by_name)) errs.verified_by_name = 'Required when completion is COMPLETED';
    if (Object.keys(errs).length) throw badRequest(errs);
  }

  await prisma.$transaction(async (tx) => {
    // Compare-and-set on version: a concurrent save of the same section loses with 409.
    const updated = await tx.rcaTeamSection.updateMany({
      where: { id: current.id, version },
      data: { ...fields, section_status: 'IN_PROGRESS', version: { increment: 1 }, updated_by: me.id },
    });
    if (updated.count === 0) throw await versionConflict(rca.id, team, me.id);
    for (const w of whys ?? []) {
      await tx.rcaWhy.updateMany({ where: { section_id: current.id, why_no: w.why_no }, data: { answer: w.answer } });
    }
    const oldWhys = Object.fromEntries(current.whys.map((w) => [`why_${w.why_no}`, w.answer]));
    const newWhys = Object.fromEntries((whys ?? []).map((w) => [`why_${w.why_no}`, w.answer]));
    const changes = diff({ ...current, ...oldWhys }, { ...fields, ...newWhys, section_status: 'IN_PROGRESS' });
    await writeAudit(tx, rcaAudit(rca, {
      entity: 'rca_team_section',
      entity_id: current.id,
      action: 'UPDATE',
      old_value: { ...changes.old_value, team, version },
      new_value: { ...changes.new_value, team, version: version + 1 },
      user_id: me.id,
    }));
  });
  res.json(serializeSection(await loadSection(prisma, rca.id, team)));
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

sectionsRouter.post('/sections/:team/submit', async (req, res) => {
  const me = currentUser(req);
  const { rca, ctx } = rcaOf(req);
  const team = teamParam(req);
  authorize(ctx, 'section.edit', { team }, `You cannot submit the ${team} section`);
  const { version } = parse(z.object({ version: z.number().int().optional() }), req.body ?? {});
  if (rca.status !== 'DRAFT') throw conflict(`RCA is ${rca.status}; sections can only be submitted while it is DRAFT`);
  const s = await loadSection(prisma, rca.id, team);
  ensureNotSubmitted(s);
  if (version !== undefined && version !== s.version) throw await versionConflict(rca.id, team, me.id);
  const problems = submitProblems(s);
  if (Object.keys(problems).length) throw businessRule('Section is not complete', undefined, problems);

  await prisma.$transaction(async (tx) => {
    const updated = await tx.rcaTeamSection.updateMany({
      where: { id: s.id, version: s.version },
      data: { section_status: 'SUBMITTED', submitted_at: new Date(), version: { increment: 1 }, updated_by: me.id },
    });
    if (updated.count === 0) throw await versionConflict(rca.id, team, me.id);
    await writeAudit(tx, rcaAudit(rca, {
      entity: 'rca_team_section',
      entity_id: s.id,
      action: 'SUBMIT',
      old_value: { team, section_status: s.section_status },
      new_value: { team, section_status: 'SUBMITTED' },
      user_id: me.id,
    }));
  });
  res.json(serializeSection(await loadSection(prisma, rca.id, team)));
});

sectionsRouter.post('/sections/:team/reopen', async (req, res) => {
  const me = currentUser(req);
  const { rca, ctx } = rcaOf(req);
  const team = teamParam(req);
  authorize(ctx, 'section.unlock', undefined, 'Only an owner or editor can unlock a section');
  if (rca.status !== 'DRAFT') throw conflict(`RCA is ${rca.status}; use send back (IN_REVIEW) or reopen the RCA (CLOSED) first`);
  const s = await loadSection(prisma, rca.id, team);
  if (s.section_status !== 'SUBMITTED') throw conflict('Section is not submitted');
  await prisma.$transaction(async (tx) => {
    await tx.rcaTeamSection.update({
      where: { id: s.id },
      data: { section_status: 'IN_PROGRESS', submitted_at: null, version: { increment: 1 }, updated_by: me.id },
    });
    await writeAudit(tx, rcaAudit(rca, {
      entity: 'rca_team_section',
      entity_id: s.id,
      action: 'REOPEN',
      old_value: { team, section_status: 'SUBMITTED' },
      new_value: { team, section_status: 'IN_PROGRESS' },
      user_id: me.id,
    }));
  });
  res.json(serializeSection(await loadSection(prisma, rca.id, team)));
});

// ---------- Actions (SPEC 4.7) ----------

const actionSchema = z
  .object({
    action: z.string().trim().min(1, 'Action is required').max(2000),
    owner_id: zUuid,
    due_date: zDate,
    status: zActionStatus.default('NOT_STARTED'),
    completed_on: zDate.nullable().optional(),
  })
  .strict();

const actionUpdateSchema = z
  .object({
    action: z.string().trim().min(1, 'Action is required').max(2000),
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

sectionsRouter.post('/sections/:team/actions', async (req, res) => {
  const me = currentUser(req);
  const { rca, ctx } = rcaOf(req);
  const team = teamParam(req);
  authorize(ctx, 'section.edit', { team }, `You cannot add actions to the ${team} section`);
  const body = parse(actionSchema, req.body);
  ensureRcaEditable(rca);
  const section = await loadSection(prisma, rca.id, team);
  ensureNotSubmitted(section);
  checkDueDate(body.due_date, rca.rca_date);
  await ensureParticipant(rca, body.owner_id, 'owner_id');

  const created = await prisma.$transaction(async (tx) => {
    const max = await tx.rcaAction.aggregate({ where: { section_id: section.id }, _max: { seq: true } });
    const row = await tx.rcaAction.create({ data: { ...body, section_id: section.id, seq: (max._max.seq ?? 0) + 1, created_by: me.id } });
    await writeAudit(tx, rcaAudit(rca, { entity: 'rca_action', entity_id: row.id, action: 'CREATE', new_value: { ...row, team }, user_id: me.id }));
    return row;
  });
  res.status(201).json(created);
});

sectionsRouter.patch('/sections/:team/actions/:aid', async (req, res) => {
  const me = currentUser(req);
  const { rca, ctx } = rcaOf(req);
  const team = teamParam(req);
  const aid = actionParam(req);
  authorize(ctx, 'section.edit', { team }, `You cannot edit actions of the ${team} section`);
  const body = parse(actionUpdateSchema, req.body);
  ensureRcaEditable(rca);
  const section = await loadSection(prisma, rca.id, team);
  const existing = await loadAction(section.id, aid);
  if (section.section_status === 'SUBMITTED' && Object.keys(body).some((k) => !TRACKING_FIELDS.has(k))) {
    throw conflict('Section is SUBMITTED; only action status and completed date can change');
  }
  checkDueDate(body.due_date, rca.rca_date);
  await ensureParticipant(rca, body.owner_id, 'owner_id');

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.rcaAction.update({ where: { id: aid }, data: body as Prisma.RcaActionUpdateInput });
    await writeAudit(tx, rcaAudit(rca, { entity: 'rca_action', entity_id: aid, action: 'UPDATE', ...diff(existing, body), user_id: me.id }));
    return row;
  });
  res.json(updated);
});

sectionsRouter.delete('/sections/:team/actions/:aid', async (req, res) => {
  const me = currentUser(req);
  const { rca, ctx } = rcaOf(req);
  const team = teamParam(req);
  const aid = actionParam(req);
  authorize(ctx, 'section.edit', { team }, `You cannot delete actions of the ${team} section`);
  ensureRcaEditable(rca);
  const section = await loadSection(prisma, rca.id, team);
  const existing = await loadAction(section.id, aid);
  ensureNotSubmitted(section);
  await prisma.$transaction(async (tx) => {
    await tx.rcaAction.delete({ where: { id: aid } });
    await writeAudit(tx, rcaAudit(rca, { entity: 'rca_action', entity_id: aid, action: 'DELETE', old_value: existing, user_id: me.id }));
  });
  res.status(204).end();
});
