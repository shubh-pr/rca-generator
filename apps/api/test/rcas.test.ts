import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { formatRcaNumber } from '../src/services/rcaNumber.js';
import { api, bearer, createRca, createTeam, createUser, db, MEMBER_KEYS, raw, rcaBody, resetDb, type Actor, type RoleKey } from './helpers.js';

let a: Record<RoleKey, Actor>;
let ws: string;

beforeEach(async () => {
  await resetDb();
  ({ a, workspaceId: ws } = await createTeam());
});

describe('RCA number generation', () => {
  it('formats RCA-YYYY-NNNN', () => {
    expect(formatRcaNumber(2026, 7)).toBe('RCA-2026-0007');
    expect(formatRcaNumber(2026, 12345)).toBe('RCA-2026-12345');
  });

  it('numbers sequentially per workspace and year; each workspace has its own sequence', async () => {
    const r1 = await createRca(a.EDITOR, ws);
    const r2 = await createRca(a.EDITOR, ws);
    const r3 = await createRca(a.EDITOR, ws, { rca_date: '2027-01-02', incident_start: '2027-01-01T10:00:00Z' });
    const solo = await createRca(a.OUTSIDER, a.OUTSIDER.personalWorkspaceId);
    expect([r1.rca_number, r2.rca_number, r3.rca_number]).toEqual(['RCA-2026-0001', 'RCA-2026-0002', 'RCA-2027-0001']);
    expect(solo.rca_number).toBe('RCA-2026-0001');
  });

  it('never duplicates numbers under concurrent creates', async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => api().post('/api/v1/rcas').set(bearer(a.OWNER)).send(rcaBody(ws))));
    expect(results.every((r) => r.status === 201)).toBe(true);
    const numbers = results.map((r) => r.body.rca_number).sort();
    expect(new Set(numbers).size).toBe(12);
    expect(numbers[11]).toBe('RCA-2026-0012');
  });

  it('rca_number cannot be set or changed by the client (400)', async () => {
    expect((await api().post('/api/v1/rcas').set(bearer(a.OWNER)).send({ ...rcaBody(ws), rca_number: 'RCA-1999-0001' })).status).toBe(400);
    const r = await createRca(a.OWNER, ws);
    expect((await api().patch(`/api/v1/rcas/${r.id}`).set(bearer(a.OWNER)).send({ rca_number: 'X' })).status).toBe(400);
  });
});

