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
export type UserRole = 'ADMIN' | 'PROJECT_OWNER' | 'RCA_LEAD' | 'DEV' | 'QA' | 'PROD' | 'VIEWER';
export type SignoffRole = 'PROJECT_OWNER' | 'RCA_LEAD' | 'DEV_LEAD' | 'QA_LEAD' | 'PROD_LEAD';

export interface Paged<T> {
  data: T[];
  page: number;
  page_size: number;
  total: number;
}

export interface Me {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  team: Team | null;
}

export interface User extends Me {
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserRef {
  id: string;
  name: string;
  email?: string;
}

export interface Company {
  id: string;
  name: string;
  created_at: string;
}

export interface Project {
  id: string;
  name: string;
  company_id: string;
  owner_user_id: string;
  company: { id: string; name: string };
  owner: UserRef;
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
  contributor_id: string | null;
  contributor: UserRef | null;
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
  verified_by: string | null;
  verified_by_user: UserRef | null;
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
  user_id: string | null;
  user: UserRef | null;
  signed_at: string | null;
  comment: string | null;
}

export interface RcaSummary {
  id: string;
  rca_number: string;
  rca_date: string;
  severity: Severity;
  environment: Environment;
  status: RcaStatus;
  version: number;
  summary: string;
  ticket_id: string | null;
  project: { id: string; name: string; company: { id: string; name: string } };
  team_leader: UserRef;
  sections: { team: Team; section_status: SectionStatus }[];
  has_overdue: boolean;
}

export interface Rca extends Omit<RcaSummary, 'project'> {
  project_id: string;
  team_leader_id: string;
  incident_start: string;
  detected_at: string | null;
  resolved_at: string | null;
  time_to_detect_minutes: number | null;
  prepared_by: string | null;
  reviewed_by: string | null;
  prepared_by_user: UserRef | null;
  reviewed_by_user: UserRef | null;
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
  project: Project;
  timeline: TimelineEvent[];
  sections: TeamSection[];
  followups: Followup[];
  attachments: Attachment[];
  signoffs: Signoff[];
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
