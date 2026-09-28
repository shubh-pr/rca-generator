import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { formatRcaNumber } from '../src/services/rcaNumber.js';
import {
  api,
  bearer,
  createActors,
  createProject,
  createRca,
  prisma,
  rcaBody,
  resetDb,
  ROLE_KEYS,
  type Actor,
  type RoleKey,
} from './helpers.js';

let a: Record<RoleKey, Actor>;
let projectId: string;

beforeEach(async () => {
  await resetDb();
  a = await createActors();
  projectId = (await createProject(a.PROJECT_OWNER.id)).project.id;
});

describe('RCA number generation', () => {
  it('formats RCA-YYYY-NNNN', () => {
    expect(formatRcaNumber(2026, 7)).toBe('RCA-2026-0007');
    expect(formatRcaNumber(2026, 12345)).toBe('RCA-2026-12345');
  });

  it('numbers RCAs sequentially per year and restarts each year', async () => {
    const r1 = await createRca(a.RCA_LEAD, projectId, a.RCA_LEAD.id);
    const r2 = await createRca(a.RCA_LEAD, projectId, a.RCA_LEAD.id);
    const r3 = await createRca(a.RCA_LEAD, projectId, a.RCA_LEAD.id, {
      rca_date: '2027-01-02',
      incident_start: '2027-01-01T10:00:00Z',
    });
    expect([r1.rca_number, r2.rca_number, r3.rca_number]).toEqual(['RCA-2026-0001', 'RCA-2026-0002', 'RCA-2027-0001']);
  });

  it('never duplicates numbers under concurrent creates', async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        api().post('/api/v1/rcas').set(bearer(a.ADMIN)).send(rcaBody(projectId, a.RCA_LEAD.id)),
      ),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    const numbers = results.map((r) => r.body.rca_number).sort();
    expect(new Set(numbers).size).toBe(12);
    expect(numbers[0]).toBe('RCA-2026-0001');
    expect(numbers[11]).toBe('RCA-2026-0012');
  });

  it('ignores a client-supplied rca_number (400: unknown field)', async () => {
    const res = await api()
      .post('/api/v1/rcas')
      .set(bearer(a.ADMIN))
      .send({ ...rcaBody(projectId, a.RCA_LEAD.id), rca_number: 'RCA-1999-0001' });
    expect(res.status).toBe(400);
  });

  it('rca_number cannot be changed by PATCH', async () => {
    const r = await createRca(a.ADMIN, projectId, a.RCA_LEAD.id);
    const res = await api().patch(`/api/v1/rcas/${r.id}`).set(bearer(a.ADMIN)).send({ rca_number: 'X' });
    expect(res.status).toBe(400);
  });
});

