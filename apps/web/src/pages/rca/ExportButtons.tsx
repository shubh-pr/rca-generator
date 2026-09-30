import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ApiError, download } from '../../api/client';
import type { Rca } from '../../api/types';
import { useUnlockCheckout } from '../../components/BillingBits';

/**
 * Print, PDF and Word buttons (SPEC 6.1 RCA view). Word is only for paid RCAs and subscribed
 * workspaces: a .docx is editable, so its watermark could simply be deleted (docs/BILLING_PLAN.md).
 * Otherwise the Word button becomes "Unlock to get Word" (the same unlock checkout as the watermark bar).
 */
export function ExportButtons({ rca }: { rca: Rca }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wordLocked, setWordLocked] = useState(false);
  const navigate = useNavigate();
  const unlock = useUnlockCheckout(rca.id);
  const wordAllowed = rca.billing.word_export && !wordLocked;
  const get = async (format: 'pdf' | 'docx') => {
    setBusy(format);
    setError(null);
    try {
      await download(`/rcas/${rca.id}/export`, `${rca.rca_number}.${format}`, { format });
    } catch (e) {
      // The server is the gate: if it refuses (e.g. the subscription just lapsed), show the prompt.
      if (e instanceof ApiError && e.code === 'PAYMENT_REQUIRED') setWordLocked(true);
      else setError(e instanceof Error ? e.message : 'Download failed');
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
      {wordAllowed ? (
        <button type="button" className="btn-secondary" disabled={!!busy} onClick={() => get('docx')}>
          {busy === 'docx' ? 'Preparing…' : 'Word'}
        </button>
      ) : (
        <button
          type="button"
          className="btn-secondary border-dashed"
          data-testid="word-locked"
          title="Word files can be edited, so they are available for unlocked RCAs and with a Solo or Team subscription."
          disabled={unlock.isPending}
          // Owners and editors can buy the unlock right here; everyone else sees the plans.
          onClick={() => (rca.permissions.edit ? unlock.mutate() : navigate('/pricing'))}
        >
          <span aria-hidden="true">🔒</span> Unlock to get Word
        </button>
      )}
      {unlock.error && <span className="basis-full text-right text-xs text-red-700">{unlock.error.message}</span>}
      {error && <span className="basis-full text-right text-xs text-red-700">{error}</span>}
    </>
  );
}
