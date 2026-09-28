import type { ActionStatus, RcaStatus, SectionStatus, Severity, Team } from '../api/types';
import { ACTION_STATUS_LABEL, SECTION_STATUS_LABEL, STATUS_LABEL, TEAM_LABEL } from '../lib/labels';

const chip = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap';

// SPEC 6.3: P1 red, P2 orange, P3 yellow, P4 grey.
const SEVERITY_CLASS: Record<Severity, string> = {
  P1: 'bg-red-600 text-white',
  P2: 'bg-orange-500 text-white',
  P3: 'bg-yellow-300 text-yellow-900',
  P4: 'bg-slate-300 text-slate-800',
};

// SPEC 6.3: Draft grey, In review blue, Closed green.
const STATUS_CLASS: Record<RcaStatus, string> = {
  DRAFT: 'bg-slate-200 text-slate-700',
  IN_REVIEW: 'bg-blue-600 text-white',
  CLOSED: 'bg-green-600 text-white',
};

const SECTION_CLASS: Record<SectionStatus, string> = {
  NOT_STARTED: 'bg-slate-100 text-slate-600 ring-1 ring-slate-300',
  IN_PROGRESS: 'bg-amber-100 text-amber-800 ring-1 ring-amber-300',
  SUBMITTED: 'bg-green-100 text-green-800 ring-1 ring-green-300',
};

export function SeverityChip({ value }: { value: Severity }) {
  return (
    <span className={`${chip} ${SEVERITY_CLASS[value]}`} data-testid="severity-chip">
      {value}
    </span>
  );
}

export function StatusChip({ value }: { value: RcaStatus }) {
  return (
    <span className={`${chip} ${STATUS_CLASS[value]}`} data-testid="status-chip">
      {STATUS_LABEL[value]}
    </span>
  );
}

export function SectionBadge({ value }: { value: SectionStatus }) {
  return <span className={`${chip} ${SECTION_CLASS[value]}`}>{SECTION_STATUS_LABEL[value]}</span>;
}

export function ActionStatusChip({ value }: { value: ActionStatus }) {
  return <span className={`${chip} ${SECTION_CLASS[value === 'COMPLETED' ? 'SUBMITTED' : value]}`}>{ACTION_STATUS_LABEL[value]}</span>;
}

/** Dev / QA / Prod progress chips for the RCA list. */
export function ProgressChips({ sections }: { sections: { team: Team; section_status: SectionStatus }[] }) {
  const order: Team[] = ['DEV', 'QA', 'PROD'];
  return (
    <div className="flex gap-1">
      {order.map((team) => {
        const s = sections.find((x) => x.team === team)?.section_status ?? 'NOT_STARTED';
        return (
          <span key={team} className={`${chip} ${SECTION_CLASS[s]}`} title={`${TEAM_LABEL[team]}: ${SECTION_STATUS_LABEL[s]}`}>
            {team === 'PROD' ? 'Prod' : TEAM_LABEL[team]}
          </span>
        );
      })}
    </div>
  );
}
