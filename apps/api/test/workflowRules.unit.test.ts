import { describe, expect, it } from 'vitest';
import { closeProblems, reviewProblems } from '../src/services/workflowRules.js';
import type { FullRca } from '../src/services/rcaQueries.js';

/**
 * Pins the exact wording of the review/close problems. The web app turns these messages into links to
 * the field they are about (apps/web/src/lib/fieldJump.ts, tested in fieldJump.test.ts with the same
 * strings): change both together.
 */
const section = (team: string, over: Record<string, unknown> = {}) => ({
  team,
  section_status: 'DRAFT',
  actions: [] as unknown[],
  whys: [{ why_no: 5, answer: '' }],
  ...over,
});

describe('review and close messages (contract with the web app)', () => {
  it('reviewProblems lists every missing field and structural gap in this wording', () => {
    const rca = {
      summary: '',
      detected_at: null,
      resolved_at: null,
      impact_users: ' ',
      detection_method: null,
      immediate_fix: '',
      sections: [section('DEV'), section('QA', { section_status: 'SUBMITTED', actions: [{}], whys: [{ why_no: 5, answer: 'x' }] })],
    } as unknown as FullRca;
    expect(reviewProblems(rca).problems).toEqual([
      'Problem statement is missing',
      'Detected at is missing',
      'Resolved at is missing',
      'Users / clients affected is missing',
      'Detection method is missing',
      'Immediate fix is missing',
      'DEV section is not submitted',
      'DEV section has no action',
      'DEV section has no root cause (Why 5)',
    ]);
  });

  it('closeProblems wording', () => {
    const rca = {
      signoffs: [{ role: 'DEV_LEAD', signed_at: null }, { role: 'QA_LEAD', signed_at: new Date() }],
      sections: [{ team: 'QA', actions: [{ id: 'a1', seq: 2, status: 'OPEN' }] }],
      followups: [],
    } as unknown as FullRca;
    expect(closeProblems(rca).problems).toEqual([
      'Sign-off pending: DEV_LEAD',
      '1 action still open (QA #2); complete them or move them to follow-ups with an owner and date',
    ]);
  });
});
