import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../api/client';
import type { ActionStatus, SectionStatus, Severity, Team } from '../api/types';
import { ActionStatusChip, SectionBadge, SeverityChip } from '../components/Chips';
import { ErrorBanner } from '../components/Form';
import { formatDate } from '../lib/dates';
import { TEAM_LABEL } from '../lib/labels';

interface RcaRef {
  id: string;
  rca_number: string;
  severity: Severity;
  summary?: string;
  project: { name: string };
}

interface Tasks {
  sections: { id: string; team: Team; section_status: SectionStatus; due_date: string | null; rca: RcaRef & { rca_date: string } }[];
  actions: {
    id: string;
    action: string;
    due_date: string;
    status: ActionStatus;
    is_overdue: boolean;
    section: { team: Team; rca: RcaRef };
  }[];
}

/** Sections waiting for me and actions I own, sorted by due date. */
export function MyTasksPage() {
  const q = useQuery({ queryKey: ['my-tasks'], queryFn: () => api.get<Tasks>('/my-tasks') });
  return (
    <div className="space-y-6">
      <h1>My tasks</h1>
      <ErrorBanner error={q.error} />
      <div className="card overflow-x-auto">
        <h2 className="mb-2">Sections waiting for me</h2>
        <table className="table" data-testid="my-sections">
          <thead>
            <tr>
              <th>RCA</th>
              <th>Project</th>
              <th>Severity</th>
              <th>Section</th>
              <th>Status</th>
              <th>Target date</th>
            </tr>
          </thead>
          <tbody>
            {q.data?.sections.map((s) => (
              <tr key={s.id}>
                <td>
                  <Link to={`/rcas/${s.rca.id}/edit?tab=${s.team}`} className="font-semibold text-navy underline">
                    {s.rca.rca_number}
                  </Link>
                  <div className="max-w-md truncate text-xs text-slate-500">{s.rca.summary}</div>
                </td>
                <td>{s.rca.project.name}</td>
                <td>
                  <SeverityChip value={s.rca.severity} />
                </td>
                <td>{TEAM_LABEL[s.team]}</td>
                <td>
                  <SectionBadge value={s.section_status} />
                </td>
                <td>{formatDate(s.due_date) || <span className="text-slate-400">RCA date {formatDate(s.rca.rca_date)}</span>}</td>
              </tr>
            ))}
            {q.data?.sections.length === 0 && (
              <tr>
                <td colSpan={6} className="text-slate-500">
                  Nothing waiting for you.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="card overflow-x-auto">
        <h2 className="mb-2">Actions I own</h2>
        <table className="table" data-testid="my-actions">
          <thead>
            <tr>
              <th>Due date</th>
              <th>Action</th>
              <th>RCA</th>
              <th>Team</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {q.data?.actions.map((a) => (
              <tr key={a.id} className={a.is_overdue ? 'bg-red-50 text-red-800' : ''} data-overdue={a.is_overdue || undefined}>
                <td className="whitespace-nowrap">
                  {formatDate(a.due_date)}
                  {a.is_overdue && <div className="text-xs font-semibold">Overdue</div>}
                </td>
                <td>{a.action}</td>
                <td>
                  <Link to={`/rcas/${a.section.rca.id}/edit?tab=${a.section.team}`} className="text-navy underline">
                    {a.section.rca.rca_number}
                  </Link>
                </td>
                <td>{TEAM_LABEL[a.section.team]}</td>
                <td>
                  <ActionStatusChip value={a.status} />
                </td>
              </tr>
            ))}
            {q.data?.actions.length === 0 && (
              <tr>
                <td colSpan={5} className="text-slate-500">
                  No open actions.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
