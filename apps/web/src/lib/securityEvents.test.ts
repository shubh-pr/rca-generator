import { describe, expect, it } from 'vitest';
import { describeEvent, type SecurityRefs } from './securityEvents';

const refs: SecurityRefs = {
  rcas: { r2: 'RCA-2026-0002', r5: 'RCA-2026-0005' },
  workspaces: { w1: "alice's workspace" },
  users: { u1: { name: 'Shubham P', email: 'shubham@kronovate.com' }, u9: { name: 'Ops Person', email: 'ops@x.test' } },
  invitations: { i1: { email: 'gone@x.test', role: 'VIEWER', team: null, rca_id: 'r2', workspace_id: null } },
};
const d = (action: string, new_value: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => describeEvent({ action, new_value, ...extra }, refs);

describe('security log lines use the detail the events recorded', () => {
  it('invitations: who, to what, as what', () => {
    expect(d('INVITE', { email: 'shubham@kronovate.com', role: 'EDITOR', team: null, rca_id: 'r2' }).label).toBe('Invited shubham@kronovate.com to RCA-2026-0002 as Editor');
    expect(d('INVITE', { email: 'd@x.test', role: 'CONTRIBUTOR', team: 'DEV', workspace_id: 'w1' }).label).toBe(`Invited d@x.test to the workspace "alice's workspace" as Contributor (Dev section)`);
    expect(d('INVITE_ACCEPT', { role: 'CONTRIBUTOR', team: 'DEV', rca_id: 'r5' }).label).toBe('Accepted an invitation to RCA-2026-0005 as Contributor (Dev section)');
    // Older accept events did not record the team: say less, do not guess.
    expect(d('INVITE_ACCEPT', { role: 'CONTRIBUTOR', rca_id: 'r5' }).label).toBe('Accepted an invitation to RCA-2026-0005 as Contributor');
    expect(d('INVITE_REVOKE', { invitation_id: 'i1', rca_id: 'r2' }).label).toBe('Revoked the invitation of gone@x.test to RCA-2026-0002 (Viewer)');
    expect(d('INVITE_ACCEPT_FAILED', { reason: 'wrong_account', rca_id: 'r2' })).toEqual({ label: 'Could not accept an invitation to RCA-2026-0002', detail: 'wrong account' });
  });

  it('exports: what was exported', () => {
    expect(d('EXPORT', { format: 'pdf', version: 2 }, { entity: 'rca', rca_id: 'r5' })).toEqual({ label: 'Exported RCA-2026-0005 as PDF', detail: 'version 2' });
    expect(d('EXPORT', { format: 'docx', version: 1 }, { entity: 'rca', rca_id: 'r2' }).label).toBe('Exported RCA-2026-0002 as Word');
    expect(d('EXPORT', { format: 'csv', rows: 'rca', count: 12, filters: { status: 'CLOSED', workspace_id: 'w1' } }, { entity: 'rca_list' })).toEqual({
      label: 'Exported the RCA list as CSV (12 rows)',
      detail: "Filters: status CLOSED, workspace alice's workspace",
    });
    expect(d('EXPORT', { format: 'xlsx', rows: 'actions', count: 1, filters: {} }, { entity: 'rca_list' }).label).toBe('Exported the RCA action list as Excel (1 RCA)');
    expect(d('EXPORT', { format: 'docx', template: 'blank' }, { entity: 'template' }).label).toBe('Downloaded the blank RCA template (Word)');
  });

  it('access changes name the person and the place', () => {
    expect(d('ROLE_CHANGE', { user_id: 'u1', rca_id: 'r5', from: 'VIEWER', to: 'CONTRIBUTOR', team: 'QA' }).label).toBe('Changed the access of Shubham P (shubham@kronovate.com) on RCA-2026-0005: Viewer → Contributor (QA section)');
    expect(d('MEMBER_REMOVE', { user_id: 'u1', workspace_id: 'w1' }).label).toBe(`Removed Shubham P (shubham@kronovate.com) from the workspace "alice's workspace"`);
    expect(d('ROLE_CHANGE', { target_user_id: 'u9', action: 'disabled' }).label).toBe('Disabled the account of Ops Person (ops@x.test)');
    // A purged person cannot be resolved any more.
    expect(d('MEMBER_REMOVE', { user_id: 'unknown', rca_id: 'r2' }).label).toBe('Removed a person from RCA-2026-0002');
  });

  it('account and sign-in events', () => {
    expect(d('LOGIN').label).toBe('Logged in with email and password');
    expect(d('LOGIN', { method: 'google' }).label).toBe('Logged in with Google');
    expect(d('SIGNUP', { method: 'microsoft' }).label).toBe('Account created with Microsoft');
    expect(d('LOGIN_FAILED', { locked: true }).detail).toContain('locked');
    expect(d('LOGOUT', { remote: true, session: 's1' }).label).toBe('Signed out another device');
    expect(d('EMAIL_CHANGE', { from: 'a@x.test', to: 'b@x.test' }).label).toBe('Login email changed from a@x.test to b@x.test');
    expect(d('CREATE', { name: 'Payments team', workspace_id: 'w1' }).label).toBe('Created the workspace "Payments team"');
    expect(d('DELETE', { name: 'Old team', rcas: 3 })).toEqual({ label: 'Deleted the workspace "Old team"', detail: '3 RCAs deleted with it' });
    expect(d('SUPPORT_ACCESS', { workspace_id: 'w1' }).label).toBe(`Used support access to the workspace "alice's workspace"`);
    expect(d('ACCOUNT_DELETE', { purge_after: '2026-10-15T00:00:00Z' }).detail).toBe('Data is erased on 15 Oct 2026');
    expect(d('IDENTITY_LINK', { provider: 'google', provider_email: 'a@gmail.com', via: 'verified_email' })).toEqual({ label: 'Google account linked', detail: 'a@gmail.com · matched by verified email' });
    expect(d('EMAIL_VERIFIED').label).toBe('Email address verified');
    expect(d('DATA_EXPORT').label).toBe('Downloaded my data (zip)');
  });
});
