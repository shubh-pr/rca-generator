/**
 * "Jump to the problem": maps the server's validation messages to the tab and element they are about,
 * and scrolls to, focuses and briefly highlights that element.
 *
 * The patterns mirror the messages built in apps/api/src/services/workflowRules.ts (reviewProblems,
 * closeProblems). A message that matches nothing is shown as plain text, never as a broken link.
 */
import type { TabKey } from './rcaStatus';

export interface JumpTarget {
  tab: TabKey;
  /** Element ids to try in order; the first one on the page wins (e.g. the submit button, else the heading). */
  ids: string[];
}

/** REQUIRED_FOR_REVIEW labels (workflowRules.ts) → where the field lives. */
const REVIEW_FIELDS: Record<string, JumpTarget> = {
  'Problem statement': { tab: 'common', ids: ['summary'] },
  'Detected at': { tab: 'header', ids: ['detected_at'] },
  'Resolved at': { tab: 'header', ids: ['resolved_at'] },
  'Users / clients affected': { tab: 'common', ids: ['impact_users'] },
  'Detection method': { tab: 'common', ids: ['detection_method'] },
  'Immediate fix': { tab: 'common', ids: ['immediate_fix'] },
};

const TEAM = '(DEV|QA|PROD)';

export function problemTarget(problem: string): JumpTarget | null {
  const field = /^(.+) is missing$/.exec(problem);
  if (field && REVIEW_FIELDS[field[1]]) return REVIEW_FIELDS[field[1]];
  let m = new RegExp(`^${TEAM} section is not submitted$`).exec(problem);
  if (m) return { tab: m[1] as TabKey, ids: [`${m[1]}-submit`, `${m[1]}-heading`] };
  m = new RegExp(`^${TEAM} section has no action$`).exec(problem);
  if (m) return { tab: m[1] as TabKey, ids: [`${m[1]}-actions`] };
  m = new RegExp(`^${TEAM} section has no root cause \\(Why 5\\)$`).exec(problem);
  if (m) return { tab: m[1] as TabKey, ids: [`${m[1]}-why-5`] };
  if (/^Sign-off pending: /.test(problem)) return { tab: 'closing', ids: ['signoffs'] };
  // "2 actions still open (DEV #1, QA #2); …": the first team named.
  m = new RegExp(`still open \\(${TEAM} #`).exec(problem);
  if (m) return { tab: m[1] as TabKey, ids: [`${m[1]}-actions`] };
  return null;
}

/** Field keys of "Section is not complete" (apps/api/src/routes/rca/sections.ts, submitProblems) → element ids on the section tab. */
export function sectionFieldTarget(team: string, key: string): JumpTarget | null {
  const id =
    key === 'cause_category' ? `${team}-cause`
    : key === 'escape_analysis' ? `${team}-escape`
    : key === 'actions' ? `${team}-actions`
    : /^whys\.[1-5]$/.test(key) ? `${team}-why-${key.slice(5)}`
    : null;
  return id ? { tab: team as TabKey, ids: [id] } : null;
}

export const HIGHLIGHT_CLASS = 'jump-highlight';
const HIGHLIGHT_MS = 2500;

/** Scroll to, focus and flash the first element of `ids` that exists. Returns false if none is on the page yet. */
export function focusJumpTarget(ids: string[]): boolean {
  const el = ids.map((id) => document.getElementById(id)).find((e): e is HTMLElement => !!e);
  if (!el) return false;
  el.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  el.focus({ preventScroll: true });
  el.classList.remove(HIGHLIGHT_CLASS);
  // Restart the flash if the same element is jumped to twice in a row.
  void el.offsetWidth;
  el.classList.add(HIGHLIGHT_CLASS);
  window.setTimeout(() => el.classList.remove(HIGHLIGHT_CLASS), HIGHLIGHT_MS);
  return true;
}

/** Wait (up to ~3 s) for the tab to render the element, then jump to it. */
export function focusWhenReady(ids: string[], onDone?: () => void) {
  const started = performance.now();
  const tick = () => {
    if (focusJumpTarget(ids) || performance.now() - started > 3000) return onDone?.();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
