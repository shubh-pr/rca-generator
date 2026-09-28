import type { CauseCategory, Prisma } from '@prisma/client';
import { Router } from 'express';
import { currentUser } from '../auth/index.js';
import { prisma } from '../db.js';
import { startOfMonthIst, todayIst, ymd } from '../lib/dates.js';
import { buildRcaWhere, parseRcaFilters } from '../services/rcaFilters.js';
import { overdueActionWhere, userRef } from '../services/rcaQueries.js';

export const dashboardRouter = Router();

type Query = Record<string, string>;

/** Every count is computed with the same where-builder as GET /rcas, so a card's link shows the same number. */
dashboardRouter.get('/dashboard/summary', async (req, res) => {
  const base = parseRcaFilters(req.query);
  const baseQuery: Query = Object.fromEntries(Object.entries(req.query as Record<string, string>).filter(([k]) => k in base));
  const count = async (extra: Query) => {
    const f = parseRcaFilters({ ...baseQuery, ...extra });
    return { count: await prisma.rca.count({ where: buildRcaWhere(f) }), filter: { ...baseQuery, ...extra } };
  };
  const today = todayIst();
  const monthStart = ymd(new Date(startOfMonthIst().getTime() + 5.5 * 3_600_000));

  const [open, inReview, closedThisMonth, withOverdue] = await Promise.all([
    count({ open: 'true' }),
    count({ status: 'IN_REVIEW' }),
    count({ status: 'CLOSED', closed_from: monthStart, closed_to: ymd(today) }),
    count({ overdue: 'true' }),
  ]);
  const baseWhere = buildRcaWhere(base);
  const overdueActions = await prisma.rcaAction.count({ where: { ...overdueActionWhere(today), section: { rca: baseWhere } } });

  const resolved = await prisma.rca.findMany({
    where: { AND: [baseWhere, { resolved_at: { not: null } }] },
    select: { incident_start: true, resolved_at: true },
  });
  const avgHours = resolved.length
    ? Math.round((resolved.reduce((s, r) => s + (r.resolved_at!.getTime() - r.incident_start.getTime()), 0) / resolved.length / 3_600_000) * 10) / 10
    : null;

  const bySeverity = await Promise.all((['P1', 'P2', 'P3', 'P4'] as const).map(async (s) => ({ key: s, ...(await count({ severity: s })) })));
  const pendingByTeam = await Promise.all((['DEV', 'QA', 'PROD'] as const).map(async (t) => ({ key: t, ...(await count({ team: t })) })));

  const projectIds = await prisma.rca.groupBy({ by: ['project_id'], where: baseWhere, _count: { _all: true } });
  const projects = await prisma.project.findMany({ where: { id: { in: projectIds.map((p) => p.project_id) } }, select: { id: true, name: true } });
  const byProject = await Promise.all(
    projectIds
      .sort((a, b) => b._count._all - a._count._all)
      .map(async (p) => ({ key: p.project_id, label: projects.find((x) => x.id === p.project_id)?.name ?? '', ...(await count({ project_id: p.project_id })) })),
  );

  // Cause category is per team section: count sections with that category among the filtered RCAs.
  const causes = await prisma.rcaTeamSection.groupBy({
    by: ['cause_category'],
    where: { cause_category: { not: null }, rca: baseWhere },
    _count: { _all: true },
  });
  const byCause = causes
    .map((c) => ({ key: c.cause_category as CauseCategory, count: c._count._all }))
    .sort((a, b) => b.count - a.count);

  res.json({
    filters: baseQuery,
    kpis: {
      open_rcas: open,
      in_review: inReview,
      closed_this_month: closedThisMonth,
      overdue_actions: { count: overdueActions, rcas: withOverdue.count, filter: withOverdue.filter },
      avg_time_to_resolve_hours: { value: avgHours, sample: resolved.length },
    },
    charts: { by_severity: bySeverity, by_cause_category: byCause, by_project: byProject, sections_pending_by_team: pendingByTeam },
  });
});

/** Sections waiting for me and actions I own, sorted by due date (SPEC 6.1 My tasks). */
dashboardRouter.get('/my-tasks', async (req, res) => {
  const me = currentUser(req);
  const today = todayIst();
  const sectionOr: Prisma.RcaTeamSectionWhereInput[] = [{ contributor_id: me.id }];
  if (me.team && ['DEV', 'QA', 'PROD'].includes(me.role)) sectionOr.push({ team: me.team });
  const sections = await prisma.rcaTeamSection.findMany({
    where: { OR: sectionOr, section_status: { not: 'SUBMITTED' }, rca: { is_deleted: false, status: 'DRAFT' } },
    select: {
      id: true,
      team: true,
      section_status: true,
      target_date: true,
      version: true,
      rca: { select: { id: true, rca_number: true, rca_date: true, severity: true, summary: true, project: { select: { name: true } } } },
    },
  });
  sections.sort((a, b) => {
    const da = (a.target_date ?? a.rca.rca_date).getTime();
    const db = (b.target_date ?? b.rca.rca_date).getTime();
    return da - db || a.rca.rca_number.localeCompare(b.rca.rca_number);
  });
  const actions = await prisma.rcaAction.findMany({
    where: { owner_id: me.id, status: { not: 'COMPLETED' }, followup: { is: null }, section: { rca: { is_deleted: false, status: { not: 'CLOSED' } } } },
    orderBy: [{ due_date: 'asc' }, { seq: 'asc' }],
    include: {
      owner: userRef,
      section: { select: { team: true, section_status: true, rca: { select: { id: true, rca_number: true, severity: true, project: { select: { name: true } } } } } },
    },
  });
  res.json({
    sections: sections.map((s) => ({ ...s, due_date: s.target_date })),
    actions: actions.map((a) => ({ ...a, is_overdue: a.due_date < today })),
  });
});

