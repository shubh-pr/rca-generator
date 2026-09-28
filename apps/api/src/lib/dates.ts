/** Today's date (YYYY-MM-DD) in IST, as a Date at UTC midnight, for comparing with `date` columns. */
export function todayIst(now = new Date()): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
  return new Date(`${ymd}T00:00:00Z`);
}

export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Start of the current month in IST, as a UTC instant. */
export function startOfMonthIst(now = new Date()): Date {
  const ymdIst = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
  return new Date(`${ymdIst.slice(0, 7)}-01T00:00:00+05:30`);
}

export function minutesBetween(a: Date | null | undefined, b: Date | null | undefined): number | null {
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 60000);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "27 Sep 2026, 14:05 IST" */
export function formatIstDateTime(d: Date | null | undefined): string {
  if (!d) return '';
  const ist = new Date(d.getTime() + 5.5 * 3_600_000);
  const hh = String(ist.getUTCHours()).padStart(2, '0');
  const mm = String(ist.getUTCMinutes()).padStart(2, '0');
  return `${String(ist.getUTCDate()).padStart(2, '0')} ${MONTHS[ist.getUTCMonth()]} ${ist.getUTCFullYear()}, ${hh}:${mm} IST`;
}

/** Date-only column -> "28 Sep 2026". */
export function formatDateOnly(d: Date | null | undefined): string {
  if (!d) return '';
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function formatDuration(mins: number | null): string {
  if (mins === null) return '';
  const h = Math.floor(Math.abs(mins) / 60);
  const m = Math.abs(mins) % 60;
  return `${mins < 0 ? '-' : ''}${h ? `${h} h ` : ''}${m} min`;
}
