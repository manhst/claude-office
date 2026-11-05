// Account-wide Claude usage (5h / 7d limits) as reported by the `office` mod (esp-claude payload shape). Newest ts wins.
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
export class UsageStore {
  latest: UsageReading | null = null;
  /** true when accepted (valid and not older than the stored reading). */
  accept(p: unknown): boolean {
    const r = parseUsage(p); if (!r) return false;
    if (this.latest && r.ts < this.latest.ts) return true; // stale but well-formed: ack, keep newer
    this.latest = r; this.onChange?.(r); return true;
  }
  onChange?: (r: UsageReading) => void;
}
