import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePdfBrowser } from '../src/export/pdf.js';
import { api, bearer, createUser, db as prisma, raw, resetDb, type Actor } from './helpers.js';

let user: Actor;
const N = 10_000;

beforeAll(async () => {
  await resetDb();
  user = await createUser('Busy');
  const other = await createUser('Other');
  const severities = ['P1', 'P2', 'P3', 'P4'] as const;
  const statuses = ['DRAFT', 'IN_REVIEW', 'CLOSED'] as const;
  const rows = Array.from({ length: N }, (_, i) => ({
    id: randomUUID(),
    rca_number: `RCA-2026-${String(i + 1).padStart(5, '0')}`,
    rca_date: new Date(Date.UTC(2026, i % 12, (i % 28) + 1)),
    // Half the rows belong to another tenant, so the scoped queries have real filtering to do.
    workspace_id: i % 2 ? user.personalWorkspaceId : other.personalWorkspaceId,
    project_name: `Project ${i % 7}`,
    severity: severities[i % 4],
    environment: 'PROD' as const,
    status: statuses[i % 3],
    incident_start: new Date(Date.UTC(2026, i % 12, (i % 28) + 1, 8)),
    summary: `Synthetic incident ${i}`,
  }));
  for (let i = 0; i < N; i += 2000) await raw(() => prisma.rca.createMany({ data: rows.slice(i, i + 2000) }));
  const sections = rows.flatMap((r, i) =>
    (['DEV', 'QA', 'PROD'] as const).map((team) => ({ rca_id: r.id, team, section_status: i % 2 ? ('SUBMITTED' as const) : ('IN_PROGRESS' as const) })),
  );
  for (let i = 0; i < sections.length; i += 5000) await raw(() => prisma.rcaTeamSection.createMany({ data: sections.slice(i, i + 5000) }));
}, 180_000);

afterAll(() => closePdfBrowser());

describe('performance (SPEC 8)', () => {
  it(`RCA list responds in under 2 seconds with ${N} RCAs`, async () => {
    for (const q of ['', 'status=DRAFT&severity=P1', 'team=QA&sort=rca_number', 'q=incident%2099', 'page=250&page_size=20']) {
      const t0 = performance.now();
      const res = await api().get(`/api/v1/rcas?${q}`).set(bearer(user));
      const ms = performance.now() - t0;
      expect(res.status).toBe(200);
      expect(ms, `GET /rcas?${q} took ${ms.toFixed(0)} ms`).toBeLessThan(2000);
    }
    const summary0 = performance.now();
    expect((await api().get('/api/v1/dashboard/summary').set(bearer(user))).status).toBe(200);
    expect(performance.now() - summary0).toBeLessThan(2000);
  });

  it('PDF export finishes in under 10 seconds', async () => {
    const rca = await raw(() => prisma.rca.findFirstOrThrow({ where: { workspace_id: user.personalWorkspaceId } }));
    const t0 = performance.now();
    const res = await api().get(`/api/v1/rcas/${rca.id}/export?format=pdf`).set(bearer(user));
    expect(res.status).toBe(200);
    expect(performance.now() - t0).toBeLessThan(10_000);
  });
});
