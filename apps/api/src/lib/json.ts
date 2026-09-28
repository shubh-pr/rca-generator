/** Columns stored as SQL `date`; sent to clients as YYYY-MM-DD. */
const DATE_ONLY_KEYS = new Set(['rca_date', 'target_date', 'actual_date', 'due_date', 'completed_on']);

/** JSON replacer for all API responses. */
export function jsonReplacer(key: string, value: unknown) {
  if (key === 'password_hash') return undefined;
  if (DATE_ONLY_KEYS.has(key) && typeof value === 'string') return value.slice(0, 10);
  return value;
}

/** Plain JSON copy (Dates -> ISO strings), safe for jsonb audit columns. */
export function toJson<T>(value: T): unknown {
  if (value === undefined || value === null) return null;
  return JSON.parse(JSON.stringify(value, jsonReplacer));
}
