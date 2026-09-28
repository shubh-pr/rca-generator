import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatMinutes, isoToIstInput, istInputToIso, todayIst } from './dates';

describe('IST date helpers', () => {
  it('formats UTC timestamps in IST', () => {
    expect(formatDateTime('2026-09-27T08:35:00.000Z')).toBe('27 Sep 2026, 14:05 IST');
  });

  it('round-trips datetime-local values as IST', () => {
    expect(isoToIstInput('2026-09-27T08:35:00.000Z')).toBe('2026-09-27T14:05');
    expect(istInputToIso('2026-09-27T14:05')).toBe('2026-09-27T14:05:00+05:30');
    expect(new Date(istInputToIso('2026-09-27T14:05')!).toISOString()).toBe('2026-09-27T08:35:00.000Z');
  });

  it('formats date-only values without shifting the day', () => {
    expect(formatDate('2026-09-28')).toBe('28 Sep 2026');
  });

  it('computes today in IST across the UTC day boundary', () => {
    expect(todayIst(new Date('2026-09-27T20:00:00Z'))).toBe('2026-09-28');
  });

  it('formats durations', () => {
    expect(formatMinutes(85)).toBe('1 h 25 min');
    expect(formatMinutes(40)).toBe('40 min');
    expect(formatMinutes(null)).toBe('');
  });
});
