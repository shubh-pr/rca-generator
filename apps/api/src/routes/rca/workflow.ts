import { Router } from 'express';
import { z } from 'zod';
import { currentUser } from '../../auth/index.js';
import { prisma } from '../../db.js';
import { rcaAudit, writeAudit } from '../../lib/audit.js';
import { businessRule, conflict } from '../../lib/errors.js';
import { parse } from '../../lib/validate.js';
import { authorize } from '../../policy/policy.js';
import { loadFullRca, serializeRca } from '../../services/rcaQueries.js';
import { closeProblems, pendingTeamSignoffs, reviewProblems } from '../../services/workflowRules.js';
import { rcaOf } from './access.js';

export const workflowRouter = Router({ mergeParams: true });

const zTeam = z.enum(['DEV', 'QA', 'PROD']);
const zSignoffRole = z.enum(['PROJECT_OWNER', 'RCA_LEAD', 'DEV_LEAD', 'QA_LEAD', 'PROD_LEAD']);

function ensureStatus(actual: string, expected: string, action: string) {
  if (actual !== expected) throw conflict(`Cannot ${action}: RCA is ${actual}, expected ${expected}`);
}

const reset = { user_id: null, signed_at: null, comment: null };

workflowRouter.post('/submit-review', async (req, res) => {
  const me = currentUser(req);
  const { rca: row, ctx } = rcaOf(req);
  authorize(ctx, 'rca.review');
  const rca = await loadFullRca(prisma, row.id);
  ensureStatus(rca.status, 'DRAFT', 'submit for review');
  const { problems, fields } = reviewProblems(rca);
  if (problems.length) throw businessRule(`Cannot submit for review: ${problems.join('; ')}`, { problems }, fields);
  await prisma.$transaction(async (tx) => {
    await tx.rca.update({ where: { id: rca.id }, data: { status: 'IN_REVIEW', updated_by: me.id } });
    await writeAudit(tx, rcaAudit(rca, { entity: 'rca', entity_id: rca.id, action: 'SUBMIT', old_value: { status: 'DRAFT' }, new_value: { status: 'IN_REVIEW' }, user_id: me.id }));
  });
  res.json(serializeRca(await loadFullRca(prisma, rca.id), ctx));
});

const sendBackSchema = z.object({
  comment: z.string().trim().min(1, 'A comment is required').max(5000),
  teams: z.array(zTeam).min(1, 'Choose at least one team section to unlock'),
});

workflowRouter.post('/send-back', async (req, res) => {
  const me = currentUser(req);
  const { rca, ctx } = rcaOf(req);
  authorize(ctx, 'rca.review');
  const body = parse(sendBackSchema, req.body);
  ensureStatus(rca.status, 'IN_REVIEW', 'send back');
  const teams = [...new Set(body.teams)];
  await prisma.$transaction(async (tx) => {
    await tx.rca.update({ where: { id: rca.id }, data: { status: 'DRAFT', updated_by: me.id } });
    // Only the named team sections are unlocked.
    await tx.rcaTeamSection.updateMany({
      where: { rca_id: rca.id, team: { in: teams } },
      data: { section_status: 'IN_PROGRESS', submitted_at: null, version: { increment: 1 }, updated_by: me.id },
    });
    // Content will change, so earlier sign-offs no longer apply.
    await tx.rcaSignoff.updateMany({ where: { rca_id: rca.id }, data: reset });
    await writeAudit(tx, rcaAudit(rca, {
      entity: 'rca',
      entity_id: rca.id,
      action: 'SEND_BACK',
      old_value: { status: 'IN_REVIEW' },
      new_value: { status: 'DRAFT', comment: body.comment, unlocked_teams: teams },
      user_id: me.id,
    }));
  });
  res.json(serializeRca(await loadFullRca(prisma, rca.id), ctx));
});

workflowRouter.post('/close', async (req, res) => {
  const me = currentUser(req);
  const { rca: row, ctx } = rcaOf(req);
  authorize(ctx, 'rca.close');
  const rca = await loadFullRca(prisma, row.id);
  ensureStatus(rca.status, 'IN_REVIEW', 'close');
  const { problems, unsigned, open_actions } = closeProblems(rca);
  if (problems.length) throw businessRule(`Cannot close: ${problems.join('; ')}`, { problems, unsigned, open_actions });
  await prisma.$transaction(async (tx) => {
    await tx.rca.update({ where: { id: rca.id }, data: { status: 'CLOSED', closed_at: new Date(), updated_by: me.id } });
    await writeAudit(tx, rcaAudit(rca, { entity: 'rca', entity_id: rca.id, action: 'CLOSE', old_value: { status: 'IN_REVIEW' }, new_value: { status: 'CLOSED' }, user_id: me.id }));
  });
  res.json(serializeRca(await loadFullRca(prisma, rca.id), ctx));
});

workflowRouter.post('/reopen', async (req, res) => {
  const me = currentUser(req);
  const { rca, ctx } = rcaOf(req);
  authorize(ctx, 'rca.reopen');
  const body = parse(z.object({ reason: z.string().trim().min(1, 'A reason is required').max(5000) }), req.body);
  ensureStatus(rca.status, 'CLOSED', 'reopen');
  await prisma.$transaction(async (tx) => {
    await tx.rca.update({ where: { id: rca.id }, data: { status: 'DRAFT', version: { increment: 1 }, closed_at: null, updated_by: me.id } });
    await tx.rcaSignoff.updateMany({ where: { rca_id: rca.id }, data: reset });
    await writeAudit(tx, rcaAudit(rca, {
      entity: 'rca',
      entity_id: rca.id,
      action: 'REOPEN',
      old_value: { status: 'CLOSED', version: rca.version },
      new_value: { status: 'DRAFT', version: rca.version + 1, reason: body.reason },
      user_id: me.id,
    }));
  });
  res.json(serializeRca(await loadFullRca(prisma, rca.id), ctx));
});

workflowRouter.post('/signoffs/:role', async (req, res) => {
  const me = currentUser(req);
  const { rca: row, ctx } = rcaOf(req);
  const { role } = parse(z.object({ role: zSignoffRole }), { role: req.params.role });
  const rca = await loadFullRca(prisma, row.id);
  const signoff = rca.signoffs.find((s) => s.role === role)!;
  authorize(ctx, 'signoff.sign', signoff, `You cannot sign as ${role}`);
  const body = parse(z.object({ comment: z.string().trim().max(2000).optional() }), req.body ?? {});
  if (rca.status !== 'IN_REVIEW') throw conflict(`Sign-off is only possible while the RCA is IN_REVIEW (now ${rca.status})`);
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
    await writeAudit(tx, rcaAudit(rca, { entity: 'rca_signoff', entity_id: signoff.id, action: 'SIGN', new_value: { role, comment: body.comment ?? null }, user_id: me.id }));
  });
  res.json(serializeRca(await loadFullRca(prisma, rca.id), ctx));
});
