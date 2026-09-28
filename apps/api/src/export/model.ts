/**
 * One export model, in the section order of RCA_Template.docx, used by the print page (and so the PDF)
 * and by the Word export. Keeping both outputs on this model keeps them in the same order.
 */
import type { Team } from '@prisma/client';
import { formatDateOnly, formatDuration, formatIstDateTime, minutesBetween } from '../lib/dates.js';
import type { FullRca } from '../services/rcaQueries.js';

export interface KV {
  label: string;
  value: string;
}

export interface TableBlock {
  head: string[];
  rows: string[][];
  /** Column widths in percent. */
  widths: number[];
}

export interface TeamBlock {
  heading: string;
  status: string;
  fields: KV[];
  whys: TableBlock;
  escape: KV[];
  actions: TableBlock;
  prevention: KV[];
  completion: KV[];
}

export interface ExportModel {
  title: string;
  rcaNumber: string;
  projectName: string;
  severity: string;
  version: number;
  isDraft: boolean;
  generatedAt: string;
  blameless: string;
  header: KV[];
  common: {
    problem: KV[];
    impact: KV[];
    detection: KV[];
    timeline: TableBlock;
    immediateFix: KV[];
  };
  teams: TeamBlock[];
  closing: {
    lessons: KV[];
    followups: TableBlock;
    attachments: TableBlock;
    signoff: TableBlock;
  };
}

export const TEAM_LABEL: Record<Team, string> = { DEV: 'Dev', QA: 'QA', PROD: 'Production' };

export const TEAM_PROMPTS: Record<Team, { escape: string; extra1: string; extra2: string }> = {
  DEV: { escape: 'Why it was not prevented', extra1: 'Code review / unit test gap', extra2: 'Related PR / commit / release' },
  QA: { escape: 'Why it was not caught', extra1: 'Missing test case / regression gap', extra2: 'Test case IDs to add or update' },
  PROD: { escape: 'Why it was not prevented or detected early', extra1: 'Monitoring / alerting gap', extra2: 'Deployment / rollback gap' },
};

const CAUSE: Record<string, string> = {
  CODE_DEFECT: 'Code defect',
  CONFIG: 'Configuration',
  REQUIREMENT_GAP: 'Requirement gap',
  TEST_GAP: 'Test gap',
  DEPLOYMENT: 'Deployment',
  INFRA: 'Infrastructure',
  THIRD_PARTY: 'Third party',
  DATA: 'Data',
};
const DETECTION: Record<string, string> = { MONITORING: 'Monitoring / alert', CLIENT_REPORT: 'Client report', QA: 'QA', OTHER: 'Other' };
const ENV: Record<string, string> = { PROD: 'Production', UAT: 'UAT', STAGING: 'Staging' };
const STATUS: Record<string, string> = { NOT_STARTED: 'Not started', IN_PROGRESS: 'In progress', SUBMITTED: 'Submitted', COMPLETED: 'Completed' };
const RCA_STATUS: Record<string, string> = { DRAFT: 'Draft', IN_REVIEW: 'In review', CLOSED: 'Closed' };
const SIGNOFF_ORDER = ['DEV_LEAD', 'QA_LEAD', 'PROD_LEAD', 'PROJECT_OWNER', 'RCA_LEAD'] as const;
const SIGNOFF_LABEL: Record<string, string> = {
  DEV_LEAD: 'Dev Lead',
  QA_LEAD: 'QA Lead',
  PROD_LEAD: 'Production Lead',
  PROJECT_OWNER: 'Project Owner',
  RCA_LEAD: 'RCA Team Leader',
};

/** Blank rows appended to each table so the printout can also be handwritten. */
export const MIN_ROWS = { timeline: 5, actions: 3, followups: 3, attachments: 2 };

function pad(rows: string[][], min: number, cols: number): string[][] {
  const out = [...rows];
  while (out.length < min) out.push(Array(cols).fill(''));
  return out;
}

