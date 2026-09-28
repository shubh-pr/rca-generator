import type { Db } from '../db.js';

/**
 * Next RCA number for the workspace and year, e.g. RCA-2026-0007. Numbers are per workspace so they
 * do not reveal other tenants' volume. Must run inside the RCA insert transaction: the upsert locks
 * the counter row, so concurrent creates are serialised and a rollback frees the number.
 */
export async function nextRcaNumber(tx: Db, workspaceId: string, year: number): Promise<string> {
  const rows = await tx.$queryRaw<{ last_value: number }[]>`
    INSERT INTO rca_number_seq (workspace_id, year, last_value) VALUES (${workspaceId}::uuid, ${year}, 1)
    ON CONFLICT (workspace_id, year) DO UPDATE SET last_value = rca_number_seq.last_value + 1
    RETURNING last_value`;
  return formatRcaNumber(year, rows[0].last_value);
}

export function formatRcaNumber(year: number, seq: number): string {
  return `RCA-${year}-${String(seq).padStart(4, '0')}`;
}
