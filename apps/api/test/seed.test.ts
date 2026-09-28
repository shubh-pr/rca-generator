import { beforeAll, describe, expect, it } from 'vitest';
import { seedSampleRcas } from '../prisma/seedSampleRcas.js';
import { loadFullRca } from '../src/services/rcaQueries.js';
import { closeProblems } from '../src/services/workflowRules.js';
import { createActors, createProject, prisma, resetDb } from './helpers.js';

describe('seed sample RCAs', () => {
  beforeAll(async () => {
    await resetDb();
    const a = await createActors();
    const { project } = await createProject(a.PROJECT_OWNER.id);
    await seedSampleRcas(prisma, project.id);
    await seedSampleRcas(prisma, project.id); // idempotent
  });

  it('creates one CLOSED and one DRAFT RCA with numbers, 3 sections, 15 whys and 5 sign-offs each', async () => {
    const rcas = await prisma.rca.findMany({ orderBy: { rca_number: 'asc' }, include: { sections: { include: { whys: true } }, signoffs: true } });
    expect(rcas.map((r) => [r.rca_number, r.status])).toEqual([
      ['RCA-2026-0001', 'CLOSED'],
      ['RCA-2026-0002', 'DRAFT'],
    ]);
    for (const r of rcas) {
      expect(r.sections).toHaveLength(3);
      expect(r.sections.flatMap((s) => s.whys)).toHaveLength(15);
      expect(r.signoffs).toHaveLength(5);
    }
  });

  it('the CLOSED sample satisfies every close rule', async () => {
    const closed = await prisma.rca.findFirstOrThrow({ where: { status: 'CLOSED' } });
    const full = await loadFullRca(prisma, closed.id);
    expect(closeProblems(full).problems).toEqual([]);
    expect(full.sections.every((s) => s.section_status === 'SUBMITTED')).toBe(true);
  });
});
