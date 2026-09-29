import { beforeEach, describe, expect, it } from 'vitest';
import {
  api,
  bearer,
  COMMON_COMPLETE,
  createRca,
  createTeam,
  createUser,
  db,
  fillAndSubmitSection,
  MEMBER_KEYS,
  prepareForReview,
  raw,
  resetDb,
  signAll,
  type Actor,
  type RoleKey,
} from './helpers.js';

let a: Record<RoleKey, Actor>;
let ws: string;
let rcaId: string;
const u = (s = '') => `/api/v1/rcas/${rcaId}${s}`;

beforeEach(async () => {
  await resetDb();
  ({ a, workspaceId: ws } = await createTeam());
  rcaId = (await createRca(a.EDITOR, ws)).id;
});

describe('DRAFT -> IN_REVIEW', () => {
  it('cannot move to IN_REVIEW until all three sections are submitted', async () => {
    await api().patch(u()).set(bearer(a.EDITOR)).send(COMMON_COMPLETE);
    await fillAndSubmitSection(a.DEV, rcaId, 'DEV');
    await fillAndSubmitSection(a.QA, rcaId, 'QA');
    const res = await api().post(u('/submit-review')).set(bearer(a.EDITOR)).send({});
    expect(res.status).toBe(422);
    expect(res.body.details.problems).toContain('PROD section is not submitted');
    await fillAndSubmitSection(a.PROD, rcaId, 'PROD');
    const ok = await api().post(u('/submit-review')).set(bearer(a.EDITOR)).send({});
    expect(ok.body.status).toBe('IN_REVIEW');
  });

  it('requires header and common sections to be complete', async () => {
    for (const team of ['DEV', 'QA', 'PROD'] as const) await fillAndSubmitSection(a[team], rcaId, team);
    const res = await api().post(u('/submit-review')).set(bearer(a.EDITOR)).send({});
    expect(Object.keys(res.body.fields).sort()).toEqual(['detected_at', 'detection_method', 'immediate_fix', 'impact_users', 'resolved_at']);
  });

  it('only OWNER and EDITOR may submit for review; twice is 409', async () => {
    await prepareForReview(a, rcaId);
    for (const r of ['DEV', 'QA', 'PROD', 'VIEWER'] as RoleKey[]) expect((await api().post(u('/submit-review')).set(bearer(a[r])).send({})).status).toBe(403);
    expect((await api().post(u('/submit-review')).set(bearer(a.OUTSIDER)).send({})).status).toBe(404);
    expect((await api().post(u('/submit-review')).set(bearer(a.OWNER)).send({})).status).toBe(200);
    expect((await api().post(u('/submit-review')).set(bearer(a.OWNER)).send({})).status).toBe(409);
  });
});

describe('sign-off (labels the owner assigns)', () => {
  beforeEach(async () => {
    await prepareForReview(a, rcaId);
  });

  it('is only possible while IN_REVIEW', async () => {
    expect((await api().post(u('/signoffs/DEV_LEAD')).set(bearer(a.OWNER)).send({})).status).toBe(409);
  });

  it('unassigned rows: OWNER/EDITOR sign; contributors and viewers cannot', async () => {
    await api().post(u('/submit-review')).set(bearer(a.EDITOR)).send({});
    for (const r of ['DEV', 'QA', 'PROD', 'VIEWER'] as RoleKey[]) expect((await api().post(u('/signoffs/DEV_LEAD')).set(bearer(a[r])).send({})).status).toBe(403);
    expect((await api().post(u('/signoffs/BOSS')).set(bearer(a.OWNER)).send({})).status).toBe(400);
    expect((await api().post(u('/signoffs/PROJECT_OWNER')).set(bearer(a.OWNER)).send({})).status).toBe(422); // team leads first
    const dev = await api().post(u('/signoffs/DEV_LEAD')).set(bearer(a.EDITOR)).send({ comment: 'LGTM' });
    expect(dev.body.signoffs.find((x: { role: string }) => x.role === 'DEV_LEAD')).toMatchObject({ user_id: a.EDITOR.id, comment: 'LGTM' });
    expect((await api().post(u('/signoffs/DEV_LEAD')).set(bearer(a.OWNER)).send({})).status).toBe(409);
  });

  it('assigned rows: only the assignee signs; assignment is OWNER/EDITOR only and must be a participant', async () => {
    const assign = (as: Actor, role: string, userId: string | null) =>
      api().put(u(`/signoffs/${role}/assignee`)).set(bearer(as)).send({ user_id: userId });
    expect((await assign(a.DEV, 'DEV_LEAD', a.DEV.id)).status).toBe(403);
    expect((await assign(a.OWNER, 'DEV_LEAD', a.OUTSIDER.id)).status).toBe(400);
    const res = await assign(a.OWNER, 'DEV_LEAD', a.DEV.id);
    expect(res.body.signoffs.find((x: { role: string }) => x.role === 'DEV_LEAD').assignee.id).toBe(a.DEV.id);
    expect(res.body.permissions.sign.DEV_LEAD).toBe(false); // the owner is not the assignee
    await api().post(u('/submit-review')).set(bearer(a.EDITOR)).send({});
    expect((await api().post(u('/signoffs/DEV_LEAD')).set(bearer(a.OWNER)).send({})).status).toBe(403);
    const dev = await api().post(u('/signoffs/DEV_LEAD')).set(bearer(a.DEV)).send({});
    expect(dev.status).toBe(200);
    const assigned = await api().get('/api/v1/my-tasks').set(bearer(a.QA));
    expect(assigned.body.signoffs).toEqual([]);
  });
});

