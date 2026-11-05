// Pure helpers for the Claude usage bars in the header (5h and 7d limits).
import type { UsageWindow } from './types';
export const WINDOW_MS = { five_hour: 5 * 3600e3, seven_day: 7 * 86400e3 } as const;
/** resets_at as ms epoch: ISO string, epoch seconds or epoch ms. */
export function resetMs(r: UsageWindow['resets_at']): number | null {
  if (r == null) return null;
  if (typeof r === 'number') return Number.isFinite(r) ? (r < 1e12 ? r * 1000 : r) : null;
  const n = Number(r); if (r.trim() && Number.isFinite(n)) return resetMs(n);
  const t = Date.parse(r); return Number.isFinite(t) ? t : null;
}
/** Pace marker: fraction of the window already elapsed (0..1). Usage past it means burning faster than the limit sustains. */
export function paceFraction(resetsAt: UsageWindow['resets_at'], windowMs: number, now: number): number | null {
  const end = resetMs(resetsAt); if (end === null) return null;
  return Math.max(0, Math.min(1, 1 - (end - now) / windowMs));
}
/** Compact time until reset: "2h05", "47m", "3d4h". */
export function resetLabel(resetsAt: UsageWindow['resets_at'], now: number): string {
  const end = resetMs(resetsAt); if (end === null) return '';
  const m = Math.max(0, Math.round((end - now) / 60e3));
  if (m < 60) return `${m}m`;
  if (m < 24 * 60) return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
  return `${Math.floor(m / 1440)}d${Math.floor((m % 1440) / 60)}h`;
}
export const overPace = (pct: number, pace: number | null) => pace !== null && pct / 100 > pace;
