import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addCollaborator,
  api,
  bearer,
  COMPLETE_SECTION,
  createRca,
  createTeam,
  createUser,
  db,
  fillAndSubmitSection,
  MEMBER_KEYS,
  raw,
  resetDb,
  type Actor,
  type RoleKey,
} from './helpers.js';

let a: Record<RoleKey, Actor>;
let ws: string;
let rcaId: string;
const url = (team: string, suffix = '') => `/api/v1/rcas/${rcaId}/sections/${team}${suffix}`;

beforeEach(async () => {
  await resetDb();
  ({ a, workspaceId: ws } = await createTeam());
  rcaId = (await createRca(a.EDITOR, ws)).id;
});

describe('section permissions', () => {
  it('a DEV contributor can edit the Dev section but gets 403 on QA and Production', async () => {
    expect((await api().put(url('DEV')).set(bearer(a.DEV)).send({ version: 1, escape_analysis: 'x' })).status).toBe(200);
    for (const team of ['QA', 'PROD']) {
      const res = await api().put(url(team)).set(bearer(a.DEV)).send({ version: 1, escape_analysis: 'x' });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('FORBIDDEN');
      expect((await api().post(url(team, '/submit')).set(bearer(a.DEV)).send({})).status).toBe(403);
      expect((await api().post(url(team, '/actions')).set(bearer(a.DEV)).send({ action: 'x', owner_id: a.DEV.id, due_date: '2026-10-01' })).status).toBe(403);
    }
  });

  it.each(['DEV', 'QA', 'PROD'] as const)('only OWNER, EDITOR and the %s contributor can save the %s section', async (team) => {
    for (const role of MEMBER_KEYS) {
      const current = await api().get(url(team)).set(bearer(a[role]));
      expect(current.status).toBe(200);
      const res = await api().put(url(team)).set(bearer(a[role])).send({ version: current.body.version, prev_process: role });
      const allowed = role === 'OWNER' || role === 'EDITOR' || role === team;
      expect(res.status, `${role} on ${team}`).toBe(allowed ? 200 : 403);
    }
    expect((await api().put(url(team)).set(bearer(a.OUTSIDER)).send({ version: 1 })).status).toBe(404);
  });

  it('team assignment is per RCA: a direct QA collaborator edits only QA on that RCA', async () => {
    const guest = await createUser('Guest QA');
    await addCollaborator(rcaId, guest, 'CONTRIBUTOR', 'QA');
    expect((await api().put(url('QA')).set(bearer(guest)).send({ version: 1, extra_1: 'guest' })).status).toBe(200);
    expect((await api().put(url('DEV')).set(bearer(guest)).send({ version: 1, extra_1: 'guest' })).status).toBe(403);
    const other = await createRca(a.EDITOR, ws);
    expect((await api().get(`/api/v1/rcas/${other.id}`).set(bearer(guest))).status).toBe(404);
  });

  it('records who last edited each section', async () => {
    await api().put(url('PROD')).set(bearer(a.PROD)).send({ version: 1, extra_1: 'x' });
    const s = await api().get(url('PROD')).set(bearer(a.VIEWER));
    expect(s.body.updated_by_user).toEqual({ id: a.PROD.id, name: a.PROD.name });
  });
});

