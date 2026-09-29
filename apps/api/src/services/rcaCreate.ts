import type { Prisma } from '@prisma/client';
import type { Tx } from '../db.js';
import { rcaAudit, writeAudit } from '../lib/audit.js';
import type { AuthUser } from '../policy/access.js';
import { nextRcaNumber } from './rcaNumber.js';
import { TEAMS } from './rcaQueries.js';

const SIGNOFF_ROLES = ['PROJECT_OWNER', 'RCA_LEAD', 'DEV_LEAD', 'QA_LEAD', 'PROD_LEAD'] as const;

export type RcaCreateFields = Omit<Prisma.RcaUncheckedCreateInput, 'id' | 'workspace_id' | 'rca_number'>;

/**
 * Insert an RCA with its number, 3 team sections (5 whys each) and 5 sign-off rows in one
 * transaction (SPEC 4.9). Name fields default to the creator's name so a solo user needs no setup.
 */
export async function createRcaRecord(me: AuthUser, workspaceId: string, fields: RcaCreateFields, tx: Tx) {
  {
    const rcaDate = fields.rca_date instanceof Date ? fields.rca_date : new Date(String(fields.rca_date));
    const rca_number = await nextRcaNumber(tx, workspaceId, rcaDate.getUTCFullYear());
    const created = await tx.rca.create({
      data: {
        project_owner_name: me.name,
        team_leader_name: me.name,
        prepared_by_name: me.name,
        ...fields,
        workspace_id: workspaceId,
        rca_number,
        created_by: me.id,
        updated_by: me.id,
        sections: {
          create: TEAMS.map((team) => ({ team, whys: { create: [1, 2, 3, 4, 5].map((why_no) => ({ why_no })) } })),
        },
        signoffs: { create: SIGNOFF_ROLES.map((role) => ({ role })) },
      },
    });
    await writeAudit(tx, rcaAudit(created, { entity: 'rca', entity_id: created.id, action: 'CREATE', new_value: created, user_id: me.id }));
    return created.id;
  }
}
