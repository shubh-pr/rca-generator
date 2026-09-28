import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useParams } from 'react-router';
import { api } from '../../api/client';
import type { AuditEntry, Paged, Rca, TeamSection } from '../../api/types';
import { ActionStatusChip, SectionBadge } from '../../components/Chips';
import { ErrorBanner } from '../../components/Form';
import { BlamelessNote } from '../../components/Layout';
import { formatDate, formatDateTime, formatMinutes } from '../../lib/dates';
import {
  ACTION_STATUS_LABEL,
  CAUSE_LABEL,
  DETECTION_LABEL,
  ENV_LABEL,
  SIGNOFF_LABEL,
  SIGNOFF_ROLES,
  STATUS_LABEL,
  TEAM_LABEL,
  TEAM_PROMPTS,
} from '../../lib/labels';
import { useRca } from './rcaApi';
import { RcaTitleBar } from './RcaTitleBar';

/** Read-only RCA in the same order as the Word template; also used for review (SPEC 6.1). */
export function RcaViewPage() {
  const { id = '' } = useParams();
  const rca = useRca(id);
  if (rca.isLoading) return <div className="text-slate-500">Loading…</div>;
  if (rca.error || !rca.data) return <ErrorBanner error={rca.error ?? 'RCA not found'} />;
  const r = rca.data;

  return (
    <div data-testid="rca-view">
      <BlamelessNote />
      <RcaTitleBar rca={r} mode="view" />
      <div className="card space-y-8">
        <Grid>
          <KV label="RCA number" value={r.rca_number} />
          <KV label="Date" value={formatDate(r.rca_date)} />
          <KV label="Status" value={`${STATUS_LABEL[r.status]} (v${r.version})`} />
          <KV label="Company" value={r.company_name} />
          <KV label="Project" value={r.project_name} />
          <KV label="Project Owner" value={r.project_owner_name} />
          <KV label="RCA Team Leader" value={r.team_leader_name} />
          <KV label="Ticket / incident ID" value={r.ticket_id} />
          <KV label="Severity" value={r.severity} />
          <KV label="Environment" value={ENV_LABEL[r.environment]} />
          <KV label="Incident start" value={formatDateTime(r.incident_start)} />
          <KV label="Detected at" value={formatDateTime(r.detected_at)} />
          <KV label="Resolved at" value={formatDateTime(r.resolved_at)} />
          <KV label="Time to detect" value={formatMinutes(r.time_to_detect_minutes)} />
          <KV label="Prepared by" value={r.prepared_by_name} />
          <KV label="Reviewed by" value={r.reviewed_by_name} />
        </Grid>

        <Section title="1. Common sections">
          <Sub title="1.1 Problem statement">
            <Text value={r.summary} />
          </Sub>
          <Sub title="1.2 Impact">
            <Grid>
              <KV label="Users / clients affected" value={r.impact_users} />
              <KV label="Duration" value={r.impact_duration} />
              <KV label="Data / revenue" value={r.impact_data_revenue} />
              <KV label="SLA breached" value={r.sla_breached ? 'Yes' : 'No'} />
            </Grid>
          </Sub>
          <Sub title="1.3 Detection">
            <Grid>
              <KV label="Detection method" value={r.detection_method ? DETECTION_LABEL[r.detection_method] : null} />
              <KV label="Detected at" value={formatDateTime(r.detected_at)} />
              <KV label="Time to detect" value={formatMinutes(r.time_to_detect_minutes)} />
            </Grid>
          </Sub>
          <Sub title="1.4 Timeline">
            <Table
              head={['Time (IST)', 'Event', 'Team / person']}
              rows={r.timeline.map((e) => [formatDateTime(e.event_time), e.event, e.team_or_person])}
            />
          </Sub>
          <Sub title="1.5 Immediate fix">
            <Grid>
              <KV label="What stopped the impact" value={r.immediate_fix} />
              <KV label="Applied by / at" value={r.immediate_fix_by} />
            </Grid>
          </Sub>
        </Section>

        <Section title="2. Team sections">
          {r.sections.map((s, i) => (
            <TeamBlock key={s.team} section={s} index={i + 1} />
          ))}
        </Section>

        <Section title="3. Closing sections">
          <Sub title="3.1 Lessons learned">
            <Grid>
              <KV label="What went well" value={r.lessons_well} />
              <KV label="What did not go well" value={r.lessons_not_well} />
              <KV label="Key takeaways" value={r.lessons_key} />
            </Grid>
          </Sub>
          <Sub title="3.2 Open risks / follow-ups">
            <Table head={['Risk / follow-up', 'Owner', 'Due date']} rows={r.followups.map((f) => [f.risk, f.owner?.name, formatDate(f.due_date)])} />
          </Sub>
          <Sub title="3.3 Attachments">
            <Table
              head={['Attachment', 'Description', 'Added by']}
              rows={r.attachments.map((a) => [a.kind === 'LINK' ? a.url : a.file_name, a.description, a.uploader?.name])}
            />
          </Sub>
          <Sub title="3.4 Sign-off">
            <Table
              head={['Role', 'Name', 'Signature', 'Date']}
              rows={SIGNOFF_ROLES.map((role) => {
                const s = r.signoffs.find((x) => x.role === role);
                return [SIGNOFF_LABEL[role], s?.user?.name, s?.signed_at ? `Signed digitally by ${s.user?.name}` : '', formatDateTime(s?.signed_at)];
              })}
            />
          </Sub>
        </Section>
      </div>
      <History rca={r} />
    </div>
  );
}

