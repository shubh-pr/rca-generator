import type { FieldErrors } from '../lib/errors.js';
import type { FullRca } from './rcaQueries.js';

const TEAM_SIGNOFFS = ['DEV_LEAD', 'QA_LEAD', 'PROD_LEAD'] as const;

/** Header/common fields that must be filled before review (SPEC 3.1 "header and common sections complete"). */
const REQUIRED_FOR_REVIEW = {
  summary: 'Problem statement',
  detected_at: 'Detected at',
  resolved_at: 'Resolved at',
  impact_users: 'Users / clients affected',
  detection_method: 'Detection method',
  immediate_fix: 'Immediate fix',
} as const;

/** SPEC 3.1 DRAFT -> IN_REVIEW. Returns human-readable problems plus field keys. */
export function reviewProblems(rca: FullRca) {
  const problems: string[] = [];
  const fields: FieldErrors = {};
  for (const [key, label] of Object.entries(REQUIRED_FOR_REVIEW)) {
    const value = rca[key as keyof typeof REQUIRED_FOR_REVIEW];
    if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) {
      fields[key] = `${label} is required before review`;
      problems.push(`${label} is missing`);
    }
  }
  for (const s of rca.sections) {
    if (s.section_status !== 'SUBMITTED') {
      fields[`sections.${s.team}`] = 'Section must be SUBMITTED';
      problems.push(`${s.team} section is not submitted`);
    }
    if (s.actions.length === 0) problems.push(`${s.team} section has no action`);
    if (!s.whys.find((w) => w.why_no === 5)?.answer?.trim()) problems.push(`${s.team} section has no root cause (Why 5)`);
  }
  return { problems, fields };
}

/** SPEC 3.1 IN_REVIEW -> CLOSED. */
export function closeProblems(rca: FullRca) {
  const problems: string[] = [];
  const unsigned = rca.signoffs.filter((s) => !s.signed_at).map((s) => s.role);
  if (unsigned.length) problems.push(`Sign-off pending: ${unsigned.join(', ')}`);
  const open = rca.sections.flatMap((s) =>
    s.actions
      .filter((a) => a.status !== 'COMPLETED')
      .filter((a) => {
        const f = rca.followups.find((x) => x.action_id === a.id);
        return !(f && f.owner_id && f.due_date);
      })
      .map((a) => `${s.team} #${a.seq ?? '?'}`),
  );
  if (open.length) {
    problems.push(`${open.length} action${open.length === 1 ? '' : 's'} still open (${open.join(', ')}); complete them or move them to follow-ups with an owner and date`);
  }
  return { problems, unsigned, open_actions: open.length };
}

/** The Project Owner and RCA Team Leader sign after the three team leads ("Then …", SPEC 3.1). */
export function pendingTeamSignoffs(rca: Pick<FullRca, 'signoffs'>) {
  return rca.signoffs.filter((s) => (TEAM_SIGNOFFS as readonly string[]).includes(s.role) && !s.signed_at).map((s) => s.role);
}
