import type { Rca } from '../../api/types';

// Closing sections are implemented in Phase 4.
export function ClosingTab(_props: { rca: Rca; onDirty: (d: boolean) => void }) {
  return <p className="text-slate-500">Closing sections are added in Phase 4.</p>;
}
