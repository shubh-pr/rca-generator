import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { parse, zDate, zUuid } from '../lib/validate.js';
import { overdueActionWhere } from './rcaQueries.js';

/**
 * Filters shared by the RCA list, the list export and the dashboard summary,
 * so the dashboard numbers always match the list for the same filters.
 * Tenant visibility is added by the Prisma tenant extension, not here.
 */
export const rcaFilterSchema = z.object({
  status: z.enum(['DRAFT', 'IN_REVIEW', 'CLOSED']).optional(),
  workspace_id: zUuid.optional(),
  /** Project label (exact, case-insensitive). */
  project: z.string().trim().max(150).optional(),
  severity: z.enum(['P1', 'P2', 'P3', 'P4']).optional(),
  environment: z.enum(['PROD', 'UAT', 'STAGING']).optional(),
  /** RCAs whose section for this team is not yet SUBMITTED. */
  team: z.enum(['DEV', 'QA', 'PROD']).optional(),
  date_from: zDate.optional(),
  date_to: zDate.optional(),
  q: z.string().trim().max(200).optional(),
  /** Status is DRAFT or IN_REVIEW. */
  open: z.enum(['true', 'false']).optional(),
  closed_from: zDate.optional(),
  closed_to: zDate.optional(),
  /** RCAs that have at least one overdue action. */
  overdue: z.enum(['true', 'false']).optional(),
  /** Shared with me: RCAs I was invited to directly, in workspaces I am not a member of. */
  shared: z.enum(['true']).optional(),
});

export type RcaFilters = z.infer<typeof rcaFilterSchema>;

const FILTER_KEYS = Object.keys(rcaFilterSchema.shape);

export function parseRcaFilters(query: unknown): RcaFilters {
  const q = (query ?? {}) as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const k of FILTER_KEYS) if (q[k] !== undefined && q[k] !== '') picked[k] = q[k];
  return parse(rcaFilterSchema, picked);
}

const nextDay = (d: Date) => new Date(d.getTime() + 86_400_000);

/**
 * RCAs shared with the user directly: they are a collaborator of the RCA and not a member of its
 * workspace. This only narrows what the user can already see; access itself is unchanged.
 */
export const sharedWithWhere = (userId: string): Prisma.RcaWhereInput => ({
  collaborators: { some: { user_id: userId } },
  workspace: { members: { none: { user_id: userId } } },
});

export function buildRcaWhere(f: RcaFilters, userId: string): Prisma.RcaWhereInput {
  const and: Prisma.RcaWhereInput[] = [{ is_deleted: false }];
  if (f.shared === 'true') and.push(sharedWithWhere(userId));
  if (f.status) and.push({ status: f.status });
  if (f.open === 'true') and.push({ status: { in: ['DRAFT', 'IN_REVIEW'] } });
  if (f.workspace_id) and.push({ workspace_id: f.workspace_id });
  if (f.project) and.push({ project_name: { equals: f.project, mode: 'insensitive' } });
  if (f.severity) and.push({ severity: f.severity });
  if (f.environment) and.push({ environment: f.environment });
  if (f.team) and.push({ sections: { some: { team: f.team, section_status: { not: 'SUBMITTED' } } } });
  if (f.date_from) and.push({ rca_date: { gte: f.date_from } });
  if (f.date_to) and.push({ rca_date: { lte: f.date_to } });
  // closed_* are IST calendar dates on closed_at.
  if (f.closed_from) and.push({ closed_at: { gte: new Date(f.closed_from.getTime() - 5.5 * 3_600_000) } });
  if (f.closed_to) and.push({ closed_at: { lt: new Date(nextDay(f.closed_to).getTime() - 5.5 * 3_600_000) } });
  if (f.overdue === 'true') and.push({ sections: { some: { actions: { some: overdueActionWhere() } } } });
  if (f.q) {
    and.push({
      OR: [
        { rca_number: { contains: f.q, mode: 'insensitive' } },
        { summary: { contains: f.q, mode: 'insensitive' } },
        { ticket_id: { contains: f.q, mode: 'insensitive' } },
        { project_name: { contains: f.q, mode: 'insensitive' } },
      ],
    });
  }
  return { AND: and };
}

export const RCA_SORTABLE = ['rca_number', 'rca_date', 'severity', 'status', 'created_at', 'updated_at', 'incident_start'] as const;
