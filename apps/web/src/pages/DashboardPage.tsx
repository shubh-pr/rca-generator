import { useQuery } from '@tanstack/react-query';
import { BucketIndicator, bucketWorkspaceId } from '../components/BillingBits';
import { Link } from 'react-router';
import { api, buildQuery } from '../api/client';
import type { CauseCategory, Severity, Team } from '../api/types';
import { BarList } from '../components/BarList';
import { ErrorBanner } from '../components/Form';
import { creatableWorkspaces } from '../lib/permissions';
import { useAuth } from '../lib/auth';
import { useWorkspace } from '../lib/workspace';
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
  const { user } = useAuth();
  const { current, shared, filter } = useWorkspace();
  const q = useQuery({
    queryKey: ['dashboard', filter.workspace_id ?? (filter.shared ? 'shared' : 'all')],
    queryFn: () => api.get<Summary>('/dashboard/summary', filter),
  });
  const d = q.data;
  const empty = d && d.kpis.open_rcas.count === 0 && d.charts.by_severity.every((x) => x.count === 0);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1>Dashboard</h1>
        <BucketIndicator workspaceId={bucketWorkspaceId(user, current)} />
        <span className="text-sm text-slate-600">{shared ? 'Shared with me' : current ? current.name : 'All workspaces'}</span>
      </div>
      <ErrorBanner error={q.error} />
      {empty && (
        <div className="card mb-6 space-y-2" data-testid="dashboard-empty">
          <h2>No RCAs yet</h2>
          <p className="text-slate-600">
            Your numbers appear here once you record an incident. Each RCA walks you through the header, impact, the 5 Whys for
            Dev, QA and Production, actions, sign-off and closing.
          </p>
          {creatableWorkspaces(user).length > 0 && (
            <Link to="/rcas/new" className="btn-primary">
              Create an RCA
            </Link>
          )}
        </div>
      )}
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
