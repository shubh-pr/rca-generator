import { useEffect, useState } from 'react';
import { focusWhenReady, type JumpTarget } from '../../lib/fieldJump';
import { RcaJumpContext } from './rcaJump';
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

  /** From a validation summary: same tab switch (and unsaved-changes check), then scroll to and focus the field. */
  const jump = (t: JumpTarget) => {
    if (t.tab !== tab) {
      if (dirty && !confirm(UNSAVED)) return;
      setDirty(false);
    }
    setParams({ tab: t.tab, focus: t.ids.join(',') }, { replace: true });
  };

  // ?focus=id1,id2 (from a jump, or a link from the read-only view): jump once the tab has rendered, then drop it.
  const focus = params.get('focus');
  const loaded = !!rca.data;
  useEffect(() => {
    if (!focus || !loaded) return;
    focusWhenReady(focus.split(','), () =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('focus');
          return next;
        },
        { replace: true },
      ),
    );
  }, [focus, loaded, setParams]);

  if (rca.isLoading) return <div className="text-slate-500">Loading…</div>;
  if (rca.error || !rca.data) return <ErrorBanner error={rca.error ?? 'RCA not found'} />;
  const r = rca.data;

  return (
    <RcaJumpContext.Provider value={jump}>
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
              {tab === t.key && dirty && (
                <span className="h-2 w-2 rounded-full bg-amber-500" title="Unsaved changes" data-testid="tab-unsaved">
                  <span className="sr-only">(unsaved changes)</span>
                </span>
              )}
              <SectionBadge value={tabStatus(r, t.key)} />
            </button>
          ))}
        </div>
        <p className="mb-2 text-xs text-slate-500" data-testid="required-legend">
          <span className="font-semibold text-red-600">*</span> Required before “Submit for review”
        </p>
        <div className="card">
          {tab === 'header' && <HeaderTab rca={r} onDirty={setDirty} />}
          {tab === 'common' && <CommonTab rca={r} onDirty={setDirty} />}
          {(tab === 'DEV' || tab === 'QA' || tab === 'PROD') && <SectionTab key={tab} rca={r} team={tab} onDirty={setDirty} />}
          {tab === 'closing' && <ClosingTab rca={r} onDirty={setDirty} />}
        </div>
      </div>
    </RcaJumpContext.Provider>
  );
}
