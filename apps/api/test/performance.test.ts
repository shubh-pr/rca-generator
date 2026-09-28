import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePdfBrowser } from '../src/export/pdf.js';
import { api, bearer, createActors, createProject, prisma, resetDb, type Actor, type RoleKey } from './helpers.js';

let a: Record<RoleKey, Actor>;
const N = 10_000;

beforeAll(async () => {
  await resetDb();
  a = await createActors();
  const { project } = await createProject(a.PROJECT_OWNER.id);
  const severities = ['P1', 'P2', 'P3', 'P4'] as const;
  const statuses = ['DRAFT', 'IN_REVIEW', 'CLOSED'] as const;
  const rows = Array.from({ length: N }, (_, i) => ({
    id: randomUUID(),
    rca_number: `RCA-2026-${String(i + 1).padStart(5, '0')}`,
    rca_date: new Date(Date.UTC(2026, i % 12, (i % 28) + 1)),
    project_id: project.id,
    team_leader_id: a.RCA_LEAD.id,
    severity: severities[i % 4],
    environment: 'PROD' as const,
    status: statuses[i % 3],
    incident_start: new Date(Date.UTC(2026, i % 12, (i % 28) + 1, 8)),
    summary: `Synthetic incident ${i}`,
  }));
  for (let i = 0; i < N; i += 2000) await prisma.rca.createMany({ data: rows.slice(i, i + 2000) });
  const sections = rows.flatMap((r, i) =>
    (['DEV', 'QA', 'PROD'] as const).map((team) => ({ rca_id: r.id, team, section_status: i % 2 ? ('SUBMITTED' as const) : ('IN_PROGRESS' as const) })),
  );
  for (let i = 0; i < sections.length; i += 5000) await prisma.rcaTeamSection.createMany({ data: sections.slice(i, i + 5000) });
}, 180_000);

afterAll(() => closePdfBrowser());

describe('performance (SPEC 8)', () => {
  it(`RCA list responds in under 2 seconds with ${N} RCAs`, async () => {
    for (const q of ['', 'status=DRAFT&severity=P1', 'team=QA&sort=rca_number', 'q=incident%2099', 'page=250&page_size=20']) {
      const t0 = performance.now();
      const res = await api().get(`/api/v1/rcas?${q}`).set(bearer(a.VIEWER));
      const ms = performance.now() - t0;
      expect(res.status).toBe(200);
      expect(ms, `GET /rcas?${q} took ${ms.toFixed(0)} ms`).toBeLessThan(2000);
    }
    const summary0 = performance.now();
    expect((await api().get('/api/v1/dashboard/summary').set(bearer(a.VIEWER))).status).toBe(200);
    expect(performance.now() - summary0).toBeLessThan(2000);
  });

  it('PDF export finishes in under 10 seconds', async () => {
    const rca = await prisma.rca.findFirstOrThrow();
    const t0 = performance.now();
    const res = await api().get(`/api/v1/rcas/${rca.id}/export?format=pdf`).set(bearer(a.VIEWER));
    expect(res.status).toBe(200);
    expect(performance.now() - t0).toBeLessThan(10_000);
  });
});
