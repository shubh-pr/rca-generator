import { useEffect, useState } from 'react';
import { useBlocker, useParams, useSearchParams } from 'react-router';
import { SectionBadge } from '../../components/Chips';
import { ErrorBanner } from '../../components/Form';
import { BlamelessNote } from '../../components/Layout';
import { TABS, tabStatus, type TabKey } from '../../lib/rcaStatus';
import { ClosingTab } from './ClosingTab';
import { CommonTab } from './CommonTab';
import { HeaderTab } from './HeaderTab';
import { useRca } from './rcaApi';
import { RcaTitleBar } from './RcaTitleBar';
import { SectionTab } from './SectionTab';

const UNSAVED = 'You have unsaved changes. Leave without saving?';

export function RcaEditPage() {
  const { id = '' } = useParams();
  const rca = useRca(id);
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.key === params.get('tab'))?.key ?? 'header') as TabKey;
  const [dirty, setDirty] = useState(false);

  // Unsaved-changes warning on route changes and on page unload.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (confirm(UNSAVED)) blocker.proceed();
    else blocker.reset();
  }, [blocker]);
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty]);

  const switchTab = (key: TabKey) => {
    if (key === tab) return;
    if (dirty && !confirm(UNSAVED)) return;
    setDirty(false);
    setParams({ tab: key }, { replace: true });
  };

  if (rca.isLoading) return <div className="text-slate-500">Loading…</div>;
  if (rca.error || !rca.data) return <ErrorBanner error={rca.error ?? 'RCA not found'} />;
  const r = rca.data;

  return (
    <div>
      <BlamelessNote />
      <RcaTitleBar rca={r} mode="edit" />
      <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-300" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => switchTab(t.key)}
            className={`-mb-px flex items-center gap-2 rounded-t border px-3 py-2 text-sm ${
              tab === t.key ? 'border-slate-300 border-b-white bg-white font-semibold text-navy' : 'border-transparent text-slate-600 hover:text-navy'
            }`}
          >
            {t.label}
            <SectionBadge value={tabStatus(r, t.key)} />
          </button>
        ))}
      </div>
      <div className="card">
        {tab === 'header' && <HeaderTab rca={r} onDirty={setDirty} />}
        {tab === 'common' && <CommonTab rca={r} onDirty={setDirty} />}
        {(tab === 'DEV' || tab === 'QA' || tab === 'PROD') && <SectionTab key={tab} rca={r} team={tab} onDirty={setDirty} />}
        {tab === 'closing' && <ClosingTab rca={r} onDirty={setDirty} />}
      </div>
    </div>
  );
}
