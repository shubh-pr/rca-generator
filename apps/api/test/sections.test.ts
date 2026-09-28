import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  api,
  bearer,
  COMPLETE_SECTION,
  createActors,
  createProject,
  createRca,
  fillAndSubmitSection,
  prisma,
  resetDb,
  ROLE_KEYS,
  type Actor,
  type RoleKey,
} from './helpers.js';

let a: Record<RoleKey, Actor>;
let rcaId: string;
const url = (team: string, suffix = '') => `/api/v1/rcas/${rcaId}/sections/${team}${suffix}`;

beforeEach(async () => {
  await resetDb();
  a = await createActors();
  const { project } = await createProject(a.PROJECT_OWNER.id);
  rcaId = (await createRca(a.RCA_LEAD, project.id, a.RCA_LEAD.id)).id;
});

describe('section permissions (acceptance: Dev edits Dev, 403 on QA/Production)', () => {
  it('Dev user can edit the Dev section but gets 403 on QA and Production', async () => {
    const dev = await api().put(url('DEV')).set(bearer(a.DEV)).send({ version: 1, escape_analysis: 'x' });
    expect(dev.status).toBe(200);
    for (const team of ['QA', 'PROD']) {
      const res = await api().put(url(team)).set(bearer(a.DEV)).send({ version: 1, escape_analysis: 'x' });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('FORBIDDEN');
      expect((await api().post(url(team, '/submit')).set(bearer(a.DEV)).send({})).status).toBe(403);
      expect(
        (await api().post(url(team, '/actions')).set(bearer(a.DEV)).send({ action: 'x', owner_id: a.DEV.id, due_date: '2026-10-01' })).status,
      ).toBe(403);
    }
  });

  it.each(['DEV', 'QA', 'PROD'] as const)('only Admin, Lead and the %s team can save the %s section', async (team) => {
    for (const role of ROLE_KEYS) {
      const current = await api().get(url(team)).set(bearer(a[role]));
      expect(current.status).toBe(200);
      const res = await api().put(url(team)).set(bearer(a[role])).send({ version: current.body.version, prev_process: role });
      const allowed = role === 'ADMIN' || role === 'RCA_LEAD' || role === team;
      expect(res.status, `${role} on ${team}`).toBe(allowed ? 200 : 403);
    }
  });

  it('Project Owner and Viewer cannot edit any section', async () => {
    for (const team of ['DEV', 'QA', 'PROD']) {
      expect((await api().put(url(team)).set(bearer(a.PROJECT_OWNER)).send({ version: 1 })).status).toBe(403);
      expect((await api().put(url(team)).set(bearer(a.VIEWER)).send({ version: 1 })).status).toBe(403);
    }
  });
});

describe('optimistic locking (SPEC 3.4)', () => {
  it('requires a version; a stale version returns 409 VERSION_CONFLICT', async () => {
    const missing = await api().put(url('QA')).set(bearer(a.QA)).send({ escape_analysis: 'x' });
    expect(missing.status).toBe(400);
    expect(missing.body.fields.version).toBeDefined();

    const first = await api().put(url('QA')).set(bearer(a.QA)).send({ version: 1, escape_analysis: 'first' });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ version: 2, section_status: 'IN_PROGRESS' });

    const stale = await api().put(url('QA')).set(bearer(a.RCA_LEAD)).send({ version: 1, escape_analysis: 'stale' });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe('VERSION_CONFLICT');
    expect(stale.body.details.current_version).toBe(2);
    expect((await api().get(url('QA')).set(bearer(a.QA))).body.escape_analysis).toBe('first');
  });

  it('two users saving the same section with the same version: exactly one wins', async () => {
    const [r1, r2] = await Promise.all([
      api().put(url('DEV')).set(bearer(a.DEV)).send({ version: 1, extra_1: 'dev' }),
      api().put(url('DEV')).set(bearer(a.RCA_LEAD)).send({ version: 1, extra_1: 'lead' }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    expect((await api().get(url('DEV')).set(bearer(a.DEV))).body.version).toBe(2);
  });

  it('acceptance: users saving different team sections at the same time never lose each other’s data', async () => {
    const saves = await Promise.all([
      api().put(url('DEV')).set(bearer(a.DEV)).send({ version: 1, escape_analysis: 'dev data', whys: [{ why_no: 1, answer: 'dev why' }] }),
      api().put(url('QA')).set(bearer(a.QA)).send({ version: 1, escape_analysis: 'qa data', whys: [{ why_no: 1, answer: 'qa why' }] }),
      api().put(url('PROD')).set(bearer(a.PROD)).send({ version: 1, escape_analysis: 'prod data', whys: [{ why_no: 1, answer: 'prod why' }] }),
    ]);
    expect(saves.map((s) => s.status)).toEqual([200, 200, 200]);
    const rca = await api().get(`/api/v1/rcas/${rcaId}`).set(bearer(a.VIEWER));
    for (const team of ['DEV', 'QA', 'PROD']) {
      const s = rca.body.sections.find((x: { team: string }) => x.team === team);
      const key = team.toLowerCase();
      expect(s.escape_analysis).toBe(`${key} data`);
      expect(s.whys[0].answer).toBe(`${key} why`);
    }
  });
});

describe('save validation', () => {
  it('rejects bad enums, duplicate whys and why numbers outside 1..5 (400)', async () => {
    const bad = await api()
      .put(url('DEV'))
      .set(bearer(a.DEV))
      .send({ version: 1, cause_category: 'BAD_LUCK', whys: [{ why_no: 6, answer: 'x' }] });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.fields)).toEqual(expect.arrayContaining(['cause_category', 'whys.0.why_no']));
    const dup = await api()
      .put(url('DEV'))
      .set(bearer(a.DEV))
      .send({ version: 1, whys: [{ why_no: 1, answer: 'a' }, { why_no: 1, answer: 'b' }] });
    expect(dup.status).toBe(400);
  });

  it('completion status COMPLETED requires actual date and Verified by', async () => {
    const res = await api().put(url('DEV')).set(bearer(a.DEV)).send({ version: 1, completion_status: 'COMPLETED' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.fields).sort()).toEqual(['actual_date', 'verified_by']);
    const ok = await api()
      .put(url('DEV'))
      .set(bearer(a.DEV))
      .send({ version: 1, completion_status: 'COMPLETED', actual_date: '2026-10-01', verified_by: a.RCA_LEAD.id });
    expect(ok.status).toBe(200);
    expect(ok.body.actual_date).toBe('2026-10-01');
  });
});

