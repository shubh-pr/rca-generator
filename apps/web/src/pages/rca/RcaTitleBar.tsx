import { Link } from 'react-router';
import type { Rca } from '../../api/types';
import { CheckoutNotice, RcaBillingBar } from '../../components/BillingBits';
import { TEAM_LABEL } from '../../lib/labels';
import { SeverityChip, StatusChip } from '../../components/Chips';
import { ExportButtons } from './ExportButtons';
import { ShareButton } from './SharePanel';
import { WorkflowButtons } from './WorkflowButtons';

export function RcaTitleBar({ rca, mode }: { rca: Rca; mode: 'edit' | 'view' }) {
  return (
    <>
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
      <ContributorNotice rca={rca} />
      <CheckoutNotice />
      {!rca.permissions.support && <RcaBillingBar rca={rca} />}
    </>
  );
}

/**
 * A contributor whose only editable section is submitted (or whose RCA is no longer a draft) sees why
 * nothing is editable, and what to do, as soon as the RCA opens.
 */
function ContributorNotice({ rca }: { rca: Rca }) {
  const p = rca.permissions;
  if (p.role !== 'CONTRIBUTOR' || p.support) return null;
  const mine = rca.sections.filter((s) => p.edit_section[s.team]);
  if (!mine.length) return null;
  const names = mine.map((s) => TEAM_LABEL[s.team]).join(' and ');
  let text: string | null = null;
  if (rca.status !== 'DRAFT') text = `This RCA is ${rca.status === 'CLOSED' ? 'closed' : 'in review'}, so your ${names} section cannot be changed right now. Ask an owner or editor if something needs to change.`;
  else if (mine.every((s) => s.section_status === 'SUBMITTED'))
    text = `Your ${names} section ${mine.length > 1 ? 'were' : 'was'} submitted and ${mine.length > 1 ? 'are' : 'is'} locked, so there is nothing for you to edit right now. Ask an owner or editor to unlock it.`;
  if (!text) return null;
  return (
    <div className="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status" data-testid="nothing-to-edit">
      {text}
    </div>
  );
}

