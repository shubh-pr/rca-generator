import { Link } from 'react-router';
import type { Rca } from '../../api/types';
import { SeverityChip, StatusChip } from '../../components/Chips';
import { ExportButtons } from './ExportButtons';
import { ShareButton } from './SharePanel';
import { WorkflowButtons } from './WorkflowButtons';

export function RcaTitleBar({ rca, mode }: { rca: Rca; mode: 'edit' | 'view' }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex items-center gap-2">
          <h1 data-testid="rca-number">{rca.rca_number}</h1>
          <SeverityChip value={rca.severity} />
          <StatusChip value={rca.status} />
          <span className="text-xs text-slate-500">v{rca.version}</span>
        </div>
        <p className="mt-1 max-w-3xl text-slate-600">{rca.summary}</p>
        <p className="text-xs text-slate-500">
          {[rca.workspace.name, rca.company_name, rca.project_name, rca.project_owner_name && `Project Owner: ${rca.project_owner_name}`]
            .filter(Boolean)
            .join(' · ')}
          {rca.is_sample && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800">Sample RCA</span>}
          {rca.permissions.support && <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 font-semibold text-red-800">Support access (read-only)</span>}
        </p>
      </div>
      <div className="flex max-w-xl flex-wrap justify-end gap-2">
        <WorkflowButtons rca={rca} />
        <ExportButtons rca={rca} />
        {!rca.permissions.support && <ShareButton rca={rca} />}
        {mode === 'edit' || rca.permissions.support ? (
          <Link to={`/rcas/${rca.id}`} className="btn-secondary">
            Read-only view
          </Link>
        ) : (
          <Link to={`/rcas/${rca.id}/edit`} className="btn-secondary">
            Open form
          </Link>
        )}
      </div>
    </div>
  );
}
