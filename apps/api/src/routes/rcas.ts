import { Router } from 'express';
import { z } from 'zod';
import { currentUser } from '../auth/index.js';
import { prisma } from '../db.js';
import { todayIst } from '../lib/dates.js';
import { badRequest, emailNotVerified, forbidden } from '../lib/errors.js';
import { pageResult, parsePage } from '../lib/pagination.js';
import { parse, zUuid } from '../lib/validate.js';
import { workspaceRole } from '../policy/access.js';
import { canInWorkspace } from '../policy/policy.js';
import { buildRcaWhere, parseRcaFilters, RCA_SORTABLE } from '../services/rcaFilters.js';
import { createRcaRecord } from '../services/rcaCreate.js';
import { loadFullRca, overdueActionWhere, serializeRca } from '../services/rcaQueries.js';
import { checkIncidentTimes } from '../services/rcaRules.js';
import { loadRcaAccess } from '../policy/access.js';
import { createClosedSample } from '../services/sampleData.js';
import { withinQuota } from '../services/quota.js';
import { unscoped } from '../tenancy/context.js';
import { rcaEditableFields } from './rca/fields.js';

export const rcasRouter = Router();

const createSchema = z.object({ ...rcaEditableFields, workspace_id: zUuid.optional() }).strict();

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
        workspace_id: true,
        rca_number: true,
        rca_date: true,
        severity: true,
        environment: true,
        status: true,
        version: true,
        summary: true,
        ticket_id: true,
        closed_at: true,
        company_name: true,
        project_name: true,
        team_leader_name: true,
        is_sample: true,
        workspace: { select: { id: true, name: true } },
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

/** Default workspace for a new RCA: the user's personal workspace. */
async function defaultWorkspaceId(userId: string) {
  const personal = await prisma.workspace.findFirst({ where: { owner_id: userId, is_personal: true } });
  if (!personal) throw badRequest({ workspace_id: 'Choose a workspace' });
  return personal.id;
}

rcasRouter.post('/rcas', async (req, res) => {
  const me = currentUser(req);
  const body = parse(createSchema, req.body);
  const workspaceId = body.workspace_id ?? (await defaultWorkspaceId(me.id));
  const role = await workspaceRole(prisma, me.id, workspaceId);
  if (!role) throw badRequest({ workspace_id: 'Workspace not found' });
  if (!canInWorkspace(role, 'rca.create')) throw forbidden('Only workspace owners and editors can create RCAs');
  if (!me.email_verified_at) throw emailNotVerified();
  checkIncidentTimes(body);
  const { workspace_id: _w, ...fields } = body;
  const id = await withinQuota(workspaceId, { rcas: 1 }, (tx) => createRcaRecord(me, workspaceId, fields, tx));
  const { ctx } = await loadRcaAccess(prisma, me, id);
  res.status(201).json(serializeRca(await loadFullRca(prisma, id), ctx));
});


/**
 * Onboarding: a clearly labelled, complete example RCA (is_sample) in the user's personal workspace.
 * Every person in it is the user. It can be deleted like any other RCA.
 */
rcasRouter.post('/rcas/sample', async (req, res) => {
  const me = currentUser(req);
  if (!me.email_verified_at) throw emailNotVerified();
  const workspaceId = await defaultWorkspaceId(me.id);
  if (!canInWorkspace(await workspaceRole(prisma, me.id, workspaceId), 'rca.create')) throw forbidden();
  // Ownership was checked above; the rows are created in one transaction outside the scope filter,
  // because child rows of an uncommitted RCA are not visible to the filter's parent check.
  const id = await withinQuota(workspaceId, { rcas: 1 }, (tx) =>
    unscoped('create onboarding sample in the user\'s own workspace', async () =>
      (await createClosedSample(tx, workspaceId, { owner: me, lead: me, DEV: me, QA: me, PROD: me }, { isSample: true })).id,
    ),
  );
  const { ctx } = await loadRcaAccess(prisma, me, id);
  res.status(201).json(serializeRca(await loadFullRca(prisma, id), ctx));
});
