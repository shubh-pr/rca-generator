import type { Db } from '../db.js';

/**
 * Next RCA number for the year, e.g. RCA-2026-0007.
 * Must run inside the RCA insert transaction: the upsert takes a row lock on the
 * year's counter, so concurrent creates are serialised and a rollback frees the number.
 */
export async function nextRcaNumber(tx: Db, year: number): Promise<string> {
  const rows = await tx.$queryRaw<{ last_value: number }[]>`
    INSERT INTO rca_number_seq (year, last_value) VALUES (${year}, 1)
    ON CONFLICT (year) DO UPDATE SET last_value = rca_number_seq.last_value + 1
    RETURNING last_value`;
  return formatRcaNumber(year, rows[0].last_value);
}

export function formatRcaNumber(year: number, seq: number): string {
  return `RCA-${year}-${String(seq).padStart(4, '0')}`;
}
