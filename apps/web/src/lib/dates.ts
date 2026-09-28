// All timestamps are stored in UTC and displayed in IST (Asia/Kolkata), per SPEC 4 and 8.

const IST = 'Asia/Kolkata';

// Fixed month names: ICU versions disagree on "Sep" vs "Sept".
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "27 Sep 2026, 14:05 IST" */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const [date, time] = isoToIstInput(iso).split('T');
  return `${formatDate(date)}, ${time} IST`;
}

/** Date-only "YYYY-MM-DD" -> "28 Sep 2026" (no time-zone shift). */
export function formatDate(ymd: string | null | undefined): string {
  if (!ymd) return '';
  const [y, m, d] = ymd.slice(0, 10).split('-');
  return `${d} ${MONTHS[Number(m) - 1]} ${y}`;
}

/** UTC ISO -> value for <input type="datetime-local"> expressed in IST ("2026-09-27T14:05"). */
export function isoToIstInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: IST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`;
}

/** <input type="datetime-local"> value typed in IST -> ISO string with +05:30 offset. */
export function istInputToIso(value: string): string | null {
  if (!value) return null;
  return `${value.length === 16 ? `${value}:00` : value}+05:30`;
}

/** Today's date in IST as YYYY-MM-DD. */
export function todayIst(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: IST }).format(now);
}

/** "1 h 25 min" from minutes. */
export function formatMinutes(mins: number | null | undefined): string {
  if (mins === null || mins === undefined) return '';
  const h = Math.floor(Math.abs(mins) / 60);
  const m = Math.abs(mins) % 60;
  const sign = mins < 0 ? '-' : '';
  if (h === 0) return `${sign}${m} min`;
  return `${sign}${h} h ${m} min`;
}
