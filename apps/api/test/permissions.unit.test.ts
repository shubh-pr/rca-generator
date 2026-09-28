import { describe, expect, it } from 'vitest';
import { can, type AuthUser } from '../src/lib/permissions.js';

const u = (role: AuthUser['role']): AuthUser => ({
  id: `id-${role}`,
  name: role,
  email: `${role}@x`,
  role,
  team: role === 'DEV' || role === 'QA' || role === 'PROD' ? role : null,
});

const ALL = ['ADMIN', 'PROJECT_OWNER', 'RCA_LEAD', 'DEV', 'QA', 'PROD', 'VIEWER'] as const;
const allowed = (pred: (x: AuthUser) => boolean) => ALL.filter((r) => pred(u(r)));

// Each expectation is one row of the SPEC Section 2 permission matrix.
describe('permission matrix (SPEC Section 2)', () => {
  it('create RCA / edit header and common: Admin, Owner, Lead', () => {
    expect(allowed(can.createRca)).toEqual(['ADMIN', 'PROJECT_OWNER', 'RCA_LEAD']);
    expect(allowed(can.editCommon)).toEqual(['ADMIN', 'PROJECT_OWNER', 'RCA_LEAD']);
  });

  it('edit Dev / QA / Production section: Admin, Lead and that team only', () => {
    expect(allowed((x) => can.editSection(x, 'DEV'))).toEqual(['ADMIN', 'RCA_LEAD', 'DEV']);
    expect(allowed((x) => can.editSection(x, 'QA'))).toEqual(['ADMIN', 'RCA_LEAD', 'QA']);
    expect(allowed((x) => can.editSection(x, 'PROD'))).toEqual(['ADMIN', 'RCA_LEAD', 'PROD']);
  });

  it('submit for review / send back: Admin, Owner, Lead', () => {
    expect(allowed(can.submitReview)).toEqual(['ADMIN', 'PROJECT_OWNER', 'RCA_LEAD']);
    expect(allowed(can.sendBack)).toEqual(['ADMIN', 'PROJECT_OWNER', 'RCA_LEAD']);
  });

  it('sign off own role only; Viewer never', () => {
    expect(can.signoff(u('DEV'), 'DEV_LEAD')).toBe(true);
    expect(can.signoff(u('DEV'), 'QA_LEAD')).toBe(false);
    expect(can.signoff(u('QA'), 'QA_LEAD')).toBe(true);
    expect(can.signoff(u('PROD'), 'PROD_LEAD')).toBe(true);
    expect(can.signoff(u('PROJECT_OWNER'), 'PROJECT_OWNER')).toBe(true);
    expect(can.signoff(u('PROJECT_OWNER'), 'RCA_LEAD')).toBe(false);
    expect(can.signoff(u('RCA_LEAD'), 'RCA_LEAD')).toBe(true);
    expect(can.signoff(u('ADMIN'), 'QA_LEAD')).toBe(true);
    for (const r of ['PROJECT_OWNER', 'RCA_LEAD', 'DEV_LEAD', 'QA_LEAD', 'PROD_LEAD'] as const) {
      expect(can.signoff(u('VIEWER'), r)).toBe(false);
    }
  });

  it('close / reopen RCA: Admin, Owner', () => {
    expect(allowed(can.closeRca)).toEqual(['ADMIN', 'PROJECT_OWNER']);
    expect(allowed(can.reopenRca)).toEqual(['ADMIN', 'PROJECT_OWNER']);
  });

  it('reopen a submitted section: Lead, Admin', () => {
    expect(allowed(can.reopenSection)).toEqual(['ADMIN', 'RCA_LEAD']);
  });

  it('delete RCA and manage masters: Admin only', () => {
    expect(allowed(can.deleteRca)).toEqual(['ADMIN']);
    expect(allowed(can.manageMasters)).toEqual(['ADMIN']);
  });

  it('attachments: everyone except Viewer uploads; uploader, Lead, Admin delete', () => {
    expect(allowed(can.addAttachment)).toEqual(['ADMIN', 'PROJECT_OWNER', 'RCA_LEAD', 'DEV', 'QA', 'PROD']);
    expect(can.deleteAttachment(u('DEV'), 'id-DEV')).toBe(true);
    expect(can.deleteAttachment(u('DEV'), 'someone-else')).toBe(false);
    expect(can.deleteAttachment(u('RCA_LEAD'), 'someone-else')).toBe(true);
  });

  it('audit: per-RCA history for Lead, Owner, Admin; audit screen for Owner, Admin', () => {
    expect(allowed(can.viewRcaAudit)).toEqual(['ADMIN', 'PROJECT_OWNER', 'RCA_LEAD']);
    expect(allowed(can.viewAuditLog)).toEqual(['ADMIN', 'PROJECT_OWNER']);
  });
});
