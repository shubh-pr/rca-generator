import { Router } from 'express';
import { prisma } from '../../db.js';
import { pageResult, parsePage } from '../../lib/pagination.js';
import { authorize, can } from '../../policy/policy.js';
import { ACCESS_ENTITIES } from '../../services/accessAudit.js';
import { userRef } from '../../services/rcaQueries.js';
import { rcaOf } from './access.js';

export const rcaAuditRouter = Router({ mergeParams: true });

/** Change history of one RCA, for everyone who can see the RCA. */
rcaAuditRouter.get('/audit', async (req, res) => {
  const { rca, ctx } = rcaOf(req);
  authorize(ctx, 'audit.view');
  const p = parsePage(req.query, ['at'], '-at');
  // Access changes name invitees and failed attempts: only people who manage access see them.
  const where = can(ctx, 'collaborators.manage') ? { rca_id: rca.id } : { rca_id: rca.id, entity: { notIn: ACCESS_ENTITIES } };
  const [data, total] = await Promise.all([
    prisma.auditLog.findMany({ where, include: { user: userRef }, orderBy: [p.orderBy, { id: 'asc' }], skip: p.skip, take: p.take }),
    prisma.auditLog.count({ where }),
  ]);
  res.json(pageResult(data, total, p));
});
