import { Router } from 'express';
import { z } from 'zod';
import { currentUser } from '../auth/index.js';
import { prisma } from '../db.js';
import { writeAudit } from '../lib/audit.js';
import { businessRule, conflict } from '../lib/errors.js';
import { can, ensure } from '../lib/permissions.js';
import { idParam, parse, zUuid } from '../lib/validate.js';
import { loadFullRca, serializeRca } from '../services/rcaQueries.js';
import { closeProblems, pendingTeamSignoffs, reviewProblems } from '../services/workflowRules.js';

export const workflowRouter = Router();

const zTeam = z.enum(['DEV', 'QA', 'PROD']);
const zSignoffRole = z.enum(['PROJECT_OWNER', 'RCA_LEAD', 'DEV_LEAD', 'QA_LEAD', 'PROD_LEAD']);

function ensureStatus(actual: string, expected: string, action: string) {
  if (actual !== expected) throw conflict(`Cannot ${action}: RCA is ${actual}, expected ${expected}`);
}

const reset = { user_id: null, signed_at: null, comment: null };

workflowRouter.post('/rcas/:id/submit-review', async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParam, req.params);
  const rca = await loadFullRca(prisma, id);
  ensure(can.submitReview(me));
  ensureStatus(rca.status, 'DRAFT', 'submit for review');
  const { problems, fields } = reviewProblems(rca);
  if (problems.length) throw businessRule(`Cannot submit for review: ${problems.join('; ')}`, { problems }, fields);
  await prisma.$transaction(async (tx) => {
    await tx.rca.update({ where: { id }, data: { status: 'IN_REVIEW', updated_by: me.id } });
    await writeAudit(tx, { entity: 'rca', entity_id: id, rca_id: id, action: 'SUBMIT', old_value: { status: 'DRAFT' }, new_value: { status: 'IN_REVIEW' }, user_id: me.id });
  });
  res.json(serializeRca(await loadFullRca(prisma, id)));
});

const sendBackSchema = z.object({
  comment: z.string().trim().min(1, 'A comment is required'),
  teams: z.array(zTeam).min(1, 'Choose at least one team section to unlock'),
});

workflowRouter.post('/rcas/:id/send-back', async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParam, req.params);
  const rca = await loadFullRca(prisma, id);
  ensure(can.sendBack(me));
  const body = parse(sendBackSchema, req.body);
  ensureStatus(rca.status, 'IN_REVIEW', 'send back');
  const teams = [...new Set(body.teams)];
  await prisma.$transaction(async (tx) => {
    await tx.rca.update({ where: { id }, data: { status: 'DRAFT', updated_by: me.id } });
    // Only the named team sections are unlocked.
    await tx.rcaTeamSection.updateMany({
      where: { rca_id: id, team: { in: teams } },
      data: { section_status: 'IN_PROGRESS', submitted_at: null, version: { increment: 1 }, updated_by: me.id },
    });
    // Content will change, so earlier sign-offs no longer apply.
    await tx.rcaSignoff.updateMany({ where: { rca_id: id }, data: reset });
    await writeAudit(tx, {
      entity: 'rca',
      entity_id: id,
      rca_id: id,
      action: 'SEND_BACK',
      old_value: { status: 'IN_REVIEW' },
      new_value: { status: 'DRAFT', comment: body.comment, unlocked_teams: teams },
      user_id: me.id,
    });
  });
  res.json(serializeRca(await loadFullRca(prisma, id)));
});

workflowRouter.post('/rcas/:id/close', async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParam, req.params);
  const rca = await loadFullRca(prisma, id);
  ensure(can.closeRca(me));
  ensureStatus(rca.status, 'IN_REVIEW', 'close');
  const { problems, unsigned, open_actions } = closeProblems(rca);
  if (problems.length) throw businessRule(`Cannot close: ${problems.join('; ')}`, { problems, unsigned, open_actions });
  await prisma.$transaction(async (tx) => {
    await tx.rca.update({ where: { id }, data: { status: 'CLOSED', closed_at: new Date(), updated_by: me.id } });
    await writeAudit(tx, { entity: 'rca', entity_id: id, rca_id: id, action: 'CLOSE', old_value: { status: 'IN_REVIEW' }, new_value: { status: 'CLOSED' }, user_id: me.id });
  });
  res.json(serializeRca(await loadFullRca(prisma, id)));
});

workflowRouter.post('/rcas/:id/reopen', async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParam, req.params);
  const rca = await loadFullRca(prisma, id);
  ensure(can.reopenRca(me));
  const body = parse(z.object({ reason: z.string().trim().min(1, 'A reason is required') }), req.body);
  ensureStatus(rca.status, 'CLOSED', 'reopen');
  await prisma.$transaction(async (tx) => {
    await tx.rca.update({ where: { id }, data: { status: 'DRAFT', version: { increment: 1 }, closed_at: null, updated_by: me.id } });
    await tx.rcaSignoff.updateMany({ where: { rca_id: id }, data: reset });
    await writeAudit(tx, {
      entity: 'rca',
      entity_id: id,
      rca_id: id,
      action: 'REOPEN',
      old_value: { status: 'CLOSED', version: rca.version },
      new_value: { status: 'DRAFT', version: rca.version + 1, reason: body.reason },
      user_id: me.id,
    });
  });
  res.json(serializeRca(await loadFullRca(prisma, id)));
});

workflowRouter.post('/rcas/:id/signoffs/:role', async (req, res) => {
  const me = currentUser(req);
  const { id, role } = parse(z.object({ id: zUuid, role: zSignoffRole }), req.params);
  const rca = await loadFullRca(prisma, id);
  ensure(can.signoff(me, role), `You cannot sign as ${role}`);
  const body = parse(z.object({ comment: z.string().trim().max(2000).optional() }), req.body ?? {});
  if (rca.status !== 'IN_REVIEW') throw conflict(`Sign-off is only possible while the RCA is IN_REVIEW (now ${rca.status})`);
  const signoff = rca.signoffs.find((s) => s.role === role)!;
  if (signoff.signed_at) throw conflict(`${role} has already signed`);
  if (role === 'PROJECT_OWNER' || role === 'RCA_LEAD') {
    const pending = pendingTeamSignoffs(rca);
    if (pending.length) throw businessRule(`The team lead sign-offs come first: ${pending.join(', ')} pending`, { pending });
  }
  await prisma.$transaction(async (tx) => {
    // Guard against a concurrent double sign.
    const updated = await tx.rcaSignoff.updateMany({
      where: { id: signoff.id, signed_at: null },
      data: { user_id: me.id, signed_at: new Date(), comment: body.comment ?? null },
    });
    if (updated.count === 0) throw conflict(`${role} has already signed`);
    await writeAudit(tx, { entity: 'rca_signoff', entity_id: signoff.id, rca_id: id, action: 'SIGN', new_value: { role, comment: body.comment ?? null }, user_id: me.id });
  });
  res.json(serializeRca(await loadFullRca(prisma, id)));
});
