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
  it('demo usage is labelled demo', () => { const u = parseUsage(demoUsage(Date.now(), 3)); expect(u?.source).toBe('demo'); expect(u?.five_hour?.pct).toBe(24); });
});
