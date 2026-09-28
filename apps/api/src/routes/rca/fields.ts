import { z } from 'zod';
import { zDate, zDateTime, zText } from '../../lib/validate.js';

/** Header + common + lessons fields (everything on the rca row a user may type). */
export const rcaEditableFields = {
  rca_date: zDate,
  company_name: zText(150).optional(),
  project_name: zText(150).optional(),
  project_owner_name: zText(120).optional(),
  team_leader_name: zText(120).optional(),
  ticket_id: zText(60).optional(),
  severity: z.enum(['P1', 'P2', 'P3', 'P4']),
  environment: z.enum(['PROD', 'UAT', 'STAGING']),
  incident_start: zDateTime,
  detected_at: zDateTime.nullable().optional(),
  resolved_at: zDateTime.nullable().optional(),
  prepared_by_name: zText(120).optional(),
  reviewed_by_name: zText(120).optional(),
  summary: z.string().trim().min(1, 'Problem statement is required').max(10_000),
  impact_users: zText(10_000).optional(),
  impact_duration: zText(80).optional(),
  impact_data_revenue: zText(10_000).optional(),
  sla_breached: z.boolean().optional(),
  detection_method: z.enum(['MONITORING', 'CLIENT_REPORT', 'QA', 'OTHER']).nullable().optional(),
  immediate_fix: zText(10_000).optional(),
  immediate_fix_by: zText(120).optional(),
  lessons_well: zText(10_000).optional(),
  lessons_not_well: zText(10_000).optional(),
  lessons_key: zText(10_000).optional(),
};
