import type { Rca, SectionStatus, Team } from '../api/types';

export type TabKey = 'header' | 'common' | Team | 'closing';

export const TABS: { key: TabKey; label: string }[] = [
  { key: 'header', label: '1 Header' },
  { key: 'common', label: '2 Common' },
  { key: 'DEV', label: '3 Dev' },
  { key: 'QA', label: '4 QA' },
  { key: 'PROD', label: '5 Production' },
  { key: 'closing', label: '6 Closing' },
];

/**
 * Badge per tab. Team tabs use the section status. Header/Common/Closing have no status of their
 * own, so: Submitted once the RCA left DRAFT (Closing: once CLOSED), In progress when anything is
 * filled, otherwise Not started. See docs/ASSUMPTIONS.md.
 */
export function tabStatus(rca: Rca, tab: TabKey): SectionStatus {
  if (tab === 'DEV' || tab === 'QA' || tab === 'PROD') {
    return rca.sections.find((s) => s.team === tab)?.section_status ?? 'NOT_STARTED';
  }
  if (tab === 'closing') {
    if (rca.status === 'CLOSED') return 'SUBMITTED';
    const started =
      !!(rca.lessons_well || rca.lessons_not_well || rca.lessons_key) ||
      rca.followups.length > 0 ||
      rca.attachments.length > 0 ||
      rca.signoffs.some((s) => s.signed_at);
    return started ? 'IN_PROGRESS' : 'NOT_STARTED';
  }
  if (rca.status !== 'DRAFT') return 'SUBMITTED';
  if (tab === 'header') return 'IN_PROGRESS';
  const commonFilled =
    rca.impact_users || rca.impact_duration || rca.impact_data_revenue || rca.detection_method || rca.immediate_fix || rca.timeline.length;
  return commonFilled ? 'IN_PROGRESS' : 'NOT_STARTED';
}
