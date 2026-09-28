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
