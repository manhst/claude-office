import { describe, it, expect } from 'vitest';
import { WINDOW_MS, overPace, paceFraction, resetLabel, resetMs } from '../src/usage';
import { reduce, initialState } from '../src/reducer';
const now = Date.parse('2026-11-05T12:00:00Z');
describe('usage pace marker', () => {
  it('is the elapsed share of the window, from resets_at', () => {
    expect(paceFraction(new Date(now + 2.5 * 3600e3).toISOString(), WINDOW_MS.five_hour, now)).toBeCloseTo(0.5);
    expect(paceFraction(new Date(now + 5 * 3600e3).toISOString(), WINDOW_MS.five_hour, now)).toBeCloseTo(0);
    expect(paceFraction((now + 3.5 * 86400e3) / 1000, WINDOW_MS.seven_day, now)).toBeCloseTo(0.5); // epoch seconds
    expect(paceFraction(now - 1000, WINDOW_MS.five_hour, now)).toBe(1); // already reset: clamped
    expect(paceFraction(now + 9 * 86400e3, WINDOW_MS.seven_day, now)).toBe(0);
    expect(paceFraction(null, WINDOW_MS.five_hour, now)).toBeNull(); expect(paceFraction('bogus', WINDOW_MS.five_hour, now)).toBeNull();
  });
  it('over pace when used share exceeds elapsed share', () => {
    expect(overPace(60, 0.5)).toBe(true); expect(overPace(40, 0.5)).toBe(false); expect(overPace(99, null)).toBe(false);
  });
  it('resets_at formats and compact labels', () => {
    expect(resetMs(String(now))).toBe(now); expect(resetMs(now / 1000)).toBe(now);
    expect(resetLabel(now + 47 * 60e3, now)).toBe('47m'); expect(resetLabel(now + 125 * 60e3, now)).toBe('2h05'); expect(resetLabel(now + (3 * 24 + 4) * 3600e3, now)).toBe('3d4h');
  });
  it('reducer keeps the newest reading', () => {
    const r = (ts: number, pct: number) => ({ t: 'usage.update' as const, ts, usage: { source: 'claude-code' as const, ts, five_hour: { pct, resets_at: null }, seven_day: null, context_pct: null, cost_usd: null } });
    let s = reduce(initialState('open'), { type: 'event', e: r(10, 20) });
    s = reduce(s, { type: 'event', e: r(5, 90) }); expect(s.usage?.five_hour?.pct).toBe(20);
    s = reduce(s, { type: 'event', e: r(11, 30) }); expect(s.usage?.five_hour?.pct).toBe(30); expect(s.log).toHaveLength(0);
  });
});
