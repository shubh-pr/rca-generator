import type { Rca, Team } from '../../api/types';

// Team section editing is implemented in Phase 3.
export function SectionTab(_props: { rca: Rca; team: Team; onDirty: (d: boolean) => void }) {
  return <p className="text-slate-500">Team sections are added in Phase 3.</p>;
}
