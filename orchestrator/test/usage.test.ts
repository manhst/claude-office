import { describe, it, expect } from 'vitest';
import { UsageStore, parseUsage } from '../src/usage.js';
import { demoUsage } from '../src/simulate.js';
const body = (ts: number, five: unknown, seven: unknown = null) => ({ type: 'usage', sid: 's', usage: { source: 'claude-code', ts, five_hour: five, seven_day: seven, context_pct: 12, cost_usd: 0.5 } });
describe('usage store', () => {
  it('accepts esp-claude payloads; needs a 5h or 7d reading', () => {
    expect(parseUsage(body(1, { pct: 42, resets_at: '2026-11-05T15:00:00Z' }))?.five_hour).toEqual({ pct: 42, resets_at: '2026-11-05T15:00:00Z' });
    expect(parseUsage(body(1, null, null))).toBeNull(); expect(parseUsage(body(1, { pct: 'x' }))).toBeNull(); expect(parseUsage({ type: 'usage' })).toBeNull();
    expect(parseUsage({ ...body(1, { pct: 1, resets_at: null }), usage: { ...body(1, { pct: 1 }).usage, source: 'evil' } })?.source).toBe('claude-code');
  });
  it('account-wide: newest ts wins, change callback only on accept', () => {
    const s = new UsageStore(); const seen: number[] = []; s.onChange = (u) => seen.push(u.ts);
    expect(s.accept(body(10, { pct: 20, resets_at: null }))).toBe(true);
    expect(s.accept(body(5, { pct: 90, resets_at: null }))).toBe(true); expect(s.latest?.five_hour?.pct).toBe(20);
    expect(s.accept(body(12, null, { pct: 50, resets_at: 1 }))).toBe(true); expect(s.latest?.seven_day?.pct).toBe(50);
    expect(s.accept(body(13, null))).toBe(false); expect(seen).toEqual([10, 12]);
  });
  it('two sessions, one stale: bars stay put (no flip-flop)', () => {
    const now = Date.parse('2026-11-23T07:28:00Z'), r5 = '2026-11-23T10:00:00Z', r7 = '2026-11-27T00:00:00Z', r7old = '2026-11-20T00:00:00Z';
    const s = new UsageStore(); let n = 0; s.onChange = () => n++;
    s.accept(body(100, { pct: 2, resets_at: r5 }, { pct: 15, resets_at: r7 }), now);
    for (let i = 1; i <= 5; i++) { // stale session: no 5h, older 7d numbers (same window, lower pct / older window)
      s.accept(body(100 + i * 2, null, { pct: 11, resets_at: i % 2 ? r7 : r7old }), now);
      s.accept(body(101 + i * 2, { pct: 2, resets_at: r5 }, { pct: 15, resets_at: r7 }), now);
    }
    expect(s.latest?.five_hour?.pct).toBe(2); expect(s.latest?.seven_day?.pct).toBe(15); expect(n).toBe(1);
    s.accept(body(200, { pct: 3, resets_at: r5 }, null), now); expect(s.latest?.five_hour?.pct).toBe(3); expect(n).toBe(2); // usage grows
    s.accept(body(201, { pct: 1, resets_at: '2026-11-23T15:00:00Z' }, null), now); expect(s.latest?.five_hour?.pct).toBe(1); // new 5h window
    s.accept(body(202, null, { pct: 9 }), Date.parse(r7) + 1); expect(s.latest?.five_hour).toBeNull(); // expired windows clear
  });
  it('demo usage is labelled demo', () => { const u = parseUsage(demoUsage(Date.now(), 3)); expect(u?.source).toBe('demo'); expect(u?.five_hour?.pct).toBe(24); });
});
