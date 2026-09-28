import { beforeEach, describe, expect, it } from 'vitest';
import {
  api,
  bearer,
  createActors,
  createProject,
  createRca,
  fillAndSubmitSection,
  prepareForReview,
  prisma,
  resetDb,
  signAll,
  type Actor,
  type RoleKey,
} from './helpers.js';

let a: Record<RoleKey, Actor>;
let rcaId: string;
const u = (s = '') => `/api/v1/rcas/${rcaId}${s}`;

beforeEach(async () => {
  await resetDb();
  a = await createActors();
  const { project } = await createProject(a.PROJECT_OWNER.id);
  rcaId = (await createRca(a.RCA_LEAD, project.id, a.RCA_LEAD.id)).id;
});

describe('DRAFT -> IN_REVIEW', () => {
  it('acceptance: cannot move to IN_REVIEW until all three sections are submitted', async () => {
    await api().patch(u()).set(bearer(a.RCA_LEAD)).send({
      detected_at: '2026-09-27T14:20:00+05:30',
      resolved_at: '2026-09-27T14:45:00+05:30',
      impact_users: 'All',
      detection_method: 'MONITORING',
      immediate_fix: 'Rollback',
    });
    await fillAndSubmitSection(a.DEV, rcaId, 'DEV');
    await fillAndSubmitSection(a.QA, rcaId, 'QA');
    const res = await api().post(u('/submit-review')).set(bearer(a.RCA_LEAD)).send({});
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('BUSINESS_RULE');
    expect(res.body.details.problems).toContain('PROD section is not submitted');
    await fillAndSubmitSection(a.PROD, rcaId, 'PROD');
    const ok = await api().post(u('/submit-review')).set(bearer(a.RCA_LEAD)).send({});
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('IN_REVIEW');
  });

  it('requires header and common sections to be complete', async () => {
    for (const team of ['DEV', 'QA', 'PROD'] as const) await fillAndSubmitSection(a[team], rcaId, team);
    const res = await api().post(u('/submit-review')).set(bearer(a.RCA_LEAD)).send({});
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.fields).sort()).toEqual(['detected_at', 'detection_method', 'immediate_fix', 'impact_users', 'resolved_at']);
  });

  it('only Admin, Owner and Lead may submit for review; twice is 409', async () => {
    await prepareForReview(a, rcaId);
    for (const r of ['DEV', 'QA', 'PROD', 'VIEWER'] as RoleKey[]) {
      expect((await api().post(u('/submit-review')).set(bearer(a[r])).send({})).status).toBe(403);
    }
    expect((await api().post(u('/submit-review')).set(bearer(a.PROJECT_OWNER)).send({})).status).toBe(200);
    expect((await api().post(u('/submit-review')).set(bearer(a.PROJECT_OWNER)).send({})).status).toBe(409);
  });
});

describe('sign-off', () => {
  beforeEach(async () => {
    await prepareForReview(a, rcaId);
  });

  it('is only possible while IN_REVIEW', async () => {
    expect((await api().post(u('/signoffs/DEV_LEAD')).set(bearer(a.DEV)).send({})).status).toBe(409);
  });

  it('own role only; Viewer never; team leads before Owner and Lead; no double sign', async () => {
    await api().post(u('/submit-review')).set(bearer(a.RCA_LEAD)).send({});
    expect((await api().post(u('/signoffs/QA_LEAD')).set(bearer(a.DEV)).send({})).status).toBe(403);
    expect((await api().post(u('/signoffs/DEV_LEAD')).set(bearer(a.VIEWER)).send({})).status).toBe(403);
    expect((await api().post(u('/signoffs/RCA_LEAD')).set(bearer(a.PROJECT_OWNER)).send({})).status).toBe(403);
    expect((await api().post(u('/signoffs/BOSS')).set(bearer(a.ADMIN)).send({})).status).toBe(400);

    const early = await api().post(u('/signoffs/PROJECT_OWNER')).set(bearer(a.PROJECT_OWNER)).send({});
    expect(early.status).toBe(422);

    const dev = await api().post(u('/signoffs/DEV_LEAD')).set(bearer(a.DEV)).send({ comment: 'LGTM' });
    expect(dev.status).toBe(200);
    const s = dev.body.signoffs.find((x: { role: string }) => x.role === 'DEV_LEAD');
    expect(s).toMatchObject({ user_id: a.DEV.id, comment: 'LGTM' });
    expect(s.signed_at).toBeTruthy();
    expect((await api().post(u('/signoffs/DEV_LEAD')).set(bearer(a.DEV)).send({})).status).toBe(409);

    const audit = await prisma.auditLog.findMany({ where: { rca_id: rcaId, action: 'SIGN' } });
    expect(audit).toHaveLength(1);
  });
});

