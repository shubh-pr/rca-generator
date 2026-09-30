import { describe, expect, it } from 'vitest';
import { ACTION_STATUS_LABEL, ACTION_STATUSES, CAUSE_CATEGORIES, CAUSE_LABEL } from './labels';

// Dropdowns render `label` as the option text: a missing label is an option you cannot see.
describe('every dropdown option has visible text', () => {
  it('action status and completion status: Not started, In progress, Completed', () => {
    expect(ACTION_STATUSES.map((s) => ACTION_STATUS_LABEL[s])).toEqual(['Not started', 'In progress', 'Completed']);
  });

  it('cause categories', () => {
    for (const c of CAUSE_CATEGORIES) expect(CAUSE_LABEL[c], c).toMatch(/\S/);
  });
});
