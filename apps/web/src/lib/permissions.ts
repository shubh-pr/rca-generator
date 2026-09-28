// Mirror of apps/api/src/lib/permissions.ts. Used only to grey out controls;
// the server enforces every rule.
import type { Me, SignoffRole, Team, UserRole } from '../api/types';

const has = (u: Me | null, ...roles: UserRole[]) => !!u && roles.includes(u.role);

export const SIGNOFF_ROLE_OF_USER: Partial<Record<UserRole, SignoffRole>> = {
  PROJECT_OWNER: 'PROJECT_OWNER',
  RCA_LEAD: 'RCA_LEAD',
  DEV: 'DEV_LEAD',
  QA: 'QA_LEAD',
  PROD: 'PROD_LEAD',
};

export const can = {
  createRca: (u: Me | null) => has(u, 'ADMIN', 'PROJECT_OWNER', 'RCA_LEAD'),
  editCommon: (u: Me | null) => has(u, 'ADMIN', 'PROJECT_OWNER', 'RCA_LEAD'),
  deleteRca: (u: Me | null) => has(u, 'ADMIN'),
  manageMasters: (u: Me | null) => has(u, 'ADMIN'),
  submitReview: (u: Me | null) => has(u, 'ADMIN', 'PROJECT_OWNER', 'RCA_LEAD'),
  sendBack: (u: Me | null) => has(u, 'ADMIN', 'PROJECT_OWNER', 'RCA_LEAD'),
  closeRca: (u: Me | null) => has(u, 'ADMIN', 'PROJECT_OWNER'),
  reopenRca: (u: Me | null) => has(u, 'ADMIN', 'PROJECT_OWNER'),
  reopenSection: (u: Me | null) => has(u, 'ADMIN', 'RCA_LEAD'),
  addTimeline: (u: Me | null) => has(u, 'ADMIN', 'PROJECT_OWNER', 'RCA_LEAD', 'DEV', 'QA', 'PROD'),
  editTimeline: (u: Me | null) => has(u, 'ADMIN', 'PROJECT_OWNER', 'RCA_LEAD'),
  manageFollowups: (u: Me | null) => has(u, 'ADMIN', 'PROJECT_OWNER', 'RCA_LEAD'),
  addAttachment: (u: Me | null) => !!u && u.role !== 'VIEWER',
  deleteAttachment: (u: Me | null, uploadedBy: string | null) =>
    has(u, 'ADMIN', 'RCA_LEAD') || (!!u && u.id === uploadedBy),
  viewRcaAudit: (u: Me | null) => has(u, 'ADMIN', 'PROJECT_OWNER', 'RCA_LEAD'),
  viewAuditLog: (u: Me | null) => has(u, 'ADMIN', 'PROJECT_OWNER'),
  editSection: (u: Me | null, team: Team) =>
    has(u, 'ADMIN', 'RCA_LEAD') || (!!u && has(u, 'DEV', 'QA', 'PROD') && u.team === team),
  signoff: (u: Me | null, role: SignoffRole) => has(u, 'ADMIN') || (!!u && SIGNOFF_ROLE_OF_USER[u.role] === role),
};

/** Landing page after login ("redirect by role", SPEC 6.1). */
export function homeFor(u: Me): string {
  if (u.role === 'DEV' || u.role === 'QA' || u.role === 'PROD') return '/my-tasks';
  return '/dashboard';
}
