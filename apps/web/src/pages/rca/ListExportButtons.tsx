import { useState } from 'react';
import { download } from '../../api/client';

/** Export the filtered list (CSV / Excel, per RCA or per action) and the blank template. */
export function ListExportButtons({ filters }: { filters: Record<string, string> }) {
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<'rca' | 'actions'>('rca');
  const run = (fn: () => Promise<void>) => {
    setError(null);
    fn().catch((e) => setError(e instanceof Error ? e.message : 'Download failed'));
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select className="input w-auto" aria-label="Export rows" value={rows} onChange={(e) => setRows(e.target.value as 'rca' | 'actions')}>
        <option value="rca">One row per RCA</option>
        <option value="actions">One row per action</option>
      </select>
      <button type="button" className="btn-secondary" onClick={() => run(() => download('/rcas/export', 'rca-list.csv', { ...filters, format: 'csv', rows }))}>
        Export CSV
      </button>
      <button type="button" className="btn-secondary" onClick={() => run(() => download('/rcas/export', 'rca-list.xlsx', { ...filters, format: 'xlsx', rows }))}>
        Export Excel
      </button>
      <button type="button" className="btn-ghost" onClick={() => run(() => download('/templates/rca-blank.docx', 'RCA_Template.docx'))}>
        Blank template
      </button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  );
}