describe('submit and lock', () => {
  it('422 lists every missing item; Why 1 + Why 5 are enough', async () => {
    const empty = await api().post(url('QA', '/submit')).set(bearer(a.QA)).send({});
    expect(empty.status).toBe(422);
    expect(empty.body.error).toBe('BUSINESS_RULE');
    expect(Object.keys(empty.body.fields).sort()).toEqual(['actions', 'cause_category', 'escape_analysis', 'whys.1', 'whys.5']);

    await api().put(url('QA')).set(bearer(a.QA)).send({ version: 1, ...COMPLETE_SECTION });
    const noAction = await api().post(url('QA', '/submit')).set(bearer(a.QA)).send({});
    expect(noAction.status).toBe(422);
    expect(Object.keys(noAction.body.fields)).toEqual(['actions']);

    await api().post(url('QA', '/actions')).set(bearer(a.QA)).send({ action: 'Add TC-882', owner_id: a.QA.id, due_date: '2026-10-10' });
    const ok = await api().post(url('QA', '/submit')).set(bearer(a.QA)).send({});
    expect(ok.status).toBe(200);
    expect(ok.body.section_status).toBe('SUBMITTED');
    expect(ok.body.submitted_at).toBeTruthy();
  });

  it('a submitted section is locked (409), cannot be submitted twice, and only Lead/Admin can unlock', async () => {
    const { section } = await fillAndSubmitSection(a.DEV, rcaId, 'DEV');
    const locked = await api().put(url('DEV')).set(bearer(a.DEV)).send({ version: section.version, extra_1: 'late edit' });
    expect(locked.status).toBe(409);
    expect((await api().post(url('DEV', '/submit')).set(bearer(a.DEV)).send({})).status).toBe(409);

    for (const role of ['DEV', 'QA', 'PROD', 'PROJECT_OWNER', 'VIEWER'] as RoleKey[]) {
      expect((await api().post(url('DEV', '/reopen')).set(bearer(a[role])).send({})).status).toBe(403);
    }
    const reopened = await api().post(url('DEV', '/reopen')).set(bearer(a.RCA_LEAD)).send({});
    expect(reopened.status).toBe(200);
    expect(reopened.body.section_status).toBe('IN_PROGRESS');
    expect((await api().post(url('DEV', '/reopen')).set(bearer(a.ADMIN)).send({})).status).toBe(409);
    const edit = await api().put(url('DEV')).set(bearer(a.DEV)).send({ version: reopened.body.version, extra_1: 'fixed' });
    expect(edit.status).toBe(200);

    const audit = await prisma.auditLog.findMany({ where: { rca_id: rcaId, entity: 'rca_team_section' }, orderBy: { at: 'asc' } });
    expect(audit.map((x) => x.action)).toEqual(['UPDATE', 'SUBMIT', 'REOPEN', 'UPDATE']);
  });
});