describe('create RCA', () => {
  it('returns 201 with number, DRAFT, version 1, 3 sections with 5 whys, 5 sign-offs, and permissions', async () => {
    const res = await api().post('/api/v1/rcas').set(bearer(a.EDITOR)).send(rcaBody(ws));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ rca_number: 'RCA-2026-0001', status: 'DRAFT', version: 1, rca_date: '2026-09-28', workspace_id: ws });
    expect(res.body.sections.map((s: { team: string }) => s.team)).toEqual(['DEV', 'QA', 'PROD']);
    expect(res.body.sections.every((s: { whys: unknown[] }) => s.whys.length === 5)).toBe(true);
    expect(res.body.signoffs).toHaveLength(5);
    // Name fields default to the creator; no master data needed.
    expect(res.body).toMatchObject({ project_owner_name: a.EDITOR.name, team_leader_name: a.EDITOR.name, prepared_by_name: a.EDITOR.name });
    expect(res.body.permissions).toMatchObject({ role: 'EDITOR', edit: true, delete: false });
    const audit = await raw(() => db.auditLog.findMany({ where: { rca_id: res.body.id } }));
    expect(audit.map((x) => [x.action, x.workspace_id])).toEqual([['CREATE', ws]]);
  });

  it('a solo user creates RCAs in their personal workspace by default', async () => {
    const solo = await createUser('Solo');
    const { workspace_id: _w, ...body } = rcaBody(solo.personalWorkspaceId);
    const res = await api().post('/api/v1/rcas').set(bearer(solo)).send(body);
    expect(res.status).toBe(201);
    expect(res.body.workspace_id).toBe(solo.personalWorkspaceId);
    expect(res.body.permissions.role).toBe('OWNER');
  });

  it.each(['DEV', 'QA', 'PROD', 'VIEWER'] as RoleKey[])('%s cannot create an RCA in the workspace (403)', async (role) => {
    expect((await api().post('/api/v1/rcas').set(bearer(a[role])).send(rcaBody(ws))).status).toBe(403);
  });

  it('a workspace the user does not belong to is rejected without revealing it (400)', async () => {
    const res = await api().post('/api/v1/rcas').set(bearer(a.OUTSIDER)).send(rcaBody(ws));
    expect(res.status).toBe(400);
    expect(res.body.fields.workspace_id).toBe('Workspace not found');
  });

  it('requires a verified email (403 EMAIL_NOT_VERIFIED)', async () => {
    const u = await createUser('Unverified', { verified: false });
    const res = await api().post('/api/v1/rcas').set(bearer(u)).send(rcaBody(u.personalWorkspaceId));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('EMAIL_NOT_VERIFIED');
  });

  it('validates required fields and enum values (400)', async () => {
    const res = await api().post('/api/v1/rcas').set(bearer(a.OWNER)).send({ workspace_id: ws, severity: 'P9', environment: 'DEV', detection_method: 'PSYCHIC' });
    expect(res.status).toBe(400);
    for (const f of ['rca_date', 'severity', 'environment', 'incident_start', 'summary', 'detection_method']) expect(res.body.fields).toHaveProperty(f);
  });

  it('enforces incident_start <= detected_at <= resolved_at and computes time to detect', async () => {
    const early = await api().post('/api/v1/rcas').set(bearer(a.OWNER)).send(rcaBody(ws, { detected_at: '2026-09-27T13:00:00+05:30' }));
    expect(early.status).toBe(400);
    expect(early.body.fields).toEqual({ detected_at: 'Must be after incident_start' });
    const bad = await api()
      .post('/api/v1/rcas')
      .set(bearer(a.OWNER))
      .send(rcaBody(ws, { detected_at: '2026-09-27T14:30:00+05:30', resolved_at: '2026-09-27T14:20:00+05:30' }));
    expect(bad.body.fields.resolved_at).toBeDefined();
    const ok = await createRca(a.OWNER, ws, { detected_at: '2026-09-27T14:30:00+05:30' });
    expect(ok.time_to_detect_minutes).toBe(25);
  });
});