const v = (s: string | null | undefined) => (s ?? '').trim();

const TIMELINE_HEAD = ['Time (IST)', 'Event', 'Team / person'];
const WHYS_HEAD = ['Why', 'Answer'];
const ACTIONS_HEAD = ['#', 'Action', 'Owner', 'Due date', 'Status'];
const FOLLOWUP_HEAD = ['Risk / follow-up', 'Owner', 'Due date'];
const ATTACH_HEAD = ['Attachment', 'Description', 'Added by'];
const SIGN_HEAD = ['Role', 'Name', 'Signature', 'Date'];

export function buildExportModel(rca: FullRca | null, generatedAt = new Date()): ExportModel {
  const r = rca;
  const teams: Team[] = ['DEV', 'QA', 'PROD'];
  const section = (t: Team) => r?.sections.find((s) => s.team === t);

  return {
    title: 'Root Cause Analysis (RCA)',
    rcaNumber: r?.rca_number ?? '',
    projectName: r?.project.name ?? '',
    severity: r?.severity ?? '',
    version: r?.version ?? 1,
    isDraft: r?.status !== 'CLOSED',
    generatedAt: formatIstDateTime(generatedAt),
    blameless: 'Blameless RCA: focus on systems and processes, not individuals.',
    header: [
      { label: 'RCA number', value: v(r?.rca_number) },
      { label: 'Date', value: formatDateOnly(r?.rca_date) },
      { label: 'Company', value: v(r?.project.company.name) },
      { label: 'Project', value: v(r?.project.name) },
      { label: 'Project Owner', value: v(r?.project.owner.name) },
      { label: 'RCA Team Leader', value: v(r?.team_leader.name) },
      { label: 'Ticket / incident ID', value: v(r?.ticket_id) },
      { label: 'Severity', value: v(r?.severity) },
      { label: 'Environment', value: r ? ENV[r.environment] : '' },
      { label: 'Status / version', value: r ? `${RCA_STATUS[r.status]} / v${r.version}` : '' },
      { label: 'Incident start', value: formatIstDateTime(r?.incident_start) },
      { label: 'Detected at', value: formatIstDateTime(r?.detected_at) },
      { label: 'Resolved at', value: formatIstDateTime(r?.resolved_at) },
      { label: 'Time to detect', value: r ? formatDuration(minutesBetween(r.incident_start, r.detected_at)) : '' },
      { label: 'Prepared by', value: v(r?.prepared_by_user?.name) },
      { label: 'Reviewed by', value: v(r?.reviewed_by_user?.name) },
    ],
    common: {
      problem: [{ label: 'Summary (2-3 lines)', value: v(r?.summary) }],
      impact: [
        { label: 'Users / clients affected', value: v(r?.impact_users) },
        { label: 'Duration', value: v(r?.impact_duration) },
        { label: 'Data / revenue', value: v(r?.impact_data_revenue) },
        { label: 'SLA breached', value: r ? (r.sla_breached ? 'Yes' : 'No') : '' },
      ],
      detection: [
        { label: 'Detection method', value: r?.detection_method ? DETECTION[r.detection_method] : '' },
        { label: 'Detected at', value: formatIstDateTime(r?.detected_at) },
        { label: 'Time to detect', value: r ? formatDuration(minutesBetween(r.incident_start, r.detected_at)) : '' },
      ],
      timeline: {
        head: TIMELINE_HEAD,
        widths: [25, 55, 20],
        rows: pad((r?.timeline ?? []).map((e) => [formatIstDateTime(e.event_time), e.event, v(e.team_or_person)]), MIN_ROWS.timeline, 3),
      },
      immediateFix: [
        { label: 'What stopped the impact', value: v(r?.immediate_fix) },
        { label: 'Applied by / at', value: v(r?.immediate_fix_by) },
      ],
    },
    teams: teams.map((team, i) => {
      const s = section(team);
      const p = TEAM_PROMPTS[team];
      const why = (n: number) => v(s?.whys.find((w) => w.why_no === n)?.answer);
      return {
        heading: `2.${i + 1} ${TEAM_LABEL[team]} section`,
        status: s ? STATUS[s.section_status] : '',
        fields: [
          { label: 'Team lead / RCA contributor', value: v(s?.contributor?.name) },
          { label: 'Cause category', value: s?.cause_category ? CAUSE[s.cause_category] : '' },
        ],
        whys: {
          head: WHYS_HEAD,
          widths: [22, 78],
          rows: [1, 2, 3, 4, 5].map((n) => [n === 5 ? 'Why 5 (Root cause)' : `Why ${n}`, why(n)]),
        },
        escape: [
          { label: p.escape, value: v(s?.escape_analysis) },
          { label: p.extra1, value: v(s?.extra_1) },
          { label: p.extra2, value: v(s?.extra_2) },
        ],
        actions: {
          head: ACTIONS_HEAD,
          widths: [6, 46, 18, 15, 15],
          rows: pad(
            (s?.actions ?? []).map((a) => [
              String(a.seq ?? ''),
              a.followup ? `${a.action} (moved to follow-ups)` : a.action,
              a.owner.name,
              formatDateOnly(a.due_date),
              STATUS[a.status],
            ]),
            MIN_ROWS.actions,
            5,
          ),
        },
        prevention: [
          { label: 'Process / checklist', value: v(s?.prev_process) },
          { label: 'Automation / tooling', value: v(s?.prev_automation) },
          { label: 'Owner and target date', value: v(s?.prev_owner_date) },
        ],
        completion: [
          { label: 'Target date', value: formatDateOnly(s?.target_date) },
          { label: 'Actual date', value: formatDateOnly(s?.actual_date) },
          { label: 'Completion status', value: s ? STATUS[s.completion_status] : '' },
          { label: 'Verified by', value: v(s?.verified_by_user?.name) },
        ],
      };
    }),
    closing: {
      lessons: [
        { label: 'What went well', value: v(r?.lessons_well) },
        { label: 'What did not go well', value: v(r?.lessons_not_well) },
        { label: 'Key takeaways', value: v(r?.lessons_key) },
      ],
      followups: {
        head: FOLLOWUP_HEAD,
        widths: [60, 22, 18],
        rows: pad((r?.followups ?? []).map((f) => [f.risk, v(f.owner?.name), formatDateOnly(f.due_date)]), MIN_ROWS.followups, 3),
      },
      attachments: {
        head: ATTACH_HEAD,
        widths: [40, 40, 20],
        rows: pad(
          (r?.attachments ?? []).map((a) => [a.kind === 'LINK' ? v(a.url) : v(a.file_name), v(a.description), v(a.uploader?.name)]),
          MIN_ROWS.attachments,
          3,
        ),
      },
      signoff: {
        head: SIGN_HEAD,
        widths: [22, 26, 30, 22],
        // Signature and date columns always print; a digital sign shows name and date.
        rows: SIGNOFF_ORDER.map((role) => {
          const s = r?.signoffs.find((x) => x.role === role);
          return [
            SIGNOFF_LABEL[role],
            v(s?.user?.name),
            s?.signed_at ? `Signed digitally by ${s.user?.name ?? ''}` : '',
            formatIstDateTime(s?.signed_at),
          ];
        }),
      },
    },
  };
}

/** SPEC 7 file name: RCA-2026-0007_ProjectName_v1.pdf */
export function exportFileName(m: Pick<ExportModel, 'rcaNumber' | 'projectName' | 'version'>, ext: string) {
  const project = m.projectName.replace(/[^A-Za-z0-9]+/g, '') || 'Project';
  return `${m.rcaNumber}_${project}_v${m.version}.${ext}`;
}
