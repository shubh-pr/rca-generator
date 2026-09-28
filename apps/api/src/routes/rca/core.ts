import { Router } from 'express';
import { z } from 'zod';
import { currentUser } from '../../auth/index.js';
import { prisma } from '../../db.js';
import { diff, rcaAudit, writeAudit } from '../../lib/audit.js';
import { badRequest, conflict } from '../../lib/errors.js';
import { parse, zUuid } from '../../lib/validate.js';
import { rcaParticipants } from '../../policy/access.js';
import { authorize } from '../../policy/policy.js';
import { loadFullRca, serializeRca } from '../../services/rcaQueries.js';
import { checkIncidentTimes, ensureRcaEditable } from '../../services/rcaRules.js';
import { rcaOf } from './access.js';
import { rcaEditableFields } from './fields.js';

export const coreRouter = Router({ mergeParams: true });

const updateSchema = z.object(rcaEditableFields).partial().strict();
const zSignoffRole = z.enum(['PROJECT_OWNER', 'RCA_LEAD', 'DEV_LEAD', 'QA_LEAD', 'PROD_LEAD']);

coreRouter.get('/', async (req, res) => {
  const { rca, ctx } = rcaOf(req);
  authorize(ctx, 'rca.view');
  res.json(serializeRca(await loadFullRca(prisma, rca.id), ctx));
});

coreRouter.patch('/', async (req, res) => {
  const me = currentUser(req);
  const { rca, ctx } = rcaOf(req);
  authorize(ctx, 'rca.edit');
  const body = parse(updateSchema, req.body);
  ensureRcaEditable(rca);
  checkIncidentTimes({
    incident_start: body.incident_start ?? rca.incident_start,
    detected_at: body.detected_at === undefined ? rca.detected_at : body.detected_at,
    resolved_at: body.resolved_at === undefined ? rca.resolved_at : body.resolved_at,
  });
  await prisma.$transaction(async (tx) => {
    await tx.rca.update({ where: { id: rca.id }, data: { ...body, updated_by: me.id } });
    await writeAudit(tx, rcaAudit(rca, { entity: 'rca', entity_id: rca.id, action: 'UPDATE', ...diff(rca, body as Record<string, unknown>), user_id: me.id }));
  });
  res.json(serializeRca(await loadFullRca(prisma, rca.id), ctx));
});

coreRouter.delete('/', async (req, res) => {
  const me = currentUser(req);
  const { rca, ctx } = rcaOf(req);
  authorize(ctx, 'rca.delete', undefined, 'Only the workspace owner can delete an RCA');
  await prisma.$transaction(async (tx) => {
    await tx.rca.update({ where: { id: rca.id }, data: { is_deleted: true, updated_by: me.id } });
    await writeAudit(tx, rcaAudit(rca, { entity: 'rca', entity_id: rca.id, action: 'DELETE', old_value: { is_deleted: false }, new_value: { is_deleted: true }, user_id: me.id }));
  });
  res.status(204).end();
});

/** People with access to this RCA (pickers for owners and sign-off assignees). */
coreRouter.get('/participants', async (req, res) => {
  const { rca, ctx } = rcaOf(req);
  authorize(ctx, 'collaborators.view');
  res.json({ data: await rcaParticipants(prisma, rca) });
});

/** Assign (or clear) who signs a sign-off row; sign-off roles are labels the owner assigns. */
coreRouter.put('/signoffs/:role/assignee', async (req, res) => {
  const me = currentUser(req);
  const { rca, ctx } = rcaOf(req);
  const { role } = parse(z.object({ role: zSignoffRole }), { role: req.params.role });
  authorize(ctx, 'signoff.assign');
  const body = parse(z.object({ user_id: zUuid.nullable() }).strict(), req.body);
  ensureRcaEditable(rca);
  if (body.user_id && !(await rcaParticipants(prisma, rca)).some((p) => p.id === body.user_id)) {
    throw badRequest({ user_id: 'Assignee must have access to this RCA' });
  }
  const signoff = await prisma.rcaSignoff.findFirstOrThrow({ where: { rca_id: rca.id, role } });
  if (signoff.signed_at) throw conflict(`${role} is already signed`);
  await prisma.$transaction(async (tx) => {
    await tx.rcaSignoff.update({ where: { id: signoff.id }, data: { assignee_user_id: body.user_id } });
    await writeAudit(tx, rcaAudit(rca, {
      entity: 'rca_signoff',
      entity_id: signoff.id,
      action: 'ASSIGN',
      old_value: { role, assignee_user_id: signoff.assignee_user_id },
      new_value: { role, assignee_user_id: body.user_id },
      user_id: me.id,
    }));
  });
  res.json(serializeRca(await loadFullRca(prisma, rca.id), ctx));
});
