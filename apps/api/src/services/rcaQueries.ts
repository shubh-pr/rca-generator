import type { Prisma, Team } from '@prisma/client';
import type { Db } from '../db.js';
import { minutesBetween, todayIst } from '../lib/dates.js';
import { notFound } from '../lib/errors.js';
import { permissionFlags, type RcaAccessContext } from '../policy/policy.js';

export const userRef = { select: { id: true, name: true, email: true } } as const;

export const TEAMS: Team[] = ['DEV', 'QA', 'PROD'];

/** An action is overdue when open, past its due date, and not moved to follow-ups. */
export function overdueActionWhere(today = todayIst()): Prisma.RcaActionWhereInput {
  return { status: { not: 'COMPLETED' }, due_date: { lt: today }, followup: { is: null } };
}

export const sectionInclude = {
  whys: { orderBy: { why_no: 'asc' } },
  actions: {
    orderBy: [{ seq: 'asc' }, { created_at: 'asc' }],
    include: { owner: userRef, followup: { select: { id: true } } },
  },
  updated_by_user: { select: { id: true, name: true } },
} satisfies Prisma.RcaTeamSectionInclude;

export const rcaInclude = {
  workspace: { select: { id: true, name: true, is_personal: true } },
  timeline: { orderBy: [{ sort_order: 'asc' }, { event_time: 'asc' }] },
  sections: { orderBy: { team: 'asc' }, include: sectionInclude },
  followups: { orderBy: { created_at: 'asc' }, include: { owner: userRef } },
  attachments: { orderBy: { created_at: 'asc' }, include: { uploader: userRef } },
  signoffs: { orderBy: { role: 'asc' }, include: { user: userRef, assignee: userRef } },
} satisfies Prisma.RcaInclude;

export type FullRca = Prisma.RcaGetPayload<{ include: typeof rcaInclude }>;
export type FullSection = Prisma.RcaTeamSectionGetPayload<{ include: typeof sectionInclude }>;

export function serializeSection(s: FullSection, today = todayIst()) {
  return {
    ...s,
    actions: s.actions.map(({ followup, ...a }) => ({
      ...a,
      followup_id: followup?.id ?? null,
      is_overdue: a.status !== 'COMPLETED' && !followup && a.due_date < today,
    })),
  };
}

export function serializeRca(r: FullRca, ctx?: RcaAccessContext) {
  const today = todayIst();
  const sections = r.sections.map((s) => serializeSection(s, today));
  return {
    ...r,
    time_to_detect_minutes: minutesBetween(r.incident_start, r.detected_at),
    sections,
    has_overdue: sections.some((s) => s.actions.some((a) => a.is_overdue)),
    // Storage keys never leave the server.
    attachments: r.attachments.map(({ file_path: _p, ...a }) => a),
    ...(ctx ? { permissions: permissionFlags(ctx, r.signoffs, r.attachments) } : {}),
  };
}


export async function loadFullRca(db: Db, id: string) {
  const rca = await db.rca.findFirst({ where: { id, is_deleted: false }, include: rcaInclude });
  if (!rca) throw notFound('RCA not found');
  return rca;
}