describe('create RCA', () => {
  it('returns 201 with number, DRAFT, version 1 and creates 3 sections, 15 whys, 5 sign-offs', async () => {
    const res = await api().post('/api/v1/rcas').set(bearer(a.RCA_LEAD)).send(rcaBody(projectId, a.RCA_LEAD.id));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ rca_number: 'RCA-2026-0001', status: 'DRAFT', version: 1, rca_date: '2026-09-28' });
    expect(res.body.sections.map((s: { team: string }) => s.team)).toEqual(['DEV', 'QA', 'PROD']);
    expect(res.body.sections.every((s: { section_status: string; version: number }) => s.section_status === 'NOT_STARTED' && s.version === 1)).toBe(true);
    expect(res.body.sections.every((s: { whys: unknown[] }) => s.whys.length === 5)).toBe(true);
    expect(res.body.signoffs.map((s: { role: string }) => s.role).sort()).toEqual(
      ['DEV_LEAD', 'PROD_LEAD', 'PROJECT_OWNER', 'QA_LEAD', 'RCA_LEAD'].sort(),
    );
    expect(res.body.project.owner.id).toBe(a.PROJECT_OWNER.id);
    expect(res.body.project.company.name).toBeDefined();
    expect(res.body.prepared_by).toBe(a.RCA_LEAD.id);

    expect(await prisma.rcaTeamSection.count({ where: { rca_id: res.body.id } })).toBe(3);
    expect(await prisma.rcaSignoff.count({ where: { rca_id: res.body.id } })).toBe(5);
    const audit = await prisma.auditLog.findMany({ where: { rca_id: res.body.id } });
    expect(audit.map((x) => x.action)).toEqual(['CREATE']);
  });

  it.each(['DEV', 'QA', 'PROD', 'VIEWER'] as RoleKey[])('%s cannot create an RCA (403)', async (role) => {
    const res = await api().post('/api/v1/rcas').set(bearer(a[role])).send(rcaBody(projectId, a.RCA_LEAD.id));
    expect(res.status).toBe(403);
  });

  it.each(['ADMIN', 'PROJECT_OWNER', 'RCA_LEAD'] as RoleKey[])('%s can create an RCA', async (role) => {
    const res = await api().post('/api/v1/rcas').set(bearer(a[role])).send(rcaBody(projectId, a.RCA_LEAD.id));
    expect(res.status).toBe(201);
  });

  it('validates required fields and enum values (400)', async () => {
    const res = await api()
      .post('/api/v1/rcas')
      .set(bearer(a.ADMIN))
      .send({ severity: 'P9', environment: 'DEV', detection_method: 'PSYCHIC' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION');
    for (const f of ['rca_date', 'project_id', 'team_leader_id', 'severity', 'environment', 'incident_start', 'summary', 'detection_method']) {
      expect(res.body.fields).toHaveProperty(f);
    }
  });

  it('enforces incident_start <= detected_at <= resolved_at (400)', async () => {
    const early = await api()
      .post('/api/v1/rcas')
      .set(bearer(a.ADMIN))
      .send(rcaBody(projectId, a.RCA_LEAD.id, { detected_at: '2026-09-27T13:00:00+05:30' }));
    expect(early.status).toBe(400);
    expect(early.body.fields).toEqual({ detected_at: 'Must be after incident_start' });

    const resolvedBeforeDetected = await api()
      .post('/api/v1/rcas')
      .set(bearer(a.ADMIN))
      .send(
        rcaBody(projectId, a.RCA_LEAD.id, {
          detected_at: '2026-09-27T14:30:00+05:30',
          resolved_at: '2026-09-27T14:20:00+05:30',
        }),
      );
    expect(resolvedBeforeDetected.status).toBe(400);
    expect(resolvedBeforeDetected.body.fields.resolved_at).toBeDefined();
  });

  it('computes time to detect (not typed in)', async () => {
    const r = await createRca(a.ADMIN, projectId, a.RCA_LEAD.id, { detected_at: '2026-09-27T14:30:00+05:30' });
    expect(r.time_to_detect_minutes).toBe(25);
    const bad = await api()
      .post('/api/v1/rcas')
      .set(bearer(a.ADMIN))
      .send({ ...rcaBody(projectId, a.RCA_LEAD.id), time_to_detect_minutes: 5 });
    expect(bad.status).toBe(400);
  });

  it('rejects unknown project or inactive team leader (400)', async () => {
    const res = await api()
      .post('/api/v1/rcas')
      .set(bearer(a.ADMIN))
      .send(rcaBody(randomUUID(), randomUUID()));
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.fields).sort()).toEqual(['project_id', 'team_leader_id']);
  });
});

describe('read, update and delete RCA', () => {
  it('every role can read an RCA; 404 for unknown id', async () => {
    const r = await createRca(a.ADMIN, projectId, a.RCA_LEAD.id);
    for (const role of ROLE_KEYS) {
      expect((await api().get(`/api/v1/rcas/${r.id}`).set(bearer(a[role]))).status).toBe(200);
    }
    expect((await api().get(`/api/v1/rcas/${randomUUID()}`).set(bearer(a.ADMIN))).status).toBe(404);
  });

  it('Admin, Owner and Lead can PATCH header/common; others get 403', async () => {
    const r = await createRca(a.ADMIN, projectId, a.RCA_LEAD.id);
    for (const role of ROLE_KEYS) {
      const res = await api().patch(`/api/v1/rcas/${r.id}`).set(bearer(a[role])).send({ impact_users: `by ${role}` });
      expect(res.status).toBe(['ADMIN', 'PROJECT_OWNER', 'RCA_LEAD'].includes(role) ? 200 : 403);
    }
  });

  it('PATCH validates times against stored values and records an UPDATE audit diff', async () => {
    const r = await createRca(a.ADMIN, projectId, a.RCA_LEAD.id);
    const bad = await api().patch(`/api/v1/rcas/${r.id}`).set(bearer(a.RCA_LEAD)).send({ resolved_at: '2026-09-27T08:00:00Z' });
    expect(bad.status).toBe(400);
    const ok = await api()
      .patch(`/api/v1/rcas/${r.id}`)
      .set(bearer(a.RCA_LEAD))
      .send({ detected_at: '2026-09-27T14:15:00+05:30', resolved_at: '2026-09-27T14:45:00+05:30', sla_breached: true, detection_method: 'MONITORING' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ sla_breached: true, detection_method: 'MONITORING', time_to_detect_minutes: 10 });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { rca_id: r.id, action: 'UPDATE' } });
    expect(Object.keys(audit.new_value as object).sort()).toEqual(['detected_at', 'detection_method', 'resolved_at', 'sla_breached']);
  });

  it('soft delete: Admin only, then 404 and hidden from the list, row kept', async () => {
    const r = await createRca(a.ADMIN, projectId, a.RCA_LEAD.id);
    expect((await api().delete(`/api/v1/rcas/${r.id}`).set(bearer(a.PROJECT_OWNER))).status).toBe(403);
    expect((await api().delete(`/api/v1/rcas/${r.id}`).set(bearer(a.ADMIN))).status).toBe(204);
    expect((await api().get(`/api/v1/rcas/${r.id}`).set(bearer(a.ADMIN))).status).toBe(404);
    expect((await api().get('/api/v1/rcas').set(bearer(a.ADMIN))).body.total).toBe(0);
    expect((await prisma.rca.findUniqueOrThrow({ where: { id: r.id } })).is_deleted).toBe(true);
  });
});

