import http from 'node:http';
import type { Team, WorkspaceRole } from '@prisma/client';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createSession } from '../src/auth/sessions.js';
import { hashPassword } from '../src/auth/password.js';
import { prisma } from '../src/db.js';
import { unscoped } from '../src/tenancy/context.js';
import { handleBillingEvent } from '../src/billing/events.js';

export const app = createApp();
// One server bound explicitly to 127.0.0.1. supertest's default (a new ephemeral server per request on
// all interfaces) can collide with other local processes on macOS and receive their responses.
const server = http.createServer(app).listen(0, '127.0.0.1');
server.unref();
export const api = () => request(server);

/** Direct DB access for tests (bypasses the tenant filter on purpose). */
export const db = prisma;
export const raw = <T>(fn: () => Promise<T>) => unscoped('test fixture', fn);

export const PASSWORD = 'Correct-Horse-9';

const TABLES = [
  'billing_events',
  'billing_history',
  'checkout_sessions',
  'audit_log',
  'support_grants',
  'usage_quotas',
  'refresh_tokens',
  'email_tokens',
  'invitations',
  'rca_collaborators',
  'rca_signoff',
  'rca_attachment',
  'rca_followup',
  'rca_action',
  'rca_why',
  'rca_team_section',
  'rca_timeline',
  'rca',
  'rca_number_seq',
  'workspace_members',
  'workspaces',
  'users',
];

export async function resetDb() {
  await prisma.$executeRawUnsafe(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(', ')} CASCADE`);
}

export interface Actor {
  id: string;
  name: string;
  email: string;
  token: string;
  /** The user's personal workspace. */
  personalWorkspaceId: string;
}

let hash: string | undefined;
let counter = 0;

/** A verified user with a personal workspace and a ready bearer token. */
export async function createUser(name = 'User', opts: { verified?: boolean; email?: string; platformAdmin?: boolean } = {}): Promise<Actor> {
  hash ??= await hashPassword(PASSWORD);
  counter += 1;
  const email = opts.email ?? `${name.toLowerCase().replace(/[^a-z0-9]+/g, '.')}.${counter}@test.local`;
  return raw(async () => {
    const user = await prisma.user.create({
      data: {
        name,
        email,
        password_hash: hash,
        email_verified_at: opts.verified === false ? null : new Date(),
        is_platform_admin: opts.platformAdmin ?? false,
      },
    });
    const ws = await prisma.workspace.create({
      data: { name: `${name}'s workspace`, owner_id: user.id, is_personal: true, members: { create: { user_id: user.id, role: 'OWNER' } } },
    });
    return { user, ws };
  }).then(async ({ user, ws }) => ({ id: user.id, name, email, token: (await createSession(user.id, 'vitest')).accessToken, personalWorkspaceId: ws.id }));
}

export async function addMember(workspaceId: string, actor: Actor, role: WorkspaceRole, team: Team | null = null) {
  await raw(() => prisma.workspaceMember.create({ data: { workspace_id: workspaceId, user_id: actor.id, role, team } }));
}

export async function addCollaborator(rcaId: string, actor: Actor, role: WorkspaceRole, team: Team | null = null) {
  await raw(() => prisma.rcaCollaborator.create({ data: { rca_id: rcaId, user_id: actor.id, role, team } }));
}

export type RoleKey = 'OWNER' | 'EDITOR' | 'DEV' | 'QA' | 'PROD' | 'VIEWER' | 'OUTSIDER';
export const MEMBER_KEYS: RoleKey[] = ['OWNER', 'EDITOR', 'DEV', 'QA', 'PROD', 'VIEWER'];

/**
 * A shared workspace owned by OWNER with an EDITOR, three team CONTRIBUTORs and a VIEWER, plus an
 * OUTSIDER who only has their own personal workspace.
 */
export async function createTeam(): Promise<{ a: Record<RoleKey, Actor>; workspaceId: string }> {
  const a = {} as Record<RoleKey, Actor>;
  for (const k of [...MEMBER_KEYS, 'OUTSIDER'] as RoleKey[]) a[k] = await createUser(`${k[0]}${k.slice(1).toLowerCase()} User`);
  const ws = await raw(() => prisma.workspace.create({ data: { name: 'Team workspace', owner_id: a.OWNER.id } }));
  await addMember(ws.id, a.OWNER, 'OWNER');
  await addMember(ws.id, a.EDITOR, 'EDITOR');
  await addMember(ws.id, a.DEV, 'CONTRIBUTOR', 'DEV');
  await addMember(ws.id, a.QA, 'CONTRIBUTOR', 'QA');
  await addMember(ws.id, a.PROD, 'CONTRIBUTOR', 'PROD');
  await addMember(ws.id, a.VIEWER, 'VIEWER');
  // Collaboration is a Team feature: the shared workspace has an active Team subscription.
  await subscribe(ws.id, 'TEAM', 20);
  return { a, workspaceId: ws.id };
}

