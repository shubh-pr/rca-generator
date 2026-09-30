import { describe, expect, it } from 'vitest';
import { problemTarget, sectionFieldTarget } from './fieldJump';

// The same messages apps/api/test/workflowRules.unit.test.ts pins on the server side.
describe('problemTarget: validation message → tab and element', () => {
  it.each([
    ['Problem statement is missing', 'common', ['summary']],
    ['Detected at is missing', 'header', ['detected_at']],
    ['Resolved at is missing', 'header', ['resolved_at']],
    ['Users / clients affected is missing', 'common', ['impact_users']],
    ['Detection method is missing', 'common', ['detection_method']],
    ['Immediate fix is missing', 'common', ['immediate_fix']],
    ['DEV section is not submitted', 'DEV', ['DEV-submit', 'DEV-heading']],
    ['QA section has no action', 'QA', ['QA-actions']],
    ['PROD section has no root cause (Why 5)', 'PROD', ['PROD-why-5']],
    ['Sign-off pending: DEV_LEAD', 'closing', ['signoffs']],
    ['1 action still open (QA #2); complete them or move them to follow-ups with an owner and date', 'QA', ['QA-actions']],
  ])('%s', (message, tab, ids) => {
    expect(problemTarget(message)).toEqual({ tab, ids });
  });

  it('unknown messages are not links', () => {
    expect(problemTarget('Something else is missing')).toBeNull();
    expect(problemTarget('The team lead sign-offs come first: DEV_LEAD pending')).toBeNull();
  });
});

// Field keys of "Section is not complete" (apps/api/src/routes/rca/sections.ts, submitProblems).
describe('sectionFieldTarget', () => {
  it.each([
    ['cause_category', 'DEV-cause'],
    ['whys.1', 'DEV-why-1'],
    ['whys.5', 'DEV-why-5'],
    ['escape_analysis', 'DEV-escape'],
    ['actions', 'DEV-actions'],
  ])('%s', (key, id) => expect(sectionFieldTarget('DEV', key)).toEqual({ tab: 'DEV', ids: [id] }));

  it('other keys are not links', () => expect(sectionFieldTarget('DEV', 'version')).toBeNull());
});

