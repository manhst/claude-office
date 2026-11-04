import { lazy, Suspense, useEffect, useReducer, useState } from 'react';
import { reduce, initialState, type OfficeState } from './reducer';
import { takeToken, connect } from './connection';
import type { OfficeEvent } from './types';
import { STATE_COLORS, loadView, saveView, type ViewMode } from './layout';
import { Office2D } from './Office2D';
import { EventLog } from './EventLog';
import { IconCube, IconDot, IconGrid } from './icons';
const Office3D = lazy(() => import('./Office3D')); // separate chunk: three/R3F/drei only load in 3D view
function useNow(ms = 250) { const [n, set] = useState(Date.now()); useEffect(() => { const t = setInterval(() => set(Date.now()), ms); return () => clearInterval(t); }, [ms]); return n; }
const store = typeof localStorage === 'undefined' ? undefined : localStorage;
export function App() {
  const [boot] = useState(() => takeToken());
  const [s, dispatch] = useReducer(reduce, undefined, () => initialState(boot.token ? 'connecting' : 'no-token'));
  const [view, setView] = useState<ViewMode>(() => loadView(store));
  useEffect(() => {
    if (!boot.token) return;
    return connect(boot.wsUrl, boot.token, (e) => dispatch({ type: 'event', e: e as OfficeEvent }), (status, retries) => dispatch({ type: 'conn', status, retries }));
  }, [boot]);
  const now = useNow();
  const pick = (v: ViewMode) => { setView(v); saveView(store, v); };
  return (
    <div className="app">
      <header><h1>Văn phòng ảo <span>· virtual office</span></h1><Conn s={s} />
        <div className="toggle" role="group" aria-label="View">
          <button aria-pressed={view === '2d'} onClick={() => pick('2d')} data-testid="view-2d"><IconGrid />2D</button>
          <button aria-pressed={view === '3d'} onClick={() => pick('3d')} data-testid="view-3d"><IconCube />3D</button>
        </div><Legend /></header>
      <main>
        {s.conn === 'no-token' ? <div className="empty">No run token. Open the URL from <code>orchestrator/.run/ui-url.txt</code>.</div>
          : view === '3d' ? <Suspense fallback={<div className="empty stage3d">Loading 3D…</div>}><Office3D s={s} now={now} /></Suspense>
          : <Office2D s={s} now={now} />}
        <EventLog s={s} />
      </main>
    </div>
  );
}
function Conn({ s }: { s: OfficeState }) {
  const label = { 'no-token': 'no token', connecting: 'connecting…', open: 'live', reconnecting: `reconnecting (try ${s.retries})` }[s.conn];
  return <div className={`conn conn-${s.conn}`} data-testid="conn"><IconDot size={10} />{label}</div>;
}
function Legend() { return <div className="legend">{Object.entries(STATE_COLORS).map(([k, c]) => <span key={k}><i style={{ background: c }} />{k}</span>)}</div>; }
