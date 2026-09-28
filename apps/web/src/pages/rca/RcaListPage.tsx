import { Link, useNavigate, useSearchParams } from 'react-router';
import { ErrorBanner, Pagination, Select, TextInput } from '../../components/Form';
import { ProgressChips, SeverityChip, StatusChip } from '../../components/Chips';
import { useAuth } from '../../lib/auth';
import { useWorkspace } from '../../lib/workspace';
import { formatDate } from '../../lib/dates';
import { ENV_LABEL, ENVIRONMENTS, RCA_STATUSES, SEVERITIES, STATUS_LABEL, TEAM_LABEL, TEAMS } from '../../lib/labels';
import { creatableWorkspaces } from '../../lib/permissions';
import { ListExportButtons } from './ListExportButtons';
import { useRcaList } from './rcaApi';

const FILTER_KEYS = ['status', 'project', 'severity', 'environment', 'team', 'date_from', 'date_to', 'q', 'open', 'overdue', 'closed_from', 'closed_to'];

export function RcaListPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { filter: wsFilter, current } = useWorkspace();
  const page = Number(params.get('page') ?? 1);
  const filters: Record<string, string> = {};
  for (const k of FILTER_KEYS) {
    const v = params.get(k);
    if (v) filters[k] = v;
  }
  const list = useRcaList({ ...wsFilter, ...filters, page, page_size: 20, sort: params.get('sort') ?? '-rca_date' });
  const hasAnyFilter = Object.keys(filters).length > 0;

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('page');
    setParams(next, { replace: true });
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1>RCA list</h1>
        <div className="flex gap-2">
          <ListExportButtons filters={{ ...wsFilter, ...filters }} />
          {creatableWorkspaces(user).length > 0 && (
            <button type="button" className="btn-primary" onClick={() => navigate('/rcas/new')}>
              + New RCA
            </button>
          )}
        </div>
      </div>
      <div className="card mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-8" aria-label="Filters">
        <TextInput
          className="col-span-2"
          placeholder="Search RCA no, ticket, summary"
          value={params.get('q') ?? ''}
          onChange={(e) => setFilter('q', e.target.value)}
          aria-label="Search"
        />
        <Select
          aria-label="Status"
          placeholder="All statuses"
          value={params.get('status') ?? ''}
          onChange={(e) => setFilter('status', e.target.value)}
          options={RCA_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
        />
        <TextInput aria-label="Project" placeholder="Project" value={params.get('project') ?? ''} onChange={(e) => setFilter('project', e.target.value)} />
        <Select
          aria-label="Severity"
          placeholder="All severities"
          value={params.get('severity') ?? ''}
          onChange={(e) => setFilter('severity', e.target.value)}
          options={SEVERITIES.map((s) => ({ value: s, label: s }))}
        />
        <Select
          aria-label="Environment"
          placeholder="All environments"
          value={params.get('environment') ?? ''}
          onChange={(e) => setFilter('environment', e.target.value)}
          options={ENVIRONMENTS.map((s) => ({ value: s, label: ENV_LABEL[s] }))}
        />
        <Select
          aria-label="Team pending"
          placeholder="Any team"
          value={params.get('team') ?? ''}
          onChange={(e) => setFilter('team', e.target.value)}
          options={TEAMS.map((t) => ({ value: t, label: `${TEAM_LABEL[t]} pending` }))}
        />
        <div className="col-span-2 flex items-center gap-1 md:col-span-1 lg:col-span-1">
          <TextInput type="date" aria-label="Date from" value={params.get('date_from') ?? ''} onChange={(e) => setFilter('date_from', e.target.value)} />
        </div>
        <div className="col-span-2 flex items-center gap-1 md:col-span-1 lg:col-span-1">
          <TextInput type="date" aria-label="Date to" value={params.get('date_to') ?? ''} onChange={(e) => setFilter('date_to', e.target.value)} />
        </div>
        {(params.get('open') || params.get('overdue') || params.get('closed_from')) && (
          <div className="col-span-full flex items-center gap-2 text-xs text-slate-600">
            Dashboard filter active:
            {params.get('open') && <span className="rounded bg-label px-2 py-0.5">Open</span>}
            {params.get('overdue') && <span className="rounded bg-label px-2 py-0.5">Has overdue actions</span>}
            {params.get('closed_from') && (
              <span className="rounded bg-label px-2 py-0.5">
                Closed {params.get('closed_from')} – {params.get('closed_to') ?? 'today'}
              </span>
            )}
            <button type="button" className="btn-ghost" onClick={() => setParams({}, { replace: true })}>
              Clear all
            </button>
          </div>
        )}
      </div>
      <div className="card overflow-x-auto">
        <ErrorBanner error={list.error} />
        <table className="table" data-testid="rca-table">
          <thead>
            <tr>
              <th>RCA no</th>
              <th>Date</th>
              <th>Project</th>
              <th>Severity</th>
              <th>Status</th>
              <th>Team leader</th>
              <th>Progress</th>
            </tr>
          </thead>
          <tbody>
            {list.data?.data.map((r) => (
              <tr
                key={r.id}
                className={`cursor-pointer hover:bg-label/50 ${r.has_overdue ? 'bg-red-50 text-red-900' : ''}`}
                onClick={() => navigate(`/rcas/${r.id}`)}
                data-overdue={r.has_overdue || undefined}
              >
                <td className="font-semibold whitespace-nowrap">
                  <Link to={`/rcas/${r.id}`} onClick={(e) => e.stopPropagation()} className="text-navy underline">
                    {r.rca_number}
                  </Link>
                  {r.has_overdue && <span className="ml-1 text-xs text-red-700">overdue</span>}
                </td>
                <td className="whitespace-nowrap">{formatDate(r.rca_date)}</td>
                <td>
                  <div>
                    {r.project_name ?? <span className="text-slate-400">No project</span>}
                    {!current && <span className="ml-1 text-xs text-slate-500">· {r.workspace.name}</span>}
                    {r.is_sample && <span className="ml-1 rounded bg-amber-100 px-1 text-xs font-semibold text-amber-800">Sample</span>}
                  </div>
                  <div className="max-w-md truncate text-xs text-slate-500">{r.summary}</div>
                </td>
                <td>
                  <SeverityChip value={r.severity} />
                </td>
                <td>
                  <StatusChip value={r.status} />
                </td>
                <td>{r.team_leader_name}</td>
                <td>
                  <ProgressChips sections={r.sections} />
                </td>
              </tr>
            ))}
            {list.data?.data.length === 0 && (
              <tr>
                <td colSpan={7} className="py-6 text-center text-slate-500">
                  {hasAnyFilter ? 'No RCAs match these filters.' : 'No RCAs yet. Create your first RCA to get started.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {list.data && (
          <Pagination
            page={page}
            pageSize={20}
            total={list.data.total}
            onPage={(p) => {
              const next = new URLSearchParams(params);
              next.set('page', String(p));
              setParams(next);
            }}
          />
        )}
      </div>
    </div>
  );
}
