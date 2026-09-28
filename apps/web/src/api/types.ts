// API types. Field names match the API JSON (snake_case, as in the spec).

export type Severity = 'P1' | 'P2' | 'P3' | 'P4';
export type Environment = 'PROD' | 'UAT' | 'STAGING';
export type RcaStatus = 'DRAFT' | 'IN_REVIEW' | 'CLOSED';
export type Team = 'DEV' | 'QA' | 'PROD';
export type SectionStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'SUBMITTED';
export type CauseCategory =
  | 'CODE_DEFECT'
  | 'CONFIG'
  | 'REQUIREMENT_GAP'
  | 'TEST_GAP'
  | 'DEPLOYMENT'
  | 'INFRA'
  | 'THIRD_PARTY'
  | 'DATA';
export type ActionStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
export type CompletionStatus = ActionStatus;
export type DetectionMethod = 'MONITORING' | 'CLIENT_REPORT' | 'QA' | 'OTHER';
export type WorkspaceRole = 'OWNER' | 'EDITOR' | 'CONTRIBUTOR' | 'VIEWER';
export type SignoffRole = 'PROJECT_OWNER' | 'RCA_LEAD' | 'DEV_LEAD' | 'QA_LEAD' | 'PROD_LEAD';

export interface Paged<T> {
  data: T[];
  page: number;
  page_size: number;
  total: number;
}

export interface WorkspaceRef {
  id: string;
  name: string;
  is_personal: boolean;
  is_primary_owner: boolean;
  role: WorkspaceRole;
  team: Team | null;
}

export interface Me {
  id: string;
  name: string;
  email: string;
  email_verified: boolean;
  is_platform_admin: boolean;
  onboarded: boolean;
  has_password: boolean;
  shared_rca_count: number;
  workspaces: WorkspaceRef[];
}

export interface UserRef {
  id: string;
  name: string;
  email?: string;
}

export interface Participant extends UserRef {
  role: WorkspaceRole;
  team: Team | null;
}

export interface TimelineEvent {
  id: string;
  rca_id: string;
  event_time: string;
  event: string;
  team_or_person: string | null;
  sort_order: number | null;
}

export interface Why {
  id: string;
  why_no: number;
  answer: string | null;
}

export interface Action {
  id: string;
  section_id: string;
  seq: number | null;
  action: string;
  owner_id: string;
  owner: UserRef;
  due_date: string;
  status: ActionStatus;
  completed_on: string | null;
  is_overdue: boolean;
  followup_id: string | null;
}

export interface TeamSection {
  id: string;
  rca_id: string;
  team: Team;
  contributor_name: string | null;
  cause_category: CauseCategory | null;
  escape_analysis: string | null;
  extra_1: string | null;
  extra_2: string | null;
  prev_process: string | null;
  prev_automation: string | null;
  prev_owner_date: string | null;
  target_date: string | null;
  actual_date: string | null;
  completion_status: CompletionStatus;
  verified_by_name: string | null;
  updated_by_user: UserRef | null;
  section_status: SectionStatus;
  submitted_at: string | null;
  version: number;
  updated_at: string;
  whys: Why[];
  actions: Action[];
}

export interface Followup {
  id: string;
  rca_id: string;
  risk: string;
  owner_id: string | null;
  owner: UserRef | null;
  due_date: string | null;
  action_id: string | null;
}

export interface Attachment {
  id: string;
  rca_id: string;
  description: string | null;
  kind: 'FILE' | 'LINK';
  url: string | null;
  file_name: string | null;
  mime: string | null;
  size: number | null;
  uploaded_by: string | null;
  uploader: UserRef | null;
  created_at: string;
}

export interface Signoff {
  id: string;
  role: SignoffRole;
  assignee_user_id: string | null;
  assignee: UserRef | null;
  user_id: string | null;
  user: UserRef | null;
  signed_at: string | null;
  comment: string | null;
}

export interface RcaSummary {
  id: string;
  workspace_id: string;
  workspace: { id: string; name: string };
  rca_number: string;
  rca_date: string;
  severity: Severity;
  environment: Environment;
  status: RcaStatus;
  version: number;
  summary: string;
  ticket_id: string | null;
  company_name: string | null;
  project_name: string | null;
  team_leader_name: string | null;
  is_sample: boolean;
  sections: { team: Team; section_status: SectionStatus }[];
  has_overdue: boolean;
}

/** Evaluated server-side by the policy module; the UI only uses it to enable controls. */
export interface RcaPermissions {
  role: WorkspaceRole;
  teams: Team[];
  support: boolean;
  edit: boolean;
  delete: boolean;
  review: boolean;
  close: boolean;
  reopen: boolean;
  unlock_section: boolean;
  add_timeline: boolean;
  edit_timeline: boolean;
  manage_followups: boolean;
  add_attachment: boolean;
  assign_signoff: boolean;
  export: boolean;
  edit_section: Record<Team, boolean>;
  sign: Record<SignoffRole, boolean>;
  delete_attachment: Record<string, boolean>;
}

export interface Rca extends Omit<RcaSummary, 'sections' | 'workspace'> {
  workspace: { id: string; name: string; is_personal: boolean };
  incident_start: string;
  detected_at: string | null;
  resolved_at: string | null;
  time_to_detect_minutes: number | null;
  project_owner_name: string | null;
  prepared_by_name: string | null;
  reviewed_by_name: string | null;
  impact_users: string | null;
  impact_duration: string | null;
  impact_data_revenue: string | null;
  sla_breached: boolean;
  detection_method: DetectionMethod | null;
  immediate_fix: string | null;
  immediate_fix_by: string | null;
  lessons_well: string | null;
  lessons_not_well: string | null;
  lessons_key: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  timeline: TimelineEvent[];
  sections: TeamSection[];
  followups: Followup[];
  attachments: Attachment[];
  signoffs: Signoff[];
  permissions: RcaPermissions;
}

export interface AuditEntry {
  id: string;
  entity: string;
  entity_id: string;
  rca_id: string | null;
  action: string;
  old_value: unknown;
  new_value: unknown;
  user_id: string | null;
  user: UserRef | null;
  rca: { id: string; rca_number: string } | null;
  at: string;
}