let eventCounter = 0;

/** Give a workspace an active subscription through the real event path (as a verified webhook would). */
export async function subscribe(workspaceId: string, plan: 'SOLO' | 'TEAM', seats = 5, subscriptionRef = `test_sub_${workspaceId.slice(0, 8)}`) {
  eventCounter += 1;
  await handleBillingEvent('mock', {
    id: `test_evt_activate_${workspaceId}_${eventCounter}`,
    type: 'SUBSCRIPTION_ACTIVATED',
    workspaceId,
    plan,
    seats,
    subscriptionRef,
    customerRef: `test_cus_${workspaceId.slice(0, 8)}`,
    periodEnd: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    occurredAt: new Date().toISOString(),
  });
}

/** Send a subscription lifecycle event for the workspace's current subscription. */
export async function subscriptionEvent(workspaceId: string, type: 'SUBSCRIPTION_PAST_DUE' | 'SUBSCRIPTION_CANCELED' | 'SUBSCRIPTION_RENEWED', extra: Record<string, unknown> = {}) {
  eventCounter += 1;
  const ws = await raw(() => prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } }));
  return handleBillingEvent('mock', {
    id: `test_evt_${type}_${workspaceId}_${eventCounter}`,
    type,
    workspaceId,
    subscriptionRef: ws.subscription_ref ?? undefined,
    occurredAt: new Date().toISOString(),
    ...extra,
  });
}

export const bearer = (a: Actor) => ({ Authorization: `Bearer ${a.token}` });

export function rcaBody(workspaceId: string, overrides: Record<string, unknown> = {}) {
  return {
    workspace_id: workspaceId,
    rca_date: '2026-09-28',
    project_name: 'Payment Gateway',
    company_name: 'Acme',
    ticket_id: 'INC-10452',
    severity: 'P2',
    environment: 'PROD',
    incident_start: '2026-09-27T14:05:00+05:30',
    summary: 'Payment API returned 500 for 40 minutes.',
    ...overrides,
  };
}

/** Create an RCA through the API as the given actor; returns the response body. */
export async function createRca(actor: Actor, workspaceId: string, overrides: Record<string, unknown> = {}) {
  const res = await api().post('/api/v1/rcas').set(bearer(actor)).send(rcaBody(workspaceId, overrides));
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

/** Complete header/common and submit the three sections, each by the given actor (default: its team contributor). */
export async function prepareForReview(
  a: Partial<Record<RoleKey, Actor>> & { EDITOR?: Actor; OWNER: Actor },
  rcaId: string,
  actionStatus: 'COMPLETED' | 'IN_PROGRESS' = 'COMPLETED',
) {
  const editor = a.EDITOR ?? a.OWNER;
  const patch = await api().patch(`/api/v1/rcas/${rcaId}`).set(bearer(editor)).send(COMMON_COMPLETE);
  if (patch.status !== 200) throw new Error(`patch failed ${JSON.stringify(patch.body)}`);
  const actions: Record<string, { id: string }> = {};
  for (const team of ['DEV', 'QA', 'PROD'] as const) {
    actions[team] = (await fillAndSubmitSection(a[team] ?? a.OWNER, rcaId, team, { actionStatus })).action;
  }
  return actions;
}

/** Sign all five rows as `signer` (an OWNER/EDITOR signs unassigned rows), team leads first. */
export async function signAll(signer: Actor, rcaId: string) {
  for (const role of ['DEV_LEAD', 'QA_LEAD', 'PROD_LEAD', 'PROJECT_OWNER', 'RCA_LEAD']) {
    const res = await api().post(`/api/v1/rcas/${rcaId}/signoffs/${role}`).set(bearer(signer)).send({});
    if (res.status !== 200) throw new Error(`sign ${role} failed ${res.status} ${JSON.stringify(res.body)}`);
  }
}