describe('IN_REVIEW -> CLOSED', () => {
  it('acceptance: cannot close until all sign-offs are done', async () => {
    await prepareForReview(a, rcaId);
    await api().post(u('/submit-review')).set(bearer(a.RCA_LEAD)).send({});
    const early = await api().post(u('/close')).set(bearer(a.PROJECT_OWNER)).send({});
    expect(early.status).toBe(422);
    expect(early.body.details.unsigned).toHaveLength(5);
    await signAll(a, rcaId);
    expect((await api().post(u('/close')).set(bearer(a.RCA_LEAD)).send({})).status).toBe(403);
    const ok = await api().post(u('/close')).set(bearer(a.PROJECT_OWNER)).send({});
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('CLOSED');
    expect(ok.body.closed_at).toBeTruthy();
    // Closed RCAs are read-only.
    expect((await api().patch(u()).set(bearer(a.ADMIN)).send({ lessons_key: 'x' })).status).toBe(409);
    expect((await api().post(u('/close')).set(bearer(a.ADMIN)).send({})).status).toBe(409);
  });

  it('open actions block closing until completed or moved to follow-ups with owner and date', async () => {
    const actions = await prepareForReview(a, rcaId, 'IN_PROGRESS');
    await api().post(u('/submit-review')).set(bearer(a.RCA_LEAD)).send({});
    await signAll(a, rcaId);
    const blocked = await api().post(u('/close')).set(bearer(a.PROJECT_OWNER)).send({});
    expect(blocked.status).toBe(422);
    expect(blocked.body.details.open_actions).toBe(3);
    expect(blocked.body.message).toContain('3 actions still open');

    // DEV completes its action; QA's moves to follow-ups; PROD's stays open.
    await api().patch(u(`/sections/DEV/actions/${actions.DEV.id}`)).set(bearer(a.DEV)).send({ status: 'COMPLETED', completed_on: '2026-10-01' });
    const noOwner = await api().post(u('/followups')).set(bearer(a.RCA_LEAD)).send({ risk: 'QA follow-up', action_id: actions.QA.id });
    expect(noOwner.status).toBe(400);
    expect(Object.keys(noOwner.body.fields).sort()).toEqual(['due_date', 'owner_id']);
    const moved = await api()
      .post(u('/followups'))
      .set(bearer(a.RCA_LEAD))
      .send({ risk: 'Add regression pack', action_id: actions.QA.id, owner_id: a.QA.id, due_date: '2026-11-30' });
    expect(moved.status).toBe(201);
    expect(
      (await api().post(u('/followups')).set(bearer(a.RCA_LEAD)).send({ risk: 'again', action_id: actions.QA.id, owner_id: a.QA.id, due_date: '2026-11-30' })).status,
    ).toBe(409);
    const stillOne = await api().post(u('/close')).set(bearer(a.PROJECT_OWNER)).send({});
    expect(stillOne.body.details.open_actions).toBe(1);

    await api().patch(u(`/sections/PROD/actions/${actions.PROD.id}`)).set(bearer(a.PROD)).send({ status: 'COMPLETED' });
    expect((await api().post(u('/close')).set(bearer(a.PROJECT_OWNER)).send({})).status).toBe(200);
  });
});

describe('send back and reopen', () => {
  it('send back needs a comment and teams, unlocks only the named sections and resets sign-offs', async () => {
    await prepareForReview(a, rcaId);
    await api().post(u('/submit-review')).set(bearer(a.RCA_LEAD)).send({});
    await api().post(u('/signoffs/DEV_LEAD')).set(bearer(a.DEV)).send({});
    expect((await api().post(u('/send-back')).set(bearer(a.DEV)).send({ comment: 'x', teams: ['QA'] })).status).toBe(403);
    const bad = await api().post(u('/send-back')).set(bearer(a.RCA_LEAD)).send({});
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.fields).sort()).toEqual(['comment', 'teams']);

    const res = await api().post(u('/send-back')).set(bearer(a.RCA_LEAD)).send({ comment: 'QA: add test IDs', teams: ['QA'] });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('DRAFT');
    const status = Object.fromEntries(res.body.sections.map((s: { team: string; section_status: string }) => [s.team, s.section_status]));
    expect(status).toEqual({ DEV: 'SUBMITTED', QA: 'IN_PROGRESS', PROD: 'SUBMITTED' });
    expect(res.body.signoffs.every((s: { signed_at: string | null }) => s.signed_at === null)).toBe(true);
    // Dev is still locked; QA can edit again.
    const qa = res.body.sections.find((s: { team: string }) => s.team === 'QA');
    expect((await api().put(u('/sections/QA')).set(bearer(a.QA)).send({ version: qa.version, extra_2: 'TC-882' })).status).toBe(200);
    expect((await api().post(u('/send-back')).set(bearer(a.RCA_LEAD)).send({ comment: 'again', teams: ['DEV'] })).status).toBe(409);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { rca_id: rcaId, action: 'SEND_BACK' } });
    expect(audit.new_value).toMatchObject({ comment: 'QA: add test IDs', unlocked_teams: ['QA'] });
  });

  it('reopen: Admin/Owner only, reason required, version + 1, back to DRAFT with sign-offs cleared', async () => {
    await prepareForReview(a, rcaId);
    await api().post(u('/submit-review')).set(bearer(a.RCA_LEAD)).send({});
    expect((await api().post(u('/reopen')).set(bearer(a.ADMIN)).send({ reason: 'x' })).status).toBe(409);
    await signAll(a, rcaId);
    await api().post(u('/close')).set(bearer(a.PROJECT_OWNER)).send({});
    expect((await api().post(u('/reopen')).set(bearer(a.RCA_LEAD)).send({ reason: 'x' })).status).toBe(403);
    expect((await api().post(u('/reopen')).set(bearer(a.ADMIN)).send({})).status).toBe(400);
    const res = await api().post(u('/reopen')).set(bearer(a.ADMIN)).send({ reason: 'New evidence from client' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'DRAFT', version: 2, closed_at: null });
    expect(res.body.signoffs.every((s: { signed_at: string | null }) => s.signed_at === null)).toBe(true);
  });

  it('acceptance: every status change is visible in the audit log', async () => {
    await prepareForReview(a, rcaId);
    await api().post(u('/submit-review')).set(bearer(a.RCA_LEAD)).send({});
    await api().post(u('/send-back')).set(bearer(a.RCA_LEAD)).send({ comment: 'fix', teams: ['DEV'] });
    await fillAndSubmitSection(a.DEV, rcaId, 'DEV');
    await api().post(u('/submit-review')).set(bearer(a.RCA_LEAD)).send({});
    await signAll(a, rcaId);
    await api().post(u('/close')).set(bearer(a.PROJECT_OWNER)).send({});
    await api().post(u('/reopen')).set(bearer(a.PROJECT_OWNER)).send({ reason: 'x' });

    const res = await api().get(u('/audit?page_size=200&sort=at')).set(bearer(a.RCA_LEAD));
    expect(res.status).toBe(200);
    const rcaEvents = res.body.data.filter((e: { entity: string }) => e.entity === 'rca').map((e: { action: string }) => e.action);
    expect(rcaEvents).toEqual(['CREATE', 'UPDATE', 'SUBMIT', 'SEND_BACK', 'SUBMIT', 'CLOSE', 'REOPEN']);
    const actions = new Set(res.body.data.map((e: { action: string }) => e.action));
    for (const x of ['CREATE', 'UPDATE', 'SUBMIT', 'SIGN', 'CLOSE', 'REOPEN']) expect(actions).toContain(x);
    expect(res.body.data[0].user.name).toBeDefined();
  });
});

