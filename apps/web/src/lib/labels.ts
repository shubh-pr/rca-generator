import type {
  ActionStatus,
  CauseCategory,
  DetectionMethod,
  Environment,
  RcaStatus,
  SectionStatus,
  Severity,
  SignoffRole,
  Team,
  WorkspaceRole,
} from '../api/types';

export const SEVERITIES: Severity[] = ['P1', 'P2', 'P3', 'P4'];
export const ENVIRONMENTS: Environment[] = ['PROD', 'UAT', 'STAGING'];
export const RCA_STATUSES: RcaStatus[] = ['DRAFT', 'IN_REVIEW', 'CLOSED'];
export const TEAMS: Team[] = ['DEV', 'QA', 'PROD'];
export const CAUSE_CATEGORIES: CauseCategory[] = [
  'CODE_DEFECT',
  'CONFIG',
  'REQUIREMENT_GAP',
  'TEST_GAP',
  'DEPLOYMENT',
  'INFRA',
  'THIRD_PARTY',
  'DATA',
];
export const ACTION_STATUSES: ActionStatus[] = ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED'];
export const DETECTION_METHODS: DetectionMethod[] = ['MONITORING', 'CLIENT_REPORT', 'QA', 'OTHER'];
export const WORKSPACE_ROLES: WorkspaceRole[] = ['OWNER', 'EDITOR', 'CONTRIBUTOR', 'VIEWER'];
export const SIGNOFF_ROLES: SignoffRole[] = ['DEV_LEAD', 'QA_LEAD', 'PROD_LEAD', 'PROJECT_OWNER', 'RCA_LEAD'];

export const ROLE_LABEL: Record<WorkspaceRole, string> = {
  OWNER: 'Owner',
  EDITOR: 'Editor',
  CONTRIBUTOR: 'Contributor',
  VIEWER: 'Viewer',
};

export const TEAM_LABEL: Record<Team, string> = { DEV: 'Dev', QA: 'QA', PROD: 'Production' };

export const STATUS_LABEL: Record<RcaStatus, string> = { DRAFT: 'Draft', IN_REVIEW: 'In review', CLOSED: 'Closed' };

export const SECTION_STATUS_LABEL: Record<SectionStatus, string> = {
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  SUBMITTED: 'Submitted',
};

// Actions and the section's completion status have their own values (COMPLETED, not SUBMITTED), so
// they get their own labels. Record<ActionStatus, …> makes a missing label a type error.
export const ACTION_STATUS_LABEL: Record<ActionStatus, string> = {
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
};

export const ENV_LABEL: Record<Environment, string> = { PROD: 'Production', UAT: 'UAT', STAGING: 'Staging' };

export const CAUSE_LABEL: Record<CauseCategory, string> = {
  CODE_DEFECT: 'Code defect',
  CONFIG: 'Configuration',
  REQUIREMENT_GAP: 'Requirement gap',
  TEST_GAP: 'Test gap',
  DEPLOYMENT: 'Deployment',
  INFRA: 'Infrastructure',
  THIRD_PARTY: 'Third party',
  DATA: 'Data',
};

export const DETECTION_LABEL: Record<DetectionMethod, string> = {
  MONITORING: 'Monitoring / alert',
  CLIENT_REPORT: 'Client report',
  QA: 'QA',
  OTHER: 'Other',
};

export const SIGNOFF_LABEL: Record<SignoffRole, string> = {
  DEV_LEAD: 'Dev Lead',
  QA_LEAD: 'QA Lead',
  PROD_LEAD: 'Production Lead',
  PROJECT_OWNER: 'Project Owner',
  RCA_LEAD: 'RCA Team Leader',
};

/** Team-specific labels for escape analysis and extra prompts (SPEC 4.6). */
export const TEAM_PROMPTS: Record<Team, { escape_analysis: string; extra_1: string; extra_2: string }> = {
  DEV: {
    escape_analysis: 'Why it was not prevented',
    extra_1: 'Code review / unit test gap',
    extra_2: 'Related PR / commit / release',
  },
  QA: {
    escape_analysis: 'Why it was not caught',
    extra_1: 'Missing test case / regression gap',
    extra_2: 'Test case IDs to add or update',
  },
  PROD: {
    escape_analysis: 'Why it was not prevented or detected early',
    extra_1: 'Monitoring / alerting gap',
    extra_2: 'Deployment / rollback gap',
  },
};