describe('RCA list filters', () => {
  it('filters by status, severity, environment, project, team, dates and q; paginates and sorts', async () => {
    const other = (await createProject(a.PROJECT_OWNER.id, 'Other')).project.id;
    const r1 = await createRca(a.ADMIN, projectId, a.RCA_LEAD.id, { severity: 'P1', ticket_id: 'ZZ-77' });
    await createRca(a.ADMIN, projectId, a.RCA_LEAD.id, { severity: 'P3', environment: 'UAT', rca_date: '2026-08-01' });
    await createRca(a.ADMIN, other, a.RCA_LEAD.id, { summary: 'Login outage in mobile app' });
    await prisma.rcaTeamSection.updateMany({ where: { rca_id: r1.id, team: 'DEV' }, data: { section_status: 'SUBMITTED' } });

    const get = (q: string) => api().get(`/api/v1/rcas?${q}`).set(bearer(a.VIEWER));
    expect((await get('')).body.total).toBe(3);
    expect((await get('severity=P1')).body.data.map((r: { id: string }) => r.id)).toEqual([r1.id]);
    expect((await get('environment=UAT')).body.total).toBe(1);
    expect((await get(`project_id=${other}`)).body.total).toBe(1);
    expect((await get('status=DRAFT')).body.total).toBe(3);
    expect((await get('status=CLOSED')).body.total).toBe(0);
    expect((await get('date_from=2026-09-01')).body.total).toBe(2);
    expect((await get('date_to=2026-08-31')).body.total).toBe(1);
    expect((await get('q=mobile')).body.total).toBe(1);
    expect((await get('q=zz-7')).body.total).toBe(1);
    expect((await get('q=RCA-2026-0002')).body.total).toBe(1);
    expect((await get('team=DEV')).body.total).toBe(2);
    expect((await get('team=QA')).body.total).toBe(3);

    const paged = await get('page=2&page_size=2&sort=rca_number');
    expect(paged.body).toMatchObject({ page: 2, page_size: 2, total: 3 });
    expect(paged.body.data[0].rca_number).toBe('RCA-2026-0003');
    expect(paged.body.data[0].sections).toHaveLength(3);
    expect(paged.body.data[0].team_leader.id).toBe(a.RCA_LEAD.id);

    expect((await get('severity=P7')).status).toBe(400);
    expect((await get('sort=password')).status).toBe(400);
  });
});

describe('timeline', () => {
  it('add, edit, remove with role checks and audit', async () => {
    const r = await createRca(a.ADMIN, projectId, a.RCA_LEAD.id);
    const url = `/api/v1/rcas/${r.id}/timeline`;
    const ev = { event_time: '2026-09-27T14:05:00+05:30', event: 'Alerts fired', team_or_person: 'PROD' };

    expect((await api().post(url).set(bearer(a.VIEWER)).send(ev)).status).toBe(403);
    const devAdd = await api().post(url).set(bearer(a.DEV)).send(ev);
    expect(devAdd.status).toBe(201);
    expect(devAdd.body.sort_order).toBe(1);
    const second = await api().post(url).set(bearer(a.RCA_LEAD)).send({ ...ev, event: 'Rollback' });
    expect(second.body.sort_order).toBe(2);
    expect((await api().post(url).set(bearer(a.RCA_LEAD)).send({ event: '' })).status).toBe(400);

    expect((await api().patch(`${url}/${devAdd.body.id}`).set(bearer(a.DEV)).send({ event: 'x' })).status).toBe(403);
    const edited = await api().patch(`${url}/${devAdd.body.id}`).set(bearer(a.PROJECT_OWNER)).send({ event: 'Alerts fired (5xx)' });
    expect(edited.body.event).toBe('Alerts fired (5xx)');
    expect((await api().patch(`${url}/${randomUUID()}`).set(bearer(a.ADMIN)).send({ event: 'x' })).status).toBe(404);

    expect((await api().delete(`${url}/${second.body.id}`).set(bearer(a.RCA_LEAD))).status).toBe(204);
    const list = await api().get(url).set(bearer(a.VIEWER));
    expect(list.body.data.map((e: { event: string }) => e.event)).toEqual(['Alerts fired (5xx)']);

    const actions = (await prisma.auditLog.findMany({ where: { entity: 'rca_timeline' }, orderBy: { at: 'asc' } })).map((x) => x.action);
    expect(actions).toEqual(['CREATE', 'CREATE', 'UPDATE', 'DELETE']);
  });
});
