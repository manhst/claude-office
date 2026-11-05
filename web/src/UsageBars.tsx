import type { UsageReading, UsageWindow } from './types';
import { WINDOW_MS, overPace, paceFraction, resetLabel } from './usage';
const IconGauge = () => <svg className="icon" width={13} height={13} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden><path d="M2.5 11a5.5 5.5 0 1 1 11 0" /><path d="M8 11l2.6-3.4" /></svg>;
/** Header: Claude usage, 5h and 7d bars, each with a red pace line (share of the window already elapsed). */
export function UsageBars({ u, now }: { u?: UsageReading | null; now: number }) {
  if (!u) return <div className="usage" data-testid="usage"><IconGauge /><span className="muted">Claude usage: chưa có số liệu</span></div>;
  return (
    <div className="usage" data-testid="usage" title={u.cost_usd != null ? `cost $${u.cost_usd}` : undefined}>
      <IconGauge />{u.source === 'demo' && <span className="usage-demo">demo</span>}
      <Bar label="5h" w={u.five_hour} win={WINDOW_MS.five_hour} now={now} />
      <Bar label="7d" w={u.seven_day} win={WINDOW_MS.seven_day} now={now} />
    </div>
  );
}
function Bar({ label, w, win, now }: { label: string; w: UsageWindow | null; win: number; now: number }) {
  if (!w) return <div className="ubar" data-testid={`usage-${label}`}><b>{label}</b><span className="muted">—</span></div>;
  const pace = paceFraction(w.resets_at, win, now), over = overPace(w.pct, pace), r = resetLabel(w.resets_at, now);
  return (
    <div className={`ubar${over ? ' over' : ''}`} data-testid={`usage-${label}`} title={pace !== null ? `${label}: ${w.pct}% used · pace ${Math.round(pace * 100)}% · resets in ${r}` : undefined}>
      <b>{label}</b>
      <span className="ubar-track"><i style={{ width: `${Math.min(100, w.pct)}%` }} />{pace !== null && <em className="ubar-pace" data-testid={`pace-${label}`} style={{ left: `${pace * 100}%` }} />}</span>
      <span className="ubar-num">{Math.round(w.pct)}%</span>{r && <small>↻{r}</small>}
    </div>
  );
}
