import { beforeAll, describe, expect, it } from 'vitest';
import { seedSampleRcas } from '../prisma/seedSampleRcas.js';
import { api, bearer, createActors, createProject, createRca, prisma, resetDb, type Actor, type RoleKey } from './helpers.js';

let a: Record<RoleKey, Actor>;
let projectId: string;

beforeAll(async () => {
  await resetDb();
  a = await createActors();
  projectId = (await createProject(a.PROJECT_OWNER.id)).project.id;
  await seedSampleRcas(prisma, projectId); // 1 CLOSED + 1 DRAFT (with an overdue QA action)
  const other = (await createProject(a.PROJECT_OWNER.id, 'Mobile App')).project.id;
  await createRca(a.RCA_LEAD, other, a.RCA_LEAD.id, { severity: 'P3', environment: 'UAT' });
  const closed = await prisma.rca.findFirstOrThrow({ where: { status: 'CLOSED' } });
  await prisma.rca.update({ where: { id: closed.id }, data: { closed_at: new Date() } }); // closed this month
});

type Counted = { count: number; filter: Record<string, string> };

async function listTotal(filter: Record<string, string>) {
  const res = await api().get(`/api/v1/rcas?${new URLSearchParams(filter)}`).set(bearer(a.VIEWER));
  expect(res.status).toBe(200);
  return res.body.total as number;
}

describe('dashboard summary', () => {
  it('returns KPI cards and chart data', async () => {
    const res = await api().get('/api/v1/dashboard/summary').set(bearer(a.VIEWER));
    expect(res.status).toBe(200);
    const k = res.body.kpis;
    expect(k.open_rcas.count).toBe(2);
    expect(k.in_review.count).toBe(0);
    expect(k.closed_this_month.count).toBe(1);
    expect(k.overdue_actions.count).toBe(1);
    expect(k.overdue_actions.rcas).toBe(1);
    expect(k.avg_time_to_resolve_hours.sample).toBe(2);
    expect(k.avg_time_to_resolve_hours.value).toBeCloseTo((55 / 60 + 40 / 60) / 2, 1);
    const c = res.body.charts;
    expect(c.by_severity.map((x: Counted & { key: string }) => [x.key, x.count])).toEqual([['P1', 1], ['P2', 1], ['P3', 1], ['P4', 0]]);
    expect(c.by_project.map((x: { label: string; count: number }) => [x.label, x.count])).toEqual(
      expect.arrayContaining([['Payment Gateway', 2], ['Mobile App', 1]]),
    );
    expect(c.sections_pending_by_team.map((x: Counted & { key: string }) => [x.key, x.count])).toEqual([['DEV', 1], ['QA', 2], ['PROD', 2]]);
    const causes = Object.fromEntries(c.by_cause_category.map((x: { key: string; count: number }) => [x.key, x.count]));
    expect(causes).toMatchObject({ CODE_DEFECT: 2, TEST_GAP: 2, INFRA: 1 });
  });

  it('acceptance: every dashboard number matches the RCA list for the same filter', async () => {
    for (const query of ['', `project_id=${projectId}`, 'severity=P2', 'environment=UAT']) {
      const res = await api().get(`/api/v1/dashboard/summary?${query}`).set(bearer(a.VIEWER));
      const k = res.body.kpis;
      const items: Counted[] = [
        k.open_rcas,
        k.in_review,
        k.closed_this_month,
        { count: k.overdue_actions.rcas, filter: k.overdue_actions.filter },
        ...res.body.charts.by_severity,
        ...res.body.charts.by_project,
        ...res.body.charts.sections_pending_by_team,
      ];
      for (const item of items) {
        expect(await listTotal(item.filter), JSON.stringify(item.filter)).toBe(item.count);
      }
    }
  });
});

describe('my tasks', () => {
  it('shows pending sections of my team and my open actions sorted by due date', async () => {
    const qa = await api().get('/api/v1/my-tasks').set(bearer(a.QA));
    expect(qa.status).toBe(200);
    // QA section of the DRAFT seed RCA and of the new RCA; the CLOSED RCA is not a task.
    expect(qa.body.sections.map((s: { team: string }) => s.team)).toEqual(['QA', 'QA']);
    expect(qa.body.actions).toHaveLength(1);
    expect(qa.body.actions[0]).toMatchObject({ is_overdue: true, status: 'NOT_STARTED' });

    const dev = await api().get('/api/v1/my-tasks').set(bearer(a.DEV));
    expect(dev.body.sections).toHaveLength(1); // DEV section of the seed DRAFT is already submitted
    expect(dev.body.actions.map((x: { action: string }) => x.action)).toEqual(['Size connection pool from worker count']);

    const viewer = await api().get('/api/v1/my-tasks').set(bearer(a.VIEWER));
    expect(viewer.body).toEqual({ sections: [], actions: [] });
  });
});
