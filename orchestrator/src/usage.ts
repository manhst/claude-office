// Account-wide Claude usage (5h / 7d limits) as reported by the `deck` mod (esp-claude payload shape). Newest ts wins.
import type { UsageReading, UsageWindow } from './types.js';
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
function win(w: any): UsageWindow | null {
  if (!w || typeof w !== 'object') return null;
  const pct = num(w.pct); if (pct === null) return null;
  const r = w.resets_at; const resets_at = typeof r === 'string' ? r.slice(0, 40) : num(r);
  return { pct: Math.max(0, Math.min(1000, pct)), resets_at };
}
/** Validates a POSTed { type: 'usage', usage } body. Returns null when it has no 5h/7d reading. */
export function parseUsage(p: any): UsageReading | null {
  const u = p?.usage; if (!u || typeof u !== 'object') return null;
  const ts = num(u.ts); if (ts === null) return null;
  const r: UsageReading = { source: u.source === 'demo' ? 'demo' : 'claude-code', ts, five_hour: win(u.five_hour), seven_day: win(u.seven_day), context_pct: num(u.context_pct), cost_usd: num(u.cost_usd) };
  return r.five_hour || r.seven_day ? r : null;
}
/** resets_at as epoch ms (ISO string, epoch s or epoch ms), or null when unknown. */
export function resetMs(w: UsageWindow | null | undefined): number | null {
  const r = w?.resets_at; if (r == null) return null;
  if (typeof r === 'number') return r < 1e12 ? r * 1000 : r;
  const t = Date.parse(r); return Number.isFinite(t) ? t : null;
}
const SAME_WINDOW_MS = 60_000;
/** One limit window from two readings. Every open session reports, and an idle one keeps sending its last (stale) numbers with a fresh ts,
 *  so newest-ts-wins made the bars flip. A later resets_at is a newer window; within the same window usage only grows, so the higher pct wins;
 *  a reading without this window never clears a stored one that hasn't expired. */
export function mergeWindow(cur: UsageWindow | null, inc: UsageWindow | null, now: number, incNewer = true): UsageWindow | null {
  const cr = resetMs(cur), ir = resetMs(inc);
  const curLive = !!cur && (cr === null || cr > now);
  if (!inc) return curLive ? cur : null;
  if (!curLive) return inc;
  if (cr === null || ir === null) return incNewer ? inc : cur; // no reset time: can't tell windows apart, newest reading wins
  if (ir > cr + SAME_WINDOW_MS) return inc;
  if (ir < cr - SAME_WINDOW_MS) return cur;
  return inc.pct >= cur!.pct ? inc : cur;
}
const same = (a: UsageWindow | null, b: UsageWindow | null) => a?.pct === b?.pct && a?.resets_at === b?.resets_at;
export class UsageStore {
  latest: UsageReading | null = null;
  /** true when accepted (valid). 5h/7d are merged per window (see mergeWindow); context/cost follow the newest reading. onChange fires only when something shown changes. */
  accept(p: unknown, now = Date.now()): boolean {
    const r = parseUsage(p); if (!r) return false;
    const cur = this.latest;
    if (!cur) { this.latest = r; this.onChange?.(r); return true; }
    const newer = r.ts >= cur.ts;
    const next: UsageReading = { ...(newer ? r : cur), ts: Math.max(r.ts, cur.ts), five_hour: mergeWindow(cur.five_hour, r.five_hour, now, newer), seven_day: mergeWindow(cur.seven_day, r.seven_day, now, newer) };
    if (!next.five_hour && !next.seven_day) return true;
    const changed = !same(cur.five_hour, next.five_hour) || !same(cur.seven_day, next.seven_day) || cur.source !== next.source || (newer && (cur.context_pct !== next.context_pct || cur.cost_usd !== next.cost_usd));
    this.latest = next; if (changed) this.onChange?.(next); return true;
  }
  onChange?: (r: UsageReading) => void;
}