describe('read, update and delete RCA', () => {
  it('every member can read; outsiders get 404 (not 403); unknown ids 404', async () => {
    const r = await createRca(a.OWNER, ws);
    for (const role of MEMBER_KEYS) expect((await api().get(`/api/v1/rcas/${r.id}`).set(bearer(a[role]))).status).toBe(200);
    expect((await api().get(`/api/v1/rcas/${r.id}`).set(bearer(a.OUTSIDER))).status).toBe(404);
    expect((await api().get(`/api/v1/rcas/${randomUUID()}`).set(bearer(a.OWNER))).status).toBe(404);
    expect((await api().get('/api/v1/rcas/not-a-uuid').set(bearer(a.OWNER))).status).toBe(400);
  });

  it('OWNER and EDITOR can PATCH header/common; contributors and viewers 403; outsiders 404', async () => {
    const r = await createRca(a.OWNER, ws);
    const expected: Record<RoleKey, number> = { OWNER: 200, EDITOR: 200, DEV: 403, QA: 403, PROD: 403, VIEWER: 403, OUTSIDER: 404 };
    for (const [role, status] of Object.entries(expected)) {
      const res = await api().patch(`/api/v1/rcas/${r.id}`).set(bearer(a[role as RoleKey])).send({ impact_users: `by ${role}` });
      expect(res.status, role).toBe(status);
    }
  });

  it('PATCH validates times and records an UPDATE audit diff', async () => {
    const r = await createRca(a.OWNER, ws);
    expect((await api().patch(`/api/v1/rcas/${r.id}`).set(bearer(a.EDITOR)).send({ resolved_at: '2026-09-27T08:00:00Z' })).status).toBe(400);
    const ok = await api()
      .patch(`/api/v1/rcas/${r.id}`)
      .set(bearer(a.EDITOR))
      .send({ detected_at: '2026-09-27T14:15:00+05:30', resolved_at: '2026-09-27T14:45:00+05:30', sla_breached: true, project_owner_name: 'Jogender Kota' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ sla_breached: true, time_to_detect_minutes: 10, project_owner_name: 'Jogender Kota' });
    const audit = await raw(() => db.auditLog.findFirstOrThrow({ where: { rca_id: r.id, action: 'UPDATE' } }));
    expect(Object.keys(audit.new_value as object).sort()).toEqual(['detected_at', 'project_owner_name', 'resolved_at', 'sla_breached']);
  });

  it('soft delete: OWNER only, then 404 and hidden from the list, row kept', async () => {
    const r = await createRca(a.OWNER, ws);
    expect((await api().delete(`/api/v1/rcas/${r.id}`).set(bearer(a.EDITOR))).status).toBe(403);
    expect((await api().delete(`/api/v1/rcas/${r.id}`).set(bearer(a.OWNER))).status).toBe(204);
    expect((await api().get(`/api/v1/rcas/${r.id}`).set(bearer(a.OWNER))).status).toBe(404);
    expect((await api().get('/api/v1/rcas').set(bearer(a.OWNER))).body.total).toBe(0);
    expect((await raw(() => db.rca.findUniqueOrThrow({ where: { id: r.id } }))).is_deleted).toBe(true);
  });

  it('participants: members of the workspace and direct collaborators', async () => {
    const r = await createRca(a.OWNER, ws);
    const res = await api().get(`/api/v1/rcas/${r.id}/participants`).set(bearer(a.DEV));
    expect(res.body.data.map((p: { id: string }) => p.id).sort()).toEqual(MEMBER_KEYS.map((k) => a[k].id).sort());
    expect(res.body.data.find((p: { id: string }) => p.id === a.DEV.id)).toMatchObject({ role: 'CONTRIBUTOR', team: 'DEV' });
  });
});

describe('RCA list filters', () => {
  it('filters by status, severity, environment, workspace, project, team, dates and q; paginates and sorts', async () => {
    const r1 = await createRca(a.OWNER, ws, { severity: 'P1', ticket_id: 'ZZ-77' });
    await createRca(a.OWNER, ws, { severity: 'P3', environment: 'UAT', rca_date: '2026-08-01' });
    await createRca(a.OWNER, ws, { summary: 'Login outage in mobile app', project_name: 'Mobile' });
    await createRca(a.OUTSIDER, a.OUTSIDER.personalWorkspaceId); // never visible to the team
    await raw(() => db.rcaTeamSection.updateMany({ where: { rca_id: r1.id, team: 'DEV' }, data: { section_status: 'SUBMITTED' } }));

    const get = (q: string) => api().get(`/api/v1/rcas?${q}`).set(bearer(a.VIEWER));
    expect((await get('')).body.total).toBe(3);
    expect((await get('severity=P1')).body.data.map((r: { id: string }) => r.id)).toEqual([r1.id]);
    expect((await get('environment=UAT')).body.total).toBe(1);
    expect((await get('project=mobile')).body.total).toBe(1);
    expect((await get(`workspace_id=${ws}`)).body.total).toBe(3);
    expect((await get(`workspace_id=${a.OUTSIDER.personalWorkspaceId}`)).body.total).toBe(0);
    expect((await get('status=DRAFT')).body.total).toBe(3);
    expect((await get('date_from=2026-09-01')).body.total).toBe(2);
    expect((await get('date_to=2026-08-31')).body.total).toBe(1);
    expect((await get('q=mobile')).body.total).toBe(1);
    expect((await get('q=zz-7')).body.total).toBe(1);
    expect((await get('team=DEV')).body.total).toBe(2);
    const paged = await get('page=2&page_size=2&sort=rca_number');
    expect(paged.body).toMatchObject({ page: 2, page_size: 2, total: 3 });
    expect(paged.body.data[0].rca_number).toBe('RCA-2026-0003');
    expect((await get('severity=P7')).status).toBe(400);
    expect((await get('sort=password')).status).toBe(400);
  });
});

