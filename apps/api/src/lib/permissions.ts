/**
 * Role matrix from SPEC Section 2. Every route calls one of these on the server;
 * the web app mirrors them only to grey out fields.
 */
import type { SignoffRole, Team, UserRole } from '@prisma/client';
import { forbidden } from './errors.js';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  team: Team | null;
}

type Pred = (u: AuthUser) => boolean;
const roles =
  (...r: UserRole[]): Pred =>
  (u) => r.includes(u.role);

const TEAM_ROLES: UserRole[] = ['DEV', 'QA', 'PROD'];

/** The sign-off role a user may sign as (Admin may sign any role). */
export const SIGNOFF_ROLE_OF_USER: Partial<Record<UserRole, SignoffRole>> = {
  PROJECT_OWNER: 'PROJECT_OWNER',
  RCA_LEAD: 'RCA_LEAD',
  DEV: 'DEV_LEAD',
  QA: 'QA_LEAD',
  PROD: 'PROD_LEAD',
};

/** The team whose section a team role belongs to. */
export const TEAM_OF_ROLE: Partial<Record<UserRole, Team>> = { DEV: 'DEV', QA: 'QA', PROD: 'PROD' };

export const can = {
  createRca: roles('ADMIN', 'PROJECT_OWNER', 'RCA_LEAD'),
  editCommon: roles('ADMIN', 'PROJECT_OWNER', 'RCA_LEAD'),
  deleteRca: roles('ADMIN'),
  manageMasters: roles('ADMIN'),
  submitReview: roles('ADMIN', 'PROJECT_OWNER', 'RCA_LEAD'),
  sendBack: roles('ADMIN', 'PROJECT_OWNER', 'RCA_LEAD'),
  closeRca: roles('ADMIN', 'PROJECT_OWNER'),
  reopenRca: roles('ADMIN', 'PROJECT_OWNER'),
  reopenSection: roles('ADMIN', 'RCA_LEAD'),
  /** "Lead+ / own team": managers and team members may add timeline events. */
  addTimeline: roles('ADMIN', 'PROJECT_OWNER', 'RCA_LEAD', 'DEV', 'QA', 'PROD'),
  editTimeline: roles('ADMIN', 'PROJECT_OWNER', 'RCA_LEAD'),
  manageFollowups: roles('ADMIN', 'PROJECT_OWNER', 'RCA_LEAD'),
  addAttachment: (u: AuthUser) => u.role !== 'VIEWER',
  viewRcaAudit: roles('ADMIN', 'PROJECT_OWNER', 'RCA_LEAD'),
  viewAuditLog: roles('ADMIN', 'PROJECT_OWNER'),

  /** Edit / submit a team section and its actions: Admin, Lead, or a member of that team. */
  editSection(u: AuthUser, team: Team): boolean {
    if (u.role === 'ADMIN' || u.role === 'RCA_LEAD') return true;
    return TEAM_ROLES.includes(u.role) && u.team === team;
  },

  deleteAttachment(u: AuthUser, uploadedBy: string | null): boolean {
    return u.role === 'ADMIN' || u.role === 'RCA_LEAD' || (uploadedBy !== null && u.id === uploadedBy);
  },

  signoff(u: AuthUser, role: SignoffRole): boolean {
    return u.role === 'ADMIN' || SIGNOFF_ROLE_OF_USER[u.role] === role;
  },
};

export function ensure(allowed: boolean, message?: string): void {
  if (!allowed) throw forbidden(message);
}