describe('optimistic locking (SPEC 3.4)', () => {
  it('requires a version; a stale version returns 409 VERSION_CONFLICT', async () => {
    const missing = await api().put(url('QA')).set(bearer(a.QA)).send({ escape_analysis: 'x' });
    expect(missing.status).toBe(400);
    expect(missing.body.fields.version).toBeDefined();
    const first = await api().put(url('QA')).set(bearer(a.QA)).send({ version: 1, escape_analysis: 'first' });
    expect(first.body).toMatchObject({ version: 2, section_status: 'IN_PROGRESS' });
    const stale = await api().put(url('QA')).set(bearer(a.EDITOR)).send({ version: 1, escape_analysis: 'stale' });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe('VERSION_CONFLICT');
    expect(stale.body.details.current_version).toBe(2);
    // The QA contributor saved v2, the editor was stale: the message names who changed it.
    expect(stale.body.details).toMatchObject({ changed_by_self: false, changed_by_name: a.QA.name });
    expect(stale.body.message).toBe(`${a.QA.name} changed this section since you opened it. Reload to get the latest version.`);
  });

  it('a stale save by the same user (another tab) is reported as such, not as "someone else"', async () => {
    expect((await api().put(url('QA')).set(bearer(a.QA)).send({ version: 1, escape_analysis: 'tab 1' })).status).toBe(200);
    const otherTab = await api().put(url('QA')).set(bearer(a.QA)).send({ version: 1, escape_analysis: 'tab 2' });
    expect(otherTab.status).toBe(409);
    expect(otherTab.body).toMatchObject({ error: 'VERSION_CONFLICT', details: { current_version: 2, changed_by_self: true, changed_by_name: null } });
    expect(otherTab.body.message).toBe('This section was saved from another tab or window since you opened it here. Reload to continue.');
    expect(otherTab.body.message).not.toMatch(/someone else/i);
  });

  it('two users saving the same section with the same version: exactly one wins', async () => {
    const [r1, r2] = await Promise.all([
      api().put(url('DEV')).set(bearer(a.DEV)).send({ version: 1, extra_1: 'dev' }),
      api().put(url('DEV')).set(bearer(a.EDITOR)).send({ version: 1, extra_1: 'lead' }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
  });

  it('users saving different team sections at the same time never lose each other’s data', async () => {
    const saves = await Promise.all(
      (['DEV', 'QA', 'PROD'] as const).map((t) =>
        api().put(url(t)).set(bearer(a[t])).send({ version: 1, escape_analysis: `${t} data`, whys: [{ why_no: 1, answer: `${t} why` }] }),
      ),
    );
    expect(saves.map((s) => s.status)).toEqual([200, 200, 200]);
    const rca = await api().get(`/api/v1/rcas/${rcaId}`).set(bearer(a.VIEWER));
    for (const team of ['DEV', 'QA', 'PROD']) {
      const s = rca.body.sections.find((x: { team: string }) => x.team === team);
      expect(s.escape_analysis).toBe(`${team} data`);
      expect(s.whys[0].answer).toBe(`${team} why`);
    }
  });
});

describe('save validation', () => {
  it('rejects bad enums, duplicate whys and why numbers outside 1..5 (400)', async () => {
    const bad = await api().put(url('DEV')).set(bearer(a.DEV)).send({ version: 1, cause_category: 'BAD_LUCK', whys: [{ why_no: 6, answer: 'x' }] });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.fields)).toEqual(expect.arrayContaining(['cause_category', 'whys.0.why_no']));
    const dup = await api().put(url('DEV')).set(bearer(a.DEV)).send({ version: 1, whys: [{ why_no: 1, answer: 'a' }, { why_no: 1, answer: 'b' }] });
    expect(dup.status).toBe(400);
  });

  it('completion status COMPLETED requires actual date and Verified by', async () => {
    const res = await api().put(url('DEV')).set(bearer(a.DEV)).send({ version: 1, completion_status: 'COMPLETED' });
    expect(Object.keys(res.body.fields).sort()).toEqual(['actual_date', 'verified_by_name']);
    const ok = await api()
      .put(url('DEV'))
      .set(bearer(a.DEV))
      .send({ version: 1, completion_status: 'COMPLETED', actual_date: '2026-10-01', verified_by_name: 'Priya' });
    expect(ok.status).toBe(200);
  });
});

describe('submit and lock', () => {
  it('422 lists every missing item; Why 1 + Why 5 are enough', async () => {
    const empty = await api().post(url('QA', '/submit')).set(bearer(a.QA)).send({});
    expect(empty.status).toBe(422);
    expect(Object.keys(empty.body.fields).sort()).toEqual(['actions', 'cause_category', 'escape_analysis', 'whys.1', 'whys.5']);
    await api().put(url('QA')).set(bearer(a.QA)).send({ version: 1, ...COMPLETE_SECTION });
    await api().post(url('QA', '/actions')).set(bearer(a.QA)).send({ action: 'Add TC-882', owner_id: a.QA.id, due_date: '2026-10-10' });
    const ok = await api().post(url('QA', '/submit')).set(bearer(a.QA)).send({});
    expect(ok.body.section_status).toBe('SUBMITTED');
  });

  it('a submitted section is locked (409) and only OWNER/EDITOR can unlock it', async () => {
    const { section } = await fillAndSubmitSection(a.DEV, rcaId, 'DEV');
    expect((await api().put(url('DEV')).set(bearer(a.DEV)).send({ version: section.version, extra_1: 'late' })).status).toBe(409);
    expect((await api().post(url('DEV', '/submit')).set(bearer(a.DEV)).send({})).status).toBe(409);
    for (const role of ['DEV', 'QA', 'PROD', 'VIEWER'] as RoleKey[]) {
      expect((await api().post(url('DEV', '/reopen')).set(bearer(a[role])).send({})).status).toBe(403);
    }
    const reopened = await api().post(url('DEV', '/reopen')).set(bearer(a.EDITOR)).send({});
    expect(reopened.body.section_status).toBe('IN_PROGRESS');
    expect((await api().post(url('DEV', '/reopen')).set(bearer(a.OWNER)).send({})).status).toBe(409);
    const audit = await raw(() => db.auditLog.findMany({ where: { rca_id: rcaId, entity: 'rca_team_section' }, orderBy: { at: 'asc' } }));
    expect(audit.map((x) => x.action)).toEqual(['UPDATE', 'SUBMIT', 'REOPEN']);
  });

  it('a solo owner can fill and submit all three sections alone', async () => {
    const solo = await createUser('Solo');
    const r = await createRca(solo, solo.personalWorkspaceId);
    for (const team of ['DEV', 'QA', 'PROD'] as const) {
      const { section } = await fillAndSubmitSection(solo, r.id, team);
      expect(section.section_status).toBe('SUBMITTED');
    }
  });
});

describe('actions', () => {
  it('require action, an owner with access to the RCA, and a due date not before the RCA date', async () => {
    const missing = await api().post(url('PROD', '/actions')).set(bearer(a.PROD)).send({});
    expect(Object.keys(missing.body.fields).sort()).toEqual(['action', 'due_date', 'owner_id']);
    const early = await api().post(url('PROD', '/actions')).set(bearer(a.PROD)).send({ action: 'Add alert', owner_id: a.PROD.id, due_date: '2026-09-01' });
    expect(early.body.fields.due_date).toBe('Due date cannot be before the RCA date');
    const stranger = await api().post(url('PROD', '/actions')).set(bearer(a.PROD)).send({ action: 'Add alert', owner_id: a.OUTSIDER.id, due_date: '2026-10-01' });
    expect(stranger.status).toBe(400);
    expect(stranger.body.fields.owner_id).toBeDefined();
    expect((await api().post(url('PROD', '/actions')).set(bearer(a.PROD)).send({ action: 'Add alert', owner_id: randomUUID(), due_date: '2026-10-01' })).status).toBe(400);
    const ok = await api().post(url('PROD', '/actions')).set(bearer(a.PROD)).send({ action: 'Add alert', owner_id: a.DEV.id, due_date: '2026-10-01' });
    expect(ok.body).toMatchObject({ seq: 1, status: 'NOT_STARTED', due_date: '2026-10-01' });
  });

  it('after submit only status/completed date can change; add/delete are 409', async () => {
    const { action } = await fillAndSubmitSection(a.DEV, rcaId, 'DEV', { actionStatus: 'IN_PROGRESS' });
    const base = url('DEV', `/actions/${action.id}`);
    expect((await api().patch(base).set(bearer(a.DEV)).send({ action: 'rename' })).status).toBe(409);
    expect((await api().delete(base).set(bearer(a.DEV))).status).toBe(409);
    expect((await api().patch(base).set(bearer(a.DEV)).send({ status: 'COMPLETED', completed_on: '2026-10-01' })).body.status).toBe('COMPLETED');
    expect((await api().patch(base).set(bearer(a.QA)).send({ status: 'NOT_STARTED' })).status).toBe(403);
  });

  it('update/delete with audit; an action id is only found under its own section', async () => {
    const created = await api().post(url('QA', '/actions')).set(bearer(a.QA)).send({ action: 'Add TC', owner_id: a.QA.id, due_date: '2026-10-01' });
    const base = url('QA', `/actions/${created.body.id}`);
    expect((await api().patch(base).set(bearer(a.QA)).send({ due_date: '2026-10-05' })).body.due_date).toBe('2026-10-05');
    expect((await api().patch(url('DEV', `/actions/${created.body.id}`)).set(bearer(a.EDITOR)).send({ status: 'COMPLETED' })).status).toBe(404);
    expect((await api().delete(base).set(bearer(a.QA))).status).toBe(204);
    const audit = await raw(() => db.auditLog.findMany({ where: { entity_id: created.body.id }, orderBy: { at: 'asc' } }));
    expect(audit.map((x) => x.action)).toEqual(['CREATE', 'UPDATE', 'DELETE']);
  });

  it('flags overdue actions in the section and the list', async () => {
    const created = await api().post(url('QA', '/actions')).set(bearer(a.QA)).send({ action: 'Add TC', owner_id: a.QA.id, due_date: '2026-10-01' });
    await raw(() => db.rcaAction.update({ where: { id: created.body.id }, data: { due_date: new Date('2020-01-01T00:00:00Z') } }));
    expect((await api().get(url('QA')).set(bearer(a.QA))).body.actions[0].is_overdue).toBe(true);
    const list = await api().get('/api/v1/rcas?overdue=true').set(bearer(a.QA));
    expect(list.body.total).toBe(1);
  });
});