describe('timeline', () => {
  it('add (contributors too), edit/remove (owner/editor), audit', async () => {
    const r = await createRca(a.OWNER, ws);
    const url = `/api/v1/rcas/${r.id}/timeline`;
    const ev = { event_time: '2026-09-27T14:05:00+05:30', event: 'Alerts fired', team_or_person: 'PROD' };
    expect((await api().post(url).set(bearer(a.VIEWER)).send(ev)).status).toBe(403);
    expect((await api().post(url).set(bearer(a.OUTSIDER)).send(ev)).status).toBe(404);
    const devAdd = await api().post(url).set(bearer(a.DEV)).send(ev);
    expect(devAdd.status).toBe(201);
    const second = await api().post(url).set(bearer(a.EDITOR)).send({ ...ev, event: 'Rollback' });
    expect(second.body.sort_order).toBe(2);
    expect((await api().patch(`${url}/${devAdd.body.id}`).set(bearer(a.DEV)).send({ event: 'x' })).status).toBe(403);
    expect((await api().patch(`${url}/${devAdd.body.id}`).set(bearer(a.OWNER)).send({ event: 'Alerts fired (5xx)' })).body.event).toBe('Alerts fired (5xx)');
    expect((await api().patch(`${url}/${randomUUID()}`).set(bearer(a.OWNER)).send({ event: 'x' })).status).toBe(404);
    expect((await api().delete(`${url}/${second.body.id}`).set(bearer(a.EDITOR))).status).toBe(204);
    expect((await api().get(url).set(bearer(a.VIEWER))).body.data.map((e: { event: string }) => e.event)).toEqual(['Alerts fired (5xx)']);
  });
});

describe('onboarding sample RCA', () => {
  it('creates a labelled, complete, closed example in the personal workspace that the user can delete', async () => {
    const u = await createUser('Newbie');
    const res = await api().post('/api/v1/rcas/sample').set(bearer(u)).send({});
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ is_sample: true, status: 'CLOSED', workspace_id: u.personalWorkspaceId, rca_number: 'RCA-2026-0001' });
    expect(res.body.sections.every((s: { section_status: string }) => s.section_status === 'SUBMITTED')).toBe(true);
    expect(res.body.signoffs.every((s: { user_id: string }) => s.user_id === u.id)).toBe(true);
    const list = await api().get('/api/v1/rcas').set(bearer(u));
    expect(list.body.data[0].is_sample).toBe(true);
    expect((await api().delete(`/api/v1/rcas/${res.body.id}`).set(bearer(u))).status).toBe(204);
    // Other users never see it.
    expect((await api().get(`/api/v1/rcas/${res.body.id}`).set(bearer(a.OUTSIDER))).status).toBe(404);
  });

  it('needs a verified email; marking onboarding done is recorded', async () => {
    const u = await createUser('Unverified', { verified: false });
    expect((await api().post('/api/v1/rcas/sample').set(bearer(u)).send({})).body.error).toBe('EMAIL_NOT_VERIFIED');
    expect((await api().get('/api/v1/me').set(bearer(u))).body.onboarded).toBe(false);
    expect((await api().post('/api/v1/me/onboarded').set(bearer(u)).send({})).body.onboarded).toBe(true);
  });
});
