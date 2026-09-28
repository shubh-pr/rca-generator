import { useState } from 'react';
import { Link } from 'react-router';
import { download } from '../../api/client';
import type { Rca } from '../../api/types';

/** Print, PDF and Word buttons (SPEC 6.1 RCA view). */
export function ExportButtons({ rca }: { rca: Rca }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const get = async (format: 'pdf' | 'docx') => {
    setBusy(format);
    setError(null);
    try {
      await download(`/rcas/${rca.id}/export`, `${rca.rca_number}.${format}`, { format });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <Link to={`/rcas/${rca.id}/print`} className="btn-secondary">
        Print
      </Link>
      <button type="button" className="btn-secondary" disabled={!!busy} onClick={() => get('pdf')}>
        {busy === 'pdf' ? 'Preparing PDF…' : 'PDF'}
      </button>
      <button type="button" className="btn-secondary" disabled={!!busy} onClick={() => get('docx')}>
        {busy === 'docx' ? 'Preparing…' : 'Word'}
      </button>
      {error && <span className="basis-full text-right text-xs text-red-700">{error}</span>}
    </>
  );
}
