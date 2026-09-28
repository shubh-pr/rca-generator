import type { Team } from '@prisma/client';
import type { Db } from '../db.js';
import { nextRcaNumber } from './rcaNumber.js';

const TEAMS: Team[] = ['DEV', 'QA', 'PROD'];
const SIGNOFF_ROLES = ['PROJECT_OWNER', 'RCA_LEAD', 'DEV_LEAD', 'QA_LEAD', 'PROD_LEAD'] as const;
const d = (s: string) => new Date(`${s}T00:00:00Z`);

const SECTION_DATA: Record<Team, { cause: 'CODE_DEFECT' | 'TEST_GAP' | 'INFRA'; whys: string[]; escape: string; extra_1: string; extra_2: string; action: string }> = {
  DEV: {
    cause: 'CODE_DEFECT',
    whys: [
      'Checkout API returned HTTP 500 for card payments',
      'Currency converter threw a null pointer exception',
      'Merchant records created after 1 Sep had no currency',
      'The migration added the column without a default',
      'Schema changes are not reviewed for nullability of existing reads',
    ],
    escape: 'Code review did not cover the migration script',
    extra_1: 'No unit test for a null currency',
    extra_2: 'PR #4821, release 4.2.1',
    action: 'Add a NOT NULL default and a null-safe converter with unit tests',
  },
  QA: {
    cause: 'TEST_GAP',
    whys: ['Regression suite passed', 'Suite used only legacy merchants', 'Test data was never refreshed', 'No owner for test data', 'Test-data refresh is not part of the release checklist'],
    escape: 'No regression case for merchants without a currency',
    extra_1: 'Payment regression suite missed new-merchant edge cases',
    extra_2: 'TC-882, TC-883',
    action: 'Add TC-882 and TC-883 to the payment regression pack',
  },
  PROD: {
    cause: 'INFRA',
    whys: ['Alert fired 12 minutes late', '5xx alert used a 10-minute window', 'Thresholds copied from staging', 'No review of alert rules', 'Alerting is not part of the go-live checklist'],
    escape: 'Alert window too long; rollback needed a manual approval',
    extra_1: '5xx alert window 10 minutes, should be 2',
    extra_2: 'Rollback runbook required on-call manager approval',
    action: 'Reduce 5xx alert window to 2 minutes and pre-approve rollback',
  },
};

export interface SamplePeople {
  /** Person shown as Project Owner (text) and who signs PROJECT_OWNER. */
  owner: { id: string; name: string };
  lead: { id: string; name: string };
  DEV: { id: string; name: string };
  QA: { id: string; name: string };
  PROD: { id: string; name: string };
}

/**
 * A complete, CLOSED example RCA (all sections, actions, sign-offs). Used by the demo seed and by the
 * onboarding "Create a sample RCA" choice, where every person is the new user and is_sample is true.
 */
export async function createClosedSample(tx: Db, workspaceId: string, p: SamplePeople, opts: { isSample?: boolean; year?: number } = {}) {
  const signedAt = new Date('2026-09-20T10:00:00Z');
  const rca = await tx.rca.create({
    data: {
      workspace_id: workspaceId,
      rca_number: await nextRcaNumber(tx, workspaceId, opts.year ?? 2026),
      is_sample: opts.isSample ?? false,
      rca_date: d('2026-09-12'),
      company_name: 'Acme Payments Pvt Ltd',
      project_name: 'Payment Gateway',
      project_owner_name: p.owner.name,
      team_leader_name: p.lead.name,
      ticket_id: 'INC-10231',
      severity: 'P1',
      environment: 'PROD',
      status: 'CLOSED',
      incident_start: new Date('2026-09-11T09:30:00+05:30'),
      detected_at: new Date('2026-09-11T09:42:00+05:30'),
      resolved_at: new Date('2026-09-11T10:25:00+05:30'),
      prepared_by_name: p.lead.name,
      reviewed_by_name: p.owner.name,
      summary:
        'Card payments failed with HTTP 500 for 55 minutes after release 4.2.1. New merchants without a currency caused a null pointer in the converter.',
      impact_users: 'About 3,200 card customers across 140 new merchants',
      impact_duration: '55 minutes',
      impact_data_revenue: 'About INR 18 lakh of payments retried; no data loss',
      sla_breached: true,
      detection_method: 'MONITORING',
      immediate_fix: 'Rolled back to release 4.2.0 and back-filled merchant currency',
      immediate_fix_by: `${p.PROD.name}, 10:20 IST`,
      lessons_well: 'Rollback was clean once approved; clear incident channel',
      lessons_not_well: 'Detection took 12 minutes; approval step slowed the rollback',
      lessons_key: 'Review migrations for nullability; keep alert windows short',
      closed_at: new Date('2026-09-21T12:00:00Z'),
      created_by: p.lead.id,
      updated_by: p.owner.id,
      timeline: {
        create: [
          { event_time: new Date('2026-09-11T09:30:00+05:30'), event: 'Release 4.2.1 deployed', team_or_person: 'PROD', sort_order: 1 },
          { event_time: new Date('2026-09-11T09:42:00+05:30'), event: '5xx alert fired', team_or_person: 'Monitoring', sort_order: 2 },
          { event_time: new Date('2026-09-11T10:20:00+05:30'), event: 'Rollback to 4.2.0 completed', team_or_person: p.PROD.name, sort_order: 3 },
          { event_time: new Date('2026-09-11T10:25:00+05:30'), event: 'Error rate back to normal', team_or_person: 'PROD', sort_order: 4 },
        ],
      },
      signoffs: {
        create: SIGNOFF_ROLES.map((role) => {
          const who = { PROJECT_OWNER: p.owner, RCA_LEAD: p.lead, DEV_LEAD: p.DEV, QA_LEAD: p.QA, PROD_LEAD: p.PROD }[role];
          return { role, assignee_user_id: who.id, user_id: who.id, signed_at: signedAt };
        }),
      },
      followups: { create: [{ risk: 'Other services use the same migration pattern', owner_id: p.lead.id, due_date: d('2026-11-30'), created_by: p.lead.id }] },
      attachments: { create: [{ kind: 'LINK', url: 'https://grafana.example.com/d/payments', description: 'Payments error-rate dashboard', uploaded_by: p.PROD.id }] },
    },
  });
  for (const team of TEAMS) {
    const s = SECTION_DATA[team];
    await tx.rcaTeamSection.create({
      data: {
        rca_id: rca.id,
        team,
        contributor_name: p[team].name,
        cause_category: s.cause,
        escape_analysis: s.escape,
        extra_1: s.extra_1,
        extra_2: s.extra_2,
        prev_process: 'Added to the release checklist',
        prev_automation: 'CI check added',
        prev_owner_date: 'Team lead, 30 Sep 2026',
        target_date: d('2026-09-30'),
        actual_date: d('2026-09-18'),
        completion_status: 'COMPLETED',
        verified_by_name: p.lead.name,
        section_status: 'SUBMITTED',
        submitted_at: new Date('2026-09-15T10:00:00Z'),
        version: 4,
        updated_by: p[team].id,
        whys: { create: s.whys.map((answer, i) => ({ why_no: i + 1, answer })) },
        actions: {
          create: [{ seq: 1, action: s.action, owner_id: p[team].id, due_date: d('2026-09-19'), status: 'COMPLETED', completed_on: d('2026-09-18'), created_by: p[team].id }],
        },
      },
    });
  }
  await tx.auditLog.create({ data: { entity: 'rca', entity_id: rca.id, rca_id: rca.id, workspace_id: workspaceId, action: 'CREATE', new_value: { sample: true }, user_id: p.lead.id } });
  return rca;
}

