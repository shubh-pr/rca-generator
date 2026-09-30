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
import { assertBucketRoom } from '../billing/entitlements.js';
import { unscoped } from '../tenancy/context.js';
import { rcaEditableFields } from './rca/fields.js';

export const rcasRouter = Router();

const createSchema = z.object({ ...rcaEditableFields, workspace_id: zUuid.optional() }).strict();

rcasRouter.get('/rcas', async (req, res) => {
  const filters = parseRcaFilters(req.query);
  const p = parsePage(req.query, RCA_SORTABLE, '-rca_date');
  const me = currentUser(req);
  const where = buildRcaWhere(filters, me.id);
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
        workspace: { select: { id: true, name: true, owner: { select: { name: true } } } },
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
  const shared = await sharedInfo(me.id, rows);
  res.json(
    pageResult(
      rows.map(({ workspace: { owner: _owner, ...workspace }, ...r }) => ({ ...r, workspace, has_overdue: overdueIds.has(r.id), shared: shared.get(r.id) ?? null })),
      total,
      p,
    ),
  );
});

/**
 * For RCAs outside the user's own workspaces (shared with them directly): who shared it, from which
 * workspace, and the access it gives. "Shared by" is whoever sent the invitation the user accepted;
 * if unknown, the workspace's owner.
 */
async function sharedInfo(userId: string, rows: { id: string; workspace_id: string; workspace: { name: string; owner: { name: string } } }[]) {
  const memberOf = new Set((await prisma.workspaceMember.findMany({ where: { user_id: userId }, select: { workspace_id: true } })).map((m) => m.workspace_id));
  const outside = rows.filter((r) => !memberOf.has(r.workspace_id));
  const result = new Map<string, { by: string; workspace_name: string; role: string; team: string | null }>();
  if (!outside.length) return result;
  const ids = outside.map((r) => r.id);
  const [collabs, invitations] = await Promise.all([
    prisma.rcaCollaborator.findMany({ where: { user_id: userId, rca_id: { in: ids } }, select: { rca_id: true, role: true, team: true } }),
    prisma.invitation.findMany({ where: { accepted_by: userId, rca_id: { in: ids } }, select: { rca_id: true, accepted_at: true, inviter: { select: { name: true } } }, orderBy: { accepted_at: 'desc' } }),
  ]);
  for (const r of outside) {
    const c = collabs.find((x) => x.rca_id === r.id);
    if (!c) continue;
    const inv = invitations.find((i) => i.rca_id === r.id);
    result.set(r.id, { by: inv?.inviter?.name ?? r.workspace.owner.name, workspace_name: r.workspace.name, role: c.role, team: c.team });
  }
  return result;
}

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
  const id = await withinQuota(workspaceId, { rcas: 1 }, async (tx) => {
    // Free bucket: at most FREE_RCA_LIMIT unpaid RCAs unless the workspace is subscribed.
    await assertBucketRoom(tx, await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId } }));
    return createRcaRecord(me, workspaceId, fields, tx);
  });
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
  const id = await withinQuota(workspaceId, { rcas: 1 }, async (tx) => {
    // The sample is an RCA too, so it takes a slot of the free bucket (it can be deleted).
    await assertBucketRoom(tx, await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId } }));
    return unscoped('create onboarding sample in the user\'s own workspace', async () =>
      (await createClosedSample(tx, workspaceId, { owner: me, lead: me, DEV: me, QA: me, PROD: me }, { isSample: true })).id,
    );
  });
  const { ctx } = await loadRcaAccess(prisma, me, id);
  res.status(201).json(serializeRca(await loadFullRca(prisma, id), ctx));
});
