import { lazy, Suspense, useCallback, useEffect, useReducer, useState } from 'react';
import { reduce, initialState, type OfficeState } from './reducer';
import { takeToken, connect } from './connection';
import type { OfficeEvent } from './types';
import { UsageBars } from './UsageBars';
import { AgentsPanel } from './AgentsPanel';
import { ResponseLog } from './ResponseLog';
import { SessionPanel } from './SessionPanel';
import { SplitGutter } from './SplitGutter';
import { loadSplit } from './splitPrefs';
import { pickSelected } from './sessionView';
import { IconDot } from './icons';
import { SettingsButton, SettingsPanel } from './Settings';
import { PromptComposer } from './PromptComposer';
const VanphongView = lazy(() => import('./ref-vanphong/VanphongView')); // ported reference visuals, own chunk (see ref-vanphong/NOTICE)
function useNow(ms = 250) { const [n, set] = useState(Date.now()); useEffect(() => { const t = setInterval(() => set(Date.now()), ms); return () => clearInterval(t); }, [ms]); return n; }
export function App() {
  const [boot] = useState(() => takeToken());
  const [s, dispatch] = useReducer(reduce, undefined, () => initialState(boot.token ? 'connecting' : 'no-token'));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [split, setSplit] = useState(loadSplit);
  const onSplit = useCallback((r: number) => setSplit(r), []);
  useEffect(() => {
    if (!boot.token) return;
    return connect(boot.wsUrl, boot.token, (e) => dispatch({ type: 'event', e: e as OfficeEvent }), (status, retries) => dispatch({ type: 'conn', status, retries }));
  }, [boot]);
  const now = useNow();
  const [picked, setPicked] = useState<string>();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const selected = pickSelected(s.sessions, picked);
  const session = s.sessions.find((x) => x.sid === selected);
  return (
    <div className="app">
      <header><h1>Văn phòng ảo <span>· virtual office</span></h1><Conn s={s} />
        <UsageBars u={s.usage} now={now} />
        {boot.token ? <SettingsButton onClick={() => setSettingsOpen(true)} /> : null}
      </header>
      <main style={{ ['--map-frac' as string]: String(split) }}>
        {s.conn === 'no-token' ? <div className="empty">No run token. Open the URL from <code>orchestrator/.run/ui-url.txt</code>.</div>
          : <Suspense fallback={<div className="empty stage3d">Loading Vanphong…</div>}><VanphongView s={s} now={now} /></Suspense>}
        {s.conn !== 'no-token' ? <SplitGutter ratio={split} onChange={onSplit} /> : null}
        <div className="side"><SessionPanel s={s} selected={selected} onSelect={setPicked} now={now} /><ResponseLog s={s} now={now} />
          {boot.token ? <PromptComposer selected={session} token={boot.token} ack={selected ? s.prompts[selected] : undefined} drafts={drafts} setDraft={(sid, text) => setDrafts((d) => ({ ...d, [sid]: text }))} demo={!!session && !session.canSubmit} /> : null}
          <AgentsPanel s={s} selected={selected} /></div>
      </main>
      {settingsOpen && boot.token ? <SettingsPanel token={boot.token} onClose={() => setSettingsOpen(false)} /> : null}
    </div>
  );
}
function Conn({ s }: { s: OfficeState }) {
  const label = { 'no-token': 'no token', connecting: 'connecting…', open: 'live', reconnecting: `reconnecting (try ${s.retries})` }[s.conn];
  return <div className={`conn conn-${s.conn}`} data-testid="conn"><IconDot size={10} />{label}</div>;
}
