import type { Team, UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { signAccessToken } from '../src/auth/jwt.js';
import { prisma } from '../src/db.js';

export const app = createApp();
export const api = () => request(app);
export { prisma };

export const PASSWORD = 'Password@123';

const TABLES = [
  'audit_log',
  'rca_signoff',
  'rca_attachment',
  'rca_followup',
  'rca_action',
  'rca_why',
  'rca_team_section',
  'rca_timeline',
  'rca',
  'rca_number_seq',
  'projects',
  'companies',
  'users',
];

export async function resetDb() {
  await prisma.$executeRawUnsafe(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(', ')} CASCADE`);
}

export type RoleKey = 'ADMIN' | 'PROJECT_OWNER' | 'RCA_LEAD' | 'DEV' | 'QA' | 'PROD' | 'VIEWER';
export const ROLE_KEYS: RoleKey[] = ['ADMIN', 'PROJECT_OWNER', 'RCA_LEAD', 'DEV', 'QA', 'PROD', 'VIEWER'];

export interface Actor {
  id: string;
  email: string;
  role: UserRole;
  token: string;
}

let hash: string | undefined;

/** One active user per role, with a ready bearer token. */
export async function createActors(): Promise<Record<RoleKey, Actor>> {
  hash ??= await bcrypt.hash(PASSWORD, 4);
  const out = {} as Record<RoleKey, Actor>;
  for (const role of ROLE_KEYS) {
    const team: Team | null = role === 'DEV' || role === 'QA' || role === 'PROD' ? role : null;
    const email = `${role.toLowerCase()}@test.local`;
    const user = await prisma.user.create({
      data: { name: `${role} User`, email, role, team, password_hash: hash },
    });
    out[role] = { id: user.id, email, role, token: signAccessToken({ sub: user.id, role }) };
  }
  return out;
}

/** Company + project owned by the PROJECT_OWNER actor. */
export async function createProject(ownerId: string, name = 'Payment Gateway') {
  const company = await prisma.company.create({ data: { name: `Company for ${name}` } });
  const project = await prisma.project.create({ data: { company_id: company.id, name, owner_user_id: ownerId } });
  return { company, project };
}

export const bearer = (a: Actor) => ({ Authorization: `Bearer ${a.token}` });

export function rcaBody(projectId: string, teamLeaderId: string, overrides: Record<string, unknown> = {}) {
  return {
    rca_date: '2026-09-28',
    project_id: projectId,
    team_leader_id: teamLeaderId,
    ticket_id: 'INC-10452',
    severity: 'P2',
    environment: 'PROD',
    incident_start: '2026-09-27T14:05:00+05:30',
    summary: 'Payment API returned 500 for 40 minutes.',
    ...overrides,
  };
}

/** Create an RCA through the API as the given actor; returns the response body. */
export async function createRca(actor: Actor, projectId: string, teamLeaderId: string, overrides: Record<string, unknown> = {}) {
  const res = await api().post('/api/v1/rcas').set(bearer(actor)).send(rcaBody(projectId, teamLeaderId, overrides));
  if (res.status !== 201) throw new Error(`createRca failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

export const COMPLETE_SECTION = {
  cause_category: 'CODE_DEFECT',
  escape_analysis: 'No test for null currency.',
  extra_1: 'Unit test gap',
  extra_2: 'PR-123',
  whys: [
    { why_no: 1, answer: 'API threw NPE' },
    { why_no: 5, answer: 'Currency default missing in config loader' },
  ],
};

/** Fill a team section with valid data, add one action, and submit it. */
export async function fillAndSubmitSection(
  actor: Actor,
  rcaId: string,
  team: 'DEV' | 'QA' | 'PROD',
  opts: { actionStatus?: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED'; ownerId?: string } = {},
) {
  const base = `/api/v1/rcas/${rcaId}/sections/${team}`;
  const current = await api().get(base).set(bearer(actor));
  const saved = await api().put(base).set(bearer(actor)).send({ version: current.body.version, ...COMPLETE_SECTION });
  if (saved.status !== 200) throw new Error(`save ${team} failed: ${saved.status} ${JSON.stringify(saved.body)}`);
  const action = await api()
    .post(`${base}/actions`)
    .set(bearer(actor))
    .send({
      action: `Fix for ${team}`,
      owner_id: opts.ownerId ?? actor.id,
      due_date: '2026-10-15',
      status: opts.actionStatus ?? 'COMPLETED',
      completed_on: opts.actionStatus && opts.actionStatus !== 'COMPLETED' ? null : '2026-09-30',
    });
  if (action.status !== 201) throw new Error(`action ${team} failed: ${action.status} ${JSON.stringify(action.body)}`);
  const submitted = await api().post(`${base}/submit`).set(bearer(actor)).send({});
  if (submitted.status !== 200) throw new Error(`submit ${team} failed: ${submitted.status} ${JSON.stringify(submitted.body)}`);
  return { section: submitted.body, action: action.body };
}

export const COMMON_COMPLETE = {
  detected_at: '2026-09-27T14:20:00+05:30',
  resolved_at: '2026-09-27T14:45:00+05:30',
  impact_users: 'All card customers',
  detection_method: 'MONITORING',
  immediate_fix: 'Rolled back release 4.2.1',
};

/** Complete header/common and submit all three sections with their own team users. */
export async function prepareForReview(a: Record<RoleKey, Actor>, rcaId: string, actionStatus: 'COMPLETED' | 'IN_PROGRESS' = 'COMPLETED') {
  const patch = await api().patch(`/api/v1/rcas/${rcaId}`).set(bearer(a.RCA_LEAD)).send(COMMON_COMPLETE);
  if (patch.status !== 200) throw new Error(`patch failed ${JSON.stringify(patch.body)}`);
  const actions: Record<string, { id: string }> = {};
  for (const team of ['DEV', 'QA', 'PROD'] as const) {
    actions[team] = (await fillAndSubmitSection(a[team], rcaId, team, { actionStatus })).action;
  }
  return actions;
}

export async function signAll(a: Record<RoleKey, Actor>, rcaId: string) {
  const order: [RoleKey, string][] = [
    ['DEV', 'DEV_LEAD'],
    ['QA', 'QA_LEAD'],
    ['PROD', 'PROD_LEAD'],
    ['PROJECT_OWNER', 'PROJECT_OWNER'],
    ['RCA_LEAD', 'RCA_LEAD'],
  ];
  for (const [actor, role] of order) {
    const res = await api().post(`/api/v1/rcas/${rcaId}/signoffs/${role}`).set(bearer(a[actor])).send({});
    if (res.status !== 200) throw new Error(`sign ${role} failed ${res.status} ${JSON.stringify(res.body)}`);
  }
}