/** A DRAFT example: Dev submitted, QA in progress (with an overdue action), Production not started. */
export async function createDraftSample(tx: Db, workspaceId: string, p: SamplePeople) {
  const rca = await tx.rca.create({
    data: {
      workspace_id: workspaceId,
      rca_number: await nextRcaNumber(tx, workspaceId, 2026),
      rca_date: d('2026-09-26'),
      company_name: 'Acme Payments Pvt Ltd',
      project_name: 'Payment Gateway',
      project_owner_name: p.owner.name,
      team_leader_name: p.lead.name,
      ticket_id: 'INC-10452',
      severity: 'P2',
      environment: 'PROD',
      incident_start: new Date('2026-09-25T14:05:00+05:30'),
      detected_at: new Date('2026-09-25T14:15:00+05:30'),
      resolved_at: new Date('2026-09-25T14:45:00+05:30'),
      prepared_by_name: p.lead.name,
      summary: 'Payment API returned 500 for 40 minutes for UPI refunds.',
      impact_users: 'UPI refund requests from all merchants',
      impact_duration: '40 minutes',
      detection_method: 'CLIENT_REPORT',
      immediate_fix: 'Restarted the refund worker pool',
      created_by: p.lead.id,
      updated_by: p.lead.id,
      timeline: { create: [{ event_time: new Date('2026-09-25T14:15:00+05:30'), event: 'Merchant reported failed refunds', team_or_person: 'Support', sort_order: 1 }] },
      signoffs: { create: SIGNOFF_ROLES.map((role) => ({ role })) },
    },
  });
  for (const team of TEAMS) {
    const status = team === 'DEV' ? 'SUBMITTED' : team === 'QA' ? 'IN_PROGRESS' : 'NOT_STARTED';
    await tx.rcaTeamSection.create({
      data: {
        rca_id: rca.id,
        team,
        section_status: status,
        submitted_at: status === 'SUBMITTED' ? new Date('2026-09-27T06:00:00Z') : null,
        version: status === 'NOT_STARTED' ? 1 : 3,
        updated_by: status === 'NOT_STARTED' ? null : p[team].id,
        cause_category: status === 'NOT_STARTED' ? null : team === 'DEV' ? 'CODE_DEFECT' : 'TEST_GAP',
        escape_analysis: status === 'SUBMITTED' ? 'Worker pool exhaustion not covered by load test' : null,
        whys: {
          create: [1, 2, 3, 4, 5].map((n) => ({
            why_no: n,
            answer:
              status === 'SUBMITTED' && (n === 1 || n === 5)
                ? n === 1
                  ? 'Refund workers stopped'
                  : 'Connection pool size is not tuned per worker count'
                : status === 'IN_PROGRESS' && n === 1
                  ? 'Load test did not include refunds'
                  : null,
          })),
        },
        actions:
          status === 'NOT_STARTED'
            ? undefined
            : {
                create: [
                  team === 'DEV'
                    ? { seq: 1, action: 'Size connection pool from worker count', owner_id: p.DEV.id, due_date: d('2026-10-10'), status: 'IN_PROGRESS', created_by: p.DEV.id }
                    : { seq: 1, action: 'Add refund scenarios to the load test', owner_id: p.QA.id, due_date: d('2026-09-27'), status: 'NOT_STARTED', created_by: p.QA.id },
                ],
              },
      },
    });
  }
  await tx.auditLog.create({ data: { entity: 'rca', entity_id: rca.id, rca_id: rca.id, workspace_id: workspaceId, action: 'CREATE', new_value: { sample: true }, user_id: p.lead.id } });
  return rca;
}