function TeamBlock({ section: s, index }: { section: TeamSection; index: number }) {
  const labels = TEAM_PROMPTS[s.team];
  const why = (n: number) => s.whys.find((w) => w.why_no === n)?.answer;
  return (
    <Sub
      title={
        <span className="flex items-center gap-2">
          2.{index} {TEAM_LABEL[s.team]} <SectionBadge value={s.section_status} />
        </span>
      }
    >
      <Grid>
        <KV label="Team lead / contributor" value={s.contributor_name} />
        <KV label="Cause category" value={s.cause_category ? CAUSE_LABEL[s.cause_category] : null} />
      </Grid>
      <Table head={['Why', 'Answer']} rows={[1, 2, 3, 4, 5].map((n) => [n === 5 ? 'Why 5 (Root cause)' : `Why ${n}`, why(n)])} />
      <Grid>
        <KV label={labels.escape_analysis} value={s.escape_analysis} />
        <KV label={labels.extra_1} value={s.extra_1} />
        <KV label={labels.extra_2} value={s.extra_2} />
      </Grid>
      <table className="table">
        <thead>
          <tr>
            <th>#</th>
            <th>Action</th>
            <th>Owner</th>
            <th>Due date</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {s.actions.map((a) => (
            <tr key={a.id} className={a.is_overdue ? 'bg-red-50 text-red-800' : ''}>
              <td>{a.seq}</td>
              <td>
                {a.action}
                {a.followup_id && <span className="ml-1 text-xs text-slate-500">(moved to follow-ups)</span>}
              </td>
              <td>{a.owner.name}</td>
              <td>
                {formatDate(a.due_date)} {a.is_overdue && <strong className="text-xs">overdue</strong>}
              </td>
              <td>
                <ActionStatusChip value={a.status} />
              </td>
            </tr>
          ))}
          {s.actions.length === 0 && <EmptyRow cols={5} />}
        </tbody>
      </table>
      <Grid>
        <KV label="Prevention: process / checklist" value={s.prev_process} />
        <KV label="Prevention: automation / tooling" value={s.prev_automation} />
        <KV label="Prevention: owner and target date" value={s.prev_owner_date} />
        <KV label="Target date" value={formatDate(s.target_date)} />
        <KV label="Actual date" value={formatDate(s.actual_date)} />
        <KV label="Completion status" value={ACTION_STATUS_LABEL[s.completion_status]} />
        <KV label="Verified by" value={s.verified_by_name} />
        <KV label="Last edited by" value={s.updated_by_user ? `${s.updated_by_user.name}, ${formatDateTime(s.updated_at)}` : null} />
      </Grid>
    </Sub>
  );
}

function History({ rca }: { rca: Rca }) {
  const q = useQuery({
    queryKey: ['rca-audit', rca.id, rca.updated_at],
    queryFn: () => api.get<Paged<AuditEntry>>(`/rcas/${rca.id}/audit`, { page_size: 100 }),
  });
  return (
    <div className="card mt-4">
      <h2 className="mb-2">Change history</h2>
      <ErrorBanner error={q.error} />
      <table className="table">
        <thead>
          <tr>
            <th>When</th>
            <th>Who</th>
            <th>Action</th>
            <th>What</th>
          </tr>
        </thead>
        <tbody>
          {q.data?.data.map((e) => (
            <tr key={e.id}>
              <td className="whitespace-nowrap">{formatDateTime(e.at)}</td>
              <td>{e.user?.name}</td>
              <td>{e.action}</td>
              <td className="text-xs">
                {e.entity}
                <AuditChange value={e.new_value} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AuditChange({ value }: { value: unknown }) {
  if (!value || typeof value !== 'object') return null;
  const entries = Object.entries(value as Record<string, unknown>).slice(0, 6);
  return (
    <div className="text-slate-500">
      {entries.map(([k, v]) => (
        <div key={k} className="truncate">
          {k}: {typeof v === 'object' ? JSON.stringify(v) : String(v)}
        </div>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="border-b-2 border-navy pb-1">{title}</h2>
      {children}
    </section>
  );
}

function Sub({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-1 border border-slate-300 md:grid-cols-2 lg:grid-cols-3">{children}</dl>;
}

function KV({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex border-b border-slate-200">
      <dt className="w-44 shrink-0 bg-label px-2 py-1.5 text-xs font-semibold text-navy">{label}</dt>
      <dd className="min-h-8 flex-1 px-2 py-1.5 whitespace-pre-wrap">{value || <span className="text-slate-300">—</span>}</dd>
    </div>
  );
}

function Text({ value }: { value: string | null }) {
  return <p className="min-h-10 rounded border border-slate-300 px-2 py-1.5 whitespace-pre-wrap">{value}</p>;
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <table className="table">
      <thead>
        <tr>
          {head.map((h) => (
            <th key={h}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (
              <td key={j} className="whitespace-pre-wrap">
                {c}
              </td>
            ))}
          </tr>
        ))}
        {rows.length === 0 && <EmptyRow cols={head.length} />}
      </tbody>
    </table>
  );
}

function EmptyRow({ cols }: { cols: number }) {
  return (
    <tr>
      <td colSpan={cols} className="text-slate-400">
        None
      </td>
    </tr>
  );
}