describe('IN_REVIEW -> CLOSED', () => {
  it('cannot close until all sign-offs are done; closed RCAs are read-only', async () => {
    await prepareForReview(a, rcaId);
    await api().post(u('/submit-review')).set(bearer(a.EDITOR)).send({});
    const early = await api().post(u('/close')).set(bearer(a.OWNER)).send({});
    expect(early.status).toBe(422);
    expect(early.body.details.unsigned).toHaveLength(5);
    await signAll(a.EDITOR, rcaId);
    expect((await api().post(u('/close')).set(bearer(a.DEV)).send({})).status).toBe(403);
    const ok = await api().post(u('/close')).set(bearer(a.EDITOR)).send({});
    expect(ok.body.status).toBe('CLOSED');
    expect((await api().patch(u()).set(bearer(a.OWNER)).send({ lessons_key: 'x' })).status).toBe(409);
  });

  it('open actions block closing until completed or moved to follow-ups with owner and date', async () => {
    const actions = await prepareForReview(a, rcaId, 'IN_PROGRESS');
    await api().post(u('/submit-review')).set(bearer(a.EDITOR)).send({});
    await signAll(a.OWNER, rcaId);
    const blocked = await api().post(u('/close')).set(bearer(a.OWNER)).send({});
    expect(blocked.body.details.open_actions).toBe(3);
    await api().patch(u(`/sections/DEV/actions/${actions.DEV.id}`)).set(bearer(a.DEV)).send({ status: 'COMPLETED', completed_on: '2026-10-01' });
    const noOwner = await api().post(u('/followups')).set(bearer(a.EDITOR)).send({ risk: 'QA follow-up', action_id: actions.QA.id });
    expect(Object.keys(noOwner.body.fields).sort()).toEqual(['due_date', 'owner_id']);
    expect(
      (await api().post(u('/followups')).set(bearer(a.EDITOR)).send({ risk: 'Regression pack', action_id: actions.QA.id, owner_id: a.QA.id, due_date: '2026-11-30' })).status,
    ).toBe(201);
    expect((await api().post(u('/close')).set(bearer(a.OWNER)).send({})).body.details.open_actions).toBe(1);
    await api().patch(u(`/sections/PROD/actions/${actions.PROD.id}`)).set(bearer(a.PROD)).send({ status: 'COMPLETED' });
    expect((await api().post(u('/close')).set(bearer(a.OWNER)).send({})).status).toBe(200);
  });

  it('a solo user completes the whole workflow alone: sections, review, all five sign-offs, close', async () => {
    const solo = await createUser('Solo');
    const r = await createRca(solo, solo.personalWorkspaceId);
    await prepareForReview({ OWNER: solo }, r.id);
    expect((await api().post(`/api/v1/rcas/${r.id}/submit-review`).set(bearer(solo)).send({})).status).toBe(200);
    await signAll(solo, r.id);
    const closed = await api().post(`/api/v1/rcas/${r.id}/close`).set(bearer(solo)).send({});
    expect(closed.body.status).toBe('CLOSED');
  });
});

