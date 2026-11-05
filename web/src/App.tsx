import { lazy, Suspense, useEffect, useReducer, useState } from 'react';
import { reduce, initialState, type OfficeState } from './reducer';
import { takeToken, connect } from './connection';
import type { OfficeEvent } from './types';
import { UsageBars } from './UsageBars';
import { EventLog } from './EventLog';
import { SessionPanel } from './SessionPanel';
import { pickSelected } from './sessionView';
import { IconDot } from './icons';
const VanphongView = lazy(() => import('./ref-vanphong/VanphongView')); // ported reference visuals, own chunk (see ref-vanphong/NOTICE)
function useNow(ms = 250) { const [n, set] = useState(Date.now()); useEffect(() => { const t = setInterval(() => set(Date.now()), ms); return () => clearInterval(t); }, [ms]); return n; }
export function App() {
  const [boot] = useState(() => takeToken());
  const [s, dispatch] = useReducer(reduce, undefined, () => initialState(boot.token ? 'connecting' : 'no-token'));
  useEffect(() => {
    if (!boot.token) return;
    return connect(boot.wsUrl, boot.token, (e) => dispatch({ type: 'event', e: e as OfficeEvent }), (status, retries) => dispatch({ type: 'conn', status, retries }));
  }, [boot]);
  const now = useNow();
  const [picked, setPicked] = useState<string>();
  const selected = pickSelected(s.sessions, picked);
  return (
    <div className="app">
      <header><h1>Văn phòng ảo <span>· virtual office</span></h1><Conn s={s} />
        <UsageBars u={s.usage} now={now} /></header>
      <main>
        {s.conn === 'no-token' ? <div className="empty">No run token. Open the URL from <code>orchestrator/.run/ui-url.txt</code>.</div>
          : <Suspense fallback={<div className="empty stage3d">Loading Vanphong…</div>}><VanphongView s={s} now={now} /></Suspense>}
        <div className="side"><SessionPanel s={s} selected={selected} onSelect={setPicked} now={now} /><EventLog s={s} /></div>
      </main>
    </div>
  );
}
function Conn({ s }: { s: OfficeState }) {
  const label = { 'no-token': 'no token', connecting: 'connecting…', open: 'live', reconnecting: `reconnecting (try ${s.retries})` }[s.conn];
  return <div className={`conn conn-${s.conn}`} data-testid="conn"><IconDot size={10} />{label}</div>;
}
