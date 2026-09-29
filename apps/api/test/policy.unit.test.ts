import { describe, expect, it } from 'vitest';
import { can, canInWorkspace, type RcaAccessContext, type RcaAction } from '../src/policy/policy.js';

const ctx = (role: RcaAccessContext['role'], teams: RcaAccessContext['teams'] = [], isSupport = false): RcaAccessContext => ({ userId: 'me', role, teams, isSupport });
const ROLES = ['OWNER', 'EDITOR', 'CONTRIBUTOR', 'VIEWER'] as const;
const allowed = (action: RcaAction, resource = {}) => ROLES.filter((r) => can(ctx(r, r === 'CONTRIBUTOR' ? ['DEV'] : []), action, resource));

describe('policy (docs/B2C_PLAN.md section 4)', () => {
  it('view, export and history: everyone with access', () => {
    for (const a of ['rca.view', 'rca.export', 'audit.view'] as RcaAction[]) expect(allowed(a)).toEqual(ROLES);
  });
  it('header/common, review, close, reopen, unlock, follow-ups, timeline edit, sign-off assignment: OWNER and EDITOR', () => {
    for (const a of ['rca.edit', 'rca.review', 'rca.close', 'rca.reopen', 'section.unlock', 'followup.manage', 'timeline.edit', 'signoff.assign'] as RcaAction[]) {
      expect(allowed(a), a).toEqual(['OWNER', 'EDITOR']);
    }
  });
  it('delete RCA: OWNER only', () => expect(allowed('rca.delete')).toEqual(['OWNER']));
  it('team sections: OWNER/EDITOR every team, CONTRIBUTOR only their teams', () => {
    expect(allowed('section.edit', { team: 'DEV' })).toEqual(['OWNER', 'EDITOR', 'CONTRIBUTOR']);
    expect(allowed('section.edit', { team: 'QA' })).toEqual(['OWNER', 'EDITOR']);
    expect(can(ctx('CONTRIBUTOR', ['QA', 'PROD']), 'section.edit', { team: 'PROD' })).toBe(true);
  });
  it('timeline add and attachments: everyone except VIEWER; contributors delete only their own uploads', () => {
    expect(allowed('timeline.add')).toEqual(['OWNER', 'EDITOR', 'CONTRIBUTOR']);
    expect(allowed('attachment.add')).toEqual(['OWNER', 'EDITOR', 'CONTRIBUTOR']);
    expect(allowed('attachment.delete', { uploaded_by: 'me' })).toEqual(['OWNER', 'EDITOR', 'CONTRIBUTOR']);
    expect(allowed('attachment.delete', { uploaded_by: 'someone' })).toEqual(['OWNER', 'EDITOR']);
  });
  it('sign-off: the assignee only; unassigned rows by OWNER/EDITOR', () => {
    expect(allowed('signoff.sign', { assignee_user_id: null })).toEqual(['OWNER', 'EDITOR']);
    expect(allowed('signoff.sign', { assignee_user_id: 'me' })).toEqual(ROLES);
    expect(allowed('signoff.sign', { assignee_user_id: 'other' })).toEqual([]);
  });
  it('support access is read-only', () => {
    const s = ctx('VIEWER', [], true);
    expect(can(s, 'rca.view')).toBe(true);
    expect(can(s, 'audit.view')).toBe(true);
    for (const a of ['rca.export', 'rca.edit', 'attachment.add', 'signoff.sign'] as RcaAction[]) expect(can(s, a), a).toBe(false);
  });
  it('managing RCA collaborators needs OWNER of the RCA\'s workspace', () => {
    expect(can({ ...ctx('OWNER'), workspaceRole: 'OWNER' }, 'collaborators.manage')).toBe(true);
    expect(can({ ...ctx('OWNER'), workspaceRole: null }, 'collaborators.manage')).toBe(false); // RCA-level owner only
    expect(can({ ...ctx('EDITOR'), workspaceRole: 'EDITOR' }, 'collaborators.manage')).toBe(false);
  });
  it('workspace actions', () => {
    expect(ROLES.filter((r) => canInWorkspace(r, 'rca.create'))).toEqual(['OWNER', 'EDITOR']);
    expect(ROLES.filter((r) => canInWorkspace(r, 'members.manage'))).toEqual(['OWNER']);
    expect(canInWorkspace(null, 'workspace.view')).toBe(false);
  });
});