describe('send back and reopen', () => {
  it('send back unlocks only the named sections and resets sign-offs', async () => {
    await prepareForReview(a, rcaId);
    await api().post(u('/submit-review')).set(bearer(a.EDITOR)).send({});
    await api().post(u('/signoffs/DEV_LEAD')).set(bearer(a.EDITOR)).send({});
    expect((await api().post(u('/send-back')).set(bearer(a.DEV)).send({ comment: 'x', teams: ['QA'] })).status).toBe(403);
    expect(Object.keys((await api().post(u('/send-back')).set(bearer(a.EDITOR)).send({})).body.fields).sort()).toEqual(['comment', 'teams']);
    const res = await api().post(u('/send-back')).set(bearer(a.EDITOR)).send({ comment: 'QA: add test IDs', teams: ['QA'] });
    expect(res.body.status).toBe('DRAFT');
    const status = Object.fromEntries(res.body.sections.map((s: { team: string; section_status: string }) => [s.team, s.section_status]));
    expect(status).toEqual({ DEV: 'SUBMITTED', QA: 'IN_PROGRESS', PROD: 'SUBMITTED' });
    expect(res.body.signoffs.every((s: { signed_at: string | null }) => s.signed_at === null)).toBe(true);
  });

  it('reopen: OWNER/EDITOR only, reason required, version + 1', async () => {
    await prepareForReview(a, rcaId);
    await api().post(u('/submit-review')).set(bearer(a.EDITOR)).send({});
    await signAll(a.OWNER, rcaId);
    await api().post(u('/close')).set(bearer(a.OWNER)).send({});
    expect((await api().post(u('/reopen')).set(bearer(a.DEV)).send({ reason: 'x' })).status).toBe(403);
    expect((await api().post(u('/reopen')).set(bearer(a.OWNER)).send({})).status).toBe(400);
    const res = await api().post(u('/reopen')).set(bearer(a.OWNER)).send({ reason: 'New evidence' });
    expect(res.body).toMatchObject({ status: 'DRAFT', version: 2, closed_at: null });
  });

  it('every status change is visible in the RCA history, for every member', async () => {
    await prepareForReview(a, rcaId);
    await api().post(u('/submit-review')).set(bearer(a.EDITOR)).send({});
    await api().post(u('/send-back')).set(bearer(a.EDITOR)).send({ comment: 'fix', teams: ['DEV'] });
    await fillAndSubmitSection(a.DEV, rcaId, 'DEV');
    await api().post(u('/submit-review')).set(bearer(a.EDITOR)).send({});
    await signAll(a.OWNER, rcaId);
    await api().post(u('/close')).set(bearer(a.OWNER)).send({});
    await api().post(u('/reopen')).set(bearer(a.OWNER)).send({ reason: 'x' });
    for (const role of MEMBER_KEYS) {
      const res = await api().get(u('/audit?page_size=200&sort=at')).set(bearer(a[role]));
      const rcaEvents = res.body.data.filter((e: { entity: string }) => e.entity === 'rca').map((e: { action: string }) => e.action);
      expect(rcaEvents).toEqual(['CREATE', 'UPDATE', 'SUBMIT', 'SEND_BACK', 'SUBMIT', 'CLOSE', 'REOPEN']);
    }
    expect((await api().get(u('/audit')).set(bearer(a.OUTSIDER))).status).toBe(404);
  });
});

describe('follow-ups', () => {
  it('OWNER/EDITOR manage follow-ups; owners must be participants', async () => {
    expect((await api().post(u('/followups')).set(bearer(a.DEV)).send({ risk: 'x' })).status).toBe(403);
    expect((await api().post(u('/followups')).set(bearer(a.EDITOR)).send({ risk: 'x', owner_id: a.OUTSIDER.id })).status).toBe(400);
    const f = await api().post(u('/followups')).set(bearer(a.OWNER)).send({ risk: 'Vendor SLA', owner_id: a.PROD.id, due_date: '2026-12-01' });
    expect(f.body.owner.id).toBe(a.PROD.id);
    expect((await api().patch(u(`/followups/${f.body.id}`)).set(bearer(a.EDITOR)).send({ risk: 'Vendor SLA review' })).body.risk).toBe('Vendor SLA review');
    expect((await api().get(u('/followups')).set(bearer(a.VIEWER))).body.data).toHaveLength(1);
    expect((await api().delete(u(`/followups/${f.body.id}`)).set(bearer(a.QA))).status).toBe(403);
    expect((await api().delete(u(`/followups/${f.body.id}`)).set(bearer(a.OWNER))).status).toBe(204);
  });
});

describe('workspace audit log', () => {
  it('OWNER/EDITOR see their workspace data events; others see nothing', async () => {
    const get = (as: Actor, q = '') => api().get(`/api/v1/audit?${q}`).set(bearer(as));
    // The RCA creation plus the fixture's Team activation (billing changes are audited too).
    expect((await get(a.OWNER)).body.data.map((e: { action: string }) => e.action).sort()).toEqual(['BILLING', 'CREATE']);
    expect((await get(a.EDITOR, `rca_id=${rcaId}`)).body.data[0].rca.rca_number).toBe('RCA-2026-0001');
    expect((await get(a.EDITOR, `user_id=${a.DEV.id}`)).body.total).toBe(0);
    expect((await get(a.OWNER, 'date_from=2000-01-01&date_to=2000-01-02')).body.total).toBe(0);
    expect((await get(a.DEV)).body.total).toBe(0);
    expect((await get(a.OUTSIDER)).body.total).toBe(0);
    expect(await raw(() => db.auditLog.count())).toBe(2);
  });
});
