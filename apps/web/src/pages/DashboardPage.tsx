import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { api, buildQuery } from '../api/client';
import { useProjects } from '../api/hooks';
import type { CauseCategory, Severity, Team } from '../api/types';
import { BarList } from '../components/BarList';
import { ErrorBanner, Select } from '../components/Form';
import { CAUSE_LABEL, TEAM_LABEL } from '../lib/labels';

interface Counted {
  count: number;
  filter: Record<string, string>;
}

interface Summary {
  kpis: {
    open_rcas: Counted;
    in_review: Counted;
    closed_this_month: Counted;
    overdue_actions: Counted & { rcas: number };
    avg_time_to_resolve_hours: { value: number | null; sample: number };
  };
  charts: {
    by_severity: (Counted & { key: Severity })[];
    by_cause_category: { key: CauseCategory; count: number }[];
    by_project: (Counted & { key: string; label: string })[];
    sections_pending_by_team: (Counted & { key: Team })[];
  };
}

const listHref = (f: Record<string, string>) => `/rcas${buildQuery(f)}`;

export function DashboardPage() {
  const [params, setParams] = useSearchParams();
  const projectId = params.get('project_id') ?? '';
  const projects = useProjects();
  const q = useQuery({
    queryKey: ['dashboard', projectId],
    queryFn: () => api.get<Summary>('/dashboard/summary', { project_id: projectId || undefined }),
  });
  const d = q.data;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1>Dashboard</h1>
        <Select
          className="w-64"
          aria-label="Project filter"
          placeholder="All projects"
          value={projectId}
          onChange={(e) => setParams(e.target.value ? { project_id: e.target.value } : {}, { replace: true })}
          options={(projects.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
        />
      </div>
      <ErrorBanner error={q.error} />
      {d && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <Kpi label="Open RCAs" value={d.kpis.open_rcas.count} href={listHref(d.kpis.open_rcas.filter)} />
            <Kpi label="In review" value={d.kpis.in_review.count} href={listHref(d.kpis.in_review.filter)} />
            <Kpi label="Closed this month" value={d.kpis.closed_this_month.count} href={listHref(d.kpis.closed_this_month.filter)} />
            <Kpi
              label="Overdue actions"
              value={d.kpis.overdue_actions.count}
              sub={`in ${d.kpis.overdue_actions.rcas} RCA${d.kpis.overdue_actions.rcas === 1 ? '' : 's'}`}
              href={listHref(d.kpis.overdue_actions.filter)}
              alert={d.kpis.overdue_actions.count > 0}
            />
            <Kpi
              label="Average time to resolve"
              value={d.kpis.avg_time_to_resolve_hours.value === null ? '—' : `${d.kpis.avg_time_to_resolve_hours.value} h`}
              sub={`${d.kpis.avg_time_to_resolve_hours.sample} resolved RCA${d.kpis.avg_time_to_resolve_hours.sample === 1 ? '' : 's'}`}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <BarList
              title="RCAs by severity"
              unit="RCAs"
              items={d.charts.by_severity.map((x) => ({ key: x.key, label: x.key, count: x.count, href: listHref(x.filter) }))}
            />
            <BarList
              title="Root causes by category"
              unit="team sections"
              empty="No cause categories recorded yet"
              items={d.charts.by_cause_category.map((x) => ({ key: x.key, label: CAUSE_LABEL[x.key], count: x.count }))}
            />
            <BarList
              title="RCAs by project"
              unit="RCAs"
              items={d.charts.by_project.map((x) => ({ key: x.key, label: x.label, count: x.count, href: listHref(x.filter) }))}
            />
            <BarList
              title="Sections pending by team"
              unit="RCAs with the section not submitted"
              items={d.charts.sections_pending_by_team.map((x) => ({ key: x.key, label: TEAM_LABEL[x.key], count: x.count, href: listHref(x.filter) }))}
            />
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, href, alert }: { label: string; value: number | string; sub?: string; href?: string; alert?: boolean }) {
  const body = (
    <div className={`card h-full transition ${href ? 'hover:border-navy hover:shadow' : ''}`} data-testid={`kpi-${label}`}>
      <div className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{label}</div>
      <div className={`mt-1 text-3xl font-bold tabular-nums ${alert ? 'text-red-700' : 'text-navy'}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  );
  return href ? <Link to={href}>{body}</Link> : body;
}
