import { beforeAll, describe, expect, it } from 'vitest';
import { createClosedSample, createDraftSample } from '../src/services/sampleData.js';
import { api, bearer, createRca, createTeam, db as prisma, raw, resetDb, type Actor, type RoleKey } from './helpers.js';

let a: Record<RoleKey, Actor>;
let ws: string;

beforeAll(async () => {
  await resetDb();
  ({ a, workspaceId: ws } = await createTeam());
  const people = { owner: a.OWNER, lead: a.EDITOR, DEV: a.DEV, QA: a.QA, PROD: a.PROD };
  await raw(() =>
    prisma.$transaction(async (tx) => {
      const closed = await createClosedSample(tx, ws, people);
      await tx.rca.update({ where: { id: closed.id }, data: { closed_at: new Date() } }); // closed this month
      await createDraftSample(tx, ws, people); // QA has an overdue action
    }),
  );
  await createRca(a.EDITOR, ws, { severity: 'P3', environment: 'UAT', project_name: 'Mobile App' });
  // Another tenant's data must never appear in these numbers.
  await createRca(a.OUTSIDER, a.OUTSIDER.personalWorkspaceId, { severity: 'P1' });
});

type Counted = { count: number; filter: Record<string, string> };

async function listTotal(as: Actor, filter: Record<string, string>) {
  const res = await api().get(`/api/v1/rcas?${new URLSearchParams(filter)}`).set(bearer(as));
  expect(res.status).toBe(200);
  return res.body.total as number;
}

describe('dashboard summary', () => {
  it('returns KPI cards and chart data for the user\'s workspaces only', async () => {
    const res = await api().get('/api/v1/dashboard/summary').set(bearer(a.VIEWER));
    const k = res.body.kpis;
    expect(k.open_rcas.count).toBe(2);
    expect(k.closed_this_month.count).toBe(1);
    expect(k.overdue_actions.count).toBe(1);
    expect(k.avg_time_to_resolve_hours.sample).toBe(2);
    const c = res.body.charts;
    expect(c.by_severity.map((x: Counted & { key: string }) => [x.key, x.count])).toEqual([['P1', 1], ['P2', 1], ['P3', 1], ['P4', 0]]);
    expect(c.by_project.map((x: { label: string; count: number }) => [x.label, x.count])).toEqual(
      expect.arrayContaining([['Payment Gateway', 2], ['Mobile App', 1]]),
    );
    expect(c.sections_pending_by_team.map((x: Counted & { key: string }) => [x.key, x.count])).toEqual([['DEV', 1], ['QA', 2], ['PROD', 2]]);
    const outsider = await api().get('/api/v1/dashboard/summary').set(bearer(a.OUTSIDER));
    expect(outsider.body.kpis.open_rcas.count).toBe(1);
    expect(outsider.body.charts.by_project).toEqual([expect.objectContaining({ label: 'Payment Gateway', count: 1 })]);
  });

  it('every dashboard number matches the RCA list for the same filter', async () => {
    for (const query of ['', `workspace_id=${ws}`, 'project=Payment%20Gateway', 'severity=P2', 'environment=UAT']) {
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
      for (const item of items) expect(await listTotal(a.VIEWER, item.filter), JSON.stringify(item.filter)).toBe(item.count);
    }
  });
});

describe('my tasks', () => {
  it('contributors see their team sections and their open actions sorted by due date', async () => {
    const qa = await api().get('/api/v1/my-tasks').set(bearer(a.QA));
    expect(qa.body.sections.map((s: { team: string }) => s.team)).toEqual(['QA', 'QA']);
    expect(qa.body.actions).toHaveLength(1);
    expect(qa.body.actions[0]).toMatchObject({ is_overdue: true, status: 'NOT_STARTED' });
    const dev = await api().get('/api/v1/my-tasks').set(bearer(a.DEV));
    expect(dev.body.sections).toHaveLength(1);
    expect(dev.body.actions.map((x: { action: string }) => x.action)).toEqual(['Size connection pool from worker count']);
    const viewer = await api().get('/api/v1/my-tasks').set(bearer(a.VIEWER));
    expect(viewer.body).toEqual({ sections: [], actions: [], signoffs: [] });
    const editor = await api().get('/api/v1/my-tasks').set(bearer(a.EDITOR));
    expect(editor.body.sections).toHaveLength(5); // every unsubmitted section in DRAFT RCAs of the workspace
    const outsider = await api().get('/api/v1/my-tasks').set(bearer(a.OUTSIDER));
    expect(outsider.body.sections).toHaveLength(3);
  });
});