describe('actions', () => {
  it('require action, owner and a due date not before the RCA date', async () => {
    const missing = await api().post(url('PROD', '/actions')).set(bearer(a.PROD)).send({});
    expect(missing.status).toBe(400);
    expect(Object.keys(missing.body.fields).sort()).toEqual(['action', 'due_date', 'owner_id']);
    const early = await api()
      .post(url('PROD', '/actions'))
      .set(bearer(a.PROD))
      .send({ action: 'Add alert', owner_id: a.PROD.id, due_date: '2026-09-01' });
    expect(early.status).toBe(400);
    expect(early.body.fields.due_date).toBe('Due date cannot be before the RCA date');
    const badOwner = await api()
      .post(url('PROD', '/actions'))
      .set(bearer(a.PROD))
      .send({ action: 'Add alert', owner_id: randomUUID(), due_date: '2026-10-01' });
    expect(badOwner.status).toBe(400);
    const ok = await api()
      .post(url('PROD', '/actions'))
      .set(bearer(a.PROD))
      .send({ action: 'Add alert', owner_id: a.PROD.id, due_date: '2026-10-01' });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ seq: 1, status: 'NOT_STARTED', due_date: '2026-10-01' });
    const second = await api()
      .post(url('PROD', '/actions'))
      .set(bearer(a.PROD))
      .send({ action: 'Rollback runbook', owner_id: a.DEV.id, due_date: '2026-10-02', status: 'IN_PROGRESS' });
    expect(second.body.seq).toBe(2);
  });

  it('after submit only status/completed date can change; add/delete are 409', async () => {
    const { action } = await fillAndSubmitSection(a.DEV, rcaId, 'DEV', { actionStatus: 'IN_PROGRESS' });
    const base = url('DEV', `/actions/${action.id}`);
    expect((await api().patch(base).set(bearer(a.DEV)).send({ action: 'rename' })).status).toBe(409);
    expect((await api().delete(base).set(bearer(a.DEV))).status).toBe(409);
    expect(
      (await api().post(url('DEV', '/actions')).set(bearer(a.DEV)).send({ action: 'x', owner_id: a.DEV.id, due_date: '2026-10-01' })).status,
    ).toBe(409);
    const done = await api().patch(base).set(bearer(a.DEV)).send({ status: 'COMPLETED', completed_on: '2026-10-01' });
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('COMPLETED');
    expect((await api().patch(base).set(bearer(a.QA)).send({ status: 'NOT_STARTED' })).status).toBe(403);
  });

  it('update and delete while editable, with audit rows; 404 for unknown action', async () => {
    const created = await api()
      .post(url('QA', '/actions'))
      .set(bearer(a.QA))
      .send({ action: 'Add TC', owner_id: a.QA.id, due_date: '2026-10-01' });
    const base = url('QA', `/actions/${created.body.id}`);
    const upd = await api().patch(base).set(bearer(a.QA)).send({ due_date: '2026-10-05', owner_id: a.RCA_LEAD.id });
    expect(upd.body).toMatchObject({ due_date: '2026-10-05', owner_id: a.RCA_LEAD.id });
    expect((await api().patch(url('QA', `/actions/${randomUUID()}`)).set(bearer(a.QA)).send({ status: 'COMPLETED' })).status).toBe(404);
    // An action id from another team's section is not found under this team.
    expect((await api().patch(url('DEV', `/actions/${created.body.id}`)).set(bearer(a.DEV)).send({ status: 'COMPLETED' })).status).toBe(404);
    expect((await api().delete(base).set(bearer(a.QA))).status).toBe(204);
    const audit = await prisma.auditLog.findMany({ where: { entity_id: created.body.id }, orderBy: { at: 'asc' } });
    expect(audit.map((x) => x.action)).toEqual(['CREATE', 'UPDATE', 'DELETE']);
  });

  it('flags overdue actions in the section and the RCA', async () => {
    const created = await api()
      .post(url('QA', '/actions'))
      .set(bearer(a.QA))
      .send({ action: 'Add TC', owner_id: a.QA.id, due_date: '2026-10-01' });
    await prisma.rcaAction.update({ where: { id: created.body.id }, data: { due_date: new Date('2020-01-01T00:00:00Z') } });
    const s = await api().get(url('QA')).set(bearer(a.QA));
    expect(s.body.actions[0].is_overdue).toBe(true);
    const list = await api().get('/api/v1/rcas?overdue=true').set(bearer(a.QA));
    expect(list.body.total).toBe(1);
    expect(list.body.data[0].has_overdue).toBe(true);
  });
});
