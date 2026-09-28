import type { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { currentUser } from '../auth/index.js';
import { prisma } from '../db.js';
import { pageResult, parsePage } from '../lib/pagination.js';
import { can, ensure } from '../lib/permissions.js';
import { idParam, parse, zDate, zUuid } from '../lib/validate.js';
import { findRcaOr404, userRef } from '../services/rcaQueries.js';

export const auditRouter = Router();

const include = { user: userRef, rca: { select: { id: true, rca_number: true } } } satisfies Prisma.AuditLogInclude;

const filterSchema = z.object({
  rca_id: zUuid.optional(),
  rca_number: z.string().trim().optional(),
  user_id: zUuid.optional(),
  action: z.string().trim().max(20).optional(),
  entity: z.string().trim().max(40).optional(),
  date_from: zDate.optional(),
  date_to: zDate.optional(),
});

const IST_OFFSET = 5.5 * 3_600_000;

/** Change history of one RCA (SPEC 5.1: Lead, Owner, Admin). */
auditRouter.get('/rcas/:id/audit', async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParam, req.params);
  await findRcaOr404(prisma, id);
  ensure(can.viewRcaAudit(me));
  const p = parsePage(req.query, ['at'], '-at');
  const where = { rca_id: id };
  const [data, total] = await Promise.all([
    prisma.auditLog.findMany({ where, include, orderBy: [p.orderBy, { id: 'asc' }], skip: p.skip, take: p.take }),
    prisma.auditLog.count({ where }),
  ]);
  res.json(pageResult(data, total, p));
});

/** Audit log screen: filter by RCA, user and date (SPEC 6.1: Owner and Admin). */
auditRouter.get('/audit', async (req, res) => {
  const me = currentUser(req);
  ensure(can.viewAuditLog(me));
  const raw = req.query as Record<string, unknown>;
  const f = parse(filterSchema, Object.fromEntries(Object.entries(raw).filter(([k, v]) => k in filterSchema.shape && v !== '')));
  const p = parsePage(req.query, ['at'], '-at');
  const and: Prisma.AuditLogWhereInput[] = [];
  if (f.rca_id) and.push({ rca_id: f.rca_id });
  if (f.rca_number) and.push({ rca: { rca_number: { contains: f.rca_number, mode: 'insensitive' } } });
  if (f.user_id) and.push({ user_id: f.user_id });
  if (f.action) and.push({ action: f.action });
  if (f.entity) and.push({ entity: f.entity });
  // Dates are IST calendar days.
  if (f.date_from) and.push({ at: { gte: new Date(f.date_from.getTime() - IST_OFFSET) } });
  if (f.date_to) and.push({ at: { lt: new Date(f.date_to.getTime() + 86_400_000 - IST_OFFSET) } });
  const where = { AND: and };
  const [data, total] = await Promise.all([
    prisma.auditLog.findMany({ where, include, orderBy: [p.orderBy, { id: 'asc' }], skip: p.skip, take: p.take }),
    prisma.auditLog.count({ where }),
  ]);
  res.json(pageResult(data, total, p));
});