describe('follow-ups', () => {
  it('Lead+ manage follow-ups; others 403; edit and delete', async () => {
    expect((await api().post(u('/followups')).set(bearer(a.DEV)).send({ risk: 'x' })).status).toBe(403);
    expect((await api().post(u('/followups')).set(bearer(a.RCA_LEAD)).send({ risk: '' })).status).toBe(400);
    const f = await api().post(u('/followups')).set(bearer(a.PROJECT_OWNER)).send({ risk: 'Vendor SLA', owner_id: a.PROD.id, due_date: '2026-12-01' });
    expect(f.status).toBe(201);
    expect(f.body.owner.id).toBe(a.PROD.id);
    const upd = await api().patch(u(`/followups/${f.body.id}`)).set(bearer(a.RCA_LEAD)).send({ risk: 'Vendor SLA review' });
    expect(upd.body.risk).toBe('Vendor SLA review');
    expect((await api().get(u('/followups')).set(bearer(a.VIEWER))).body.data).toHaveLength(1);
    expect((await api().delete(u(`/followups/${f.body.id}`)).set(bearer(a.QA))).status).toBe(403);
    expect((await api().delete(u(`/followups/${f.body.id}`)).set(bearer(a.ADMIN))).status).toBe(204);
  });
});

describe('audit access', () => {
  it('per-RCA history: Lead, Owner, Admin; audit log screen: Owner, Admin', async () => {
    for (const r of ['ADMIN', 'PROJECT_OWNER', 'RCA_LEAD', 'DEV', 'QA', 'PROD', 'VIEWER'] as RoleKey[]) {
      const one = await api().get(u('/audit')).set(bearer(a[r]));
      expect(one.status, r).toBe(['ADMIN', 'PROJECT_OWNER', 'RCA_LEAD'].includes(r) ? 200 : 403);
      const all = await api().get('/api/v1/audit').set(bearer(a[r]));
      expect(all.status, r).toBe(['ADMIN', 'PROJECT_OWNER'].includes(r) ? 200 : 403);
    }
  });

  it('filters by RCA, user, action and date', async () => {
    const get = (q: string) => api().get(`/api/v1/audit?${q}`).set(bearer(a.ADMIN));
    expect((await get(`rca_id=${rcaId}`)).body.total).toBe(1);
    expect((await get('rca_number=RCA-2026-0001')).body.data[0].rca.rca_number).toBe('RCA-2026-0001');
    expect((await get(`user_id=${a.RCA_LEAD.id}`)).body.total).toBe(1);
    expect((await get(`user_id=${a.DEV.id}`)).body.total).toBe(0);
    expect((await get('action=CREATE')).body.total).toBe(1);
    expect((await get('date_from=2000-01-01&date_to=2000-01-02')).body.total).toBe(0);
    expect((await get('date_from=2000-01-01')).body.total).toBe(1);
  });
});
