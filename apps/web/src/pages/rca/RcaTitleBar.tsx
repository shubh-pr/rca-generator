import { Link } from 'react-router';
import type { Rca } from '../../api/types';
import { SeverityChip, StatusChip } from '../../components/Chips';

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
          {rca.project.company.name} · {rca.project.name} · Project Owner: {rca.project.owner.name}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {mode === 'edit' ? (
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
