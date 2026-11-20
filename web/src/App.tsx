import { lazy, Suspense, useCallback, useEffect, useMemo, useReducer, useState, type KeyboardEvent } from 'react';
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
import { HistoryView } from './HistoryView';
import { ClaudeConfigView } from './ClaudeConfigView';
import { ModelReportView } from './ModelReportView';
import { loadTab, saveTab, type MainTab, type OpenRequest } from './history';
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
  const [tab, setTabState] = useState<MainTab>(() => boot.token ? loadTab() : 'office');
  const [seen, setSeen] = useState<Record<MainTab, boolean>>(() => ({ office: tab === 'office', history: tab === 'history', claude: tab === 'claude', report: tab === 'report' })); // mount each view on first open, then keep it
  const [focus, setFocus] = useState<Record<MainTab, number>>(() => ({ office: 0, history: 0, claude: 0, report: 0, [tab]: 1 })); // bump = focus the tab's search box (click-opened, not arrow keys)
  const setTab = useCallback((t: MainTab, byKey = false) => { setTabState(t); saveTab(t); setSeen((v) => v[t] ? v : { ...v, [t]: true }); if (!byKey) setFocus((f) => ({ ...f, [t]: f[t] + 1 })); }, []);
  const [openReq, setOpenReq] = useState<OpenRequest>();
  const openSession = useCallback((sid: string) => { setOpenReq((r) => ({ sid, n: (r?.n ?? 0) + 1 })); setTab('history', true); requestAnimationFrame(() => document.getElementById('tab-history')?.focus()); }, [setTab]); // report row → History detail; focus leaves the hidden panel for the tab, not the search box
  const liveKey = s.sessions.map((x) => x.sid).join('\n');
  const live = useMemo(() => new Set(liveKey ? liveKey.split('\n') : []), [liveKey]);
  const hist = !!boot.token && tab === 'history', cc = !!boot.token && tab === 'claude', rep = !!boot.token && tab === 'report', away = hist || cc || rep;
  return (
    <div className="app">
      <header><h1>Văn phòng ảo <span>· virtual office</span></h1>{boot.token ? <ViewTabs tab={tab} onChange={setTab} /> : null}<Conn s={s} />
        <UsageBars u={s.usage} now={now} />
        {boot.token ? <SettingsButton onClick={() => setSettingsOpen(true)} /> : null}
      </header>
      <main style={{ ['--map-frac' as string]: String(split) }} {...(boot.token ? { id: 'panel-office', role: 'tabpanel', 'aria-labelledby': 'tab-office' } : {})} hidden={away}>
        {s.conn === 'no-token' ? <div className="empty">No run token. Open the URL from <code>orchestrator/.run/ui-url.txt</code>.</div>
          : seen.office ? <Suspense fallback={<div className="empty stage3d">Loading Vanphong…</div>}><VanphongView s={s} now={now} paused={away} /></Suspense> : null}
        {s.conn !== 'no-token' ? <SplitGutter ratio={split} onChange={onSplit} /> : null}
        <div className="side"><SessionPanel s={s} selected={selected} onSelect={setPicked} now={now} /><ResponseLog s={s} now={now} />
          {boot.token ? <PromptComposer selected={session} token={boot.token} ack={selected ? s.prompts[selected] : undefined} drafts={drafts} setDraft={(sid, text) => setDrafts((d) => ({ ...d, [sid]: text }))} demo={!!session && !session.canSubmit} /> : null}
          <AgentsPanel s={s} selected={selected} /></div>
      </main>
      {boot.token ? <main id="panel-history" role="tabpanel" aria-labelledby="tab-history" className="hist-main" hidden={!hist}>{seen.history ? <HistoryView token={boot.token} live={live} active={hist} focusTick={focus.history} openReq={openReq} /> : null}</main> : null}
      {boot.token ? <main id="panel-claude" role="tabpanel" aria-labelledby="tab-claude" className="hist-main" hidden={!cc}>{seen.claude ? <ClaudeConfigView token={boot.token} active={cc} focusTick={focus.claude} /> : null}</main> : null}
      {boot.token ? <main id="panel-report" role="tabpanel" aria-labelledby="tab-report" className="hist-main" hidden={!rep}>{seen.report ? <ModelReportView token={boot.token} active={rep} onOpenSession={openSession} /> : null}</main> : null}
      {settingsOpen && boot.token ? <SettingsPanel token={boot.token} onClose={() => setSettingsOpen(false)} /> : null}
    </div>
  );
}
const TABS: [MainTab, string][] = [['office', 'Văn phòng'], ['history', 'Lịch sử'], ['claude', 'Cấu hình Claude'], ['report', 'Hiệu suất']];
/** Header tablist (roving tabindex; arrows/Home/End switch and keep focus on the tab). */
function ViewTabs({ tab, onChange }: { tab: MainTab; onChange: (t: MainTab, byKey?: boolean) => void }) {
  const key = (e: KeyboardEvent) => {
    const i = TABS.findIndex(([t]) => t === tab), n = ({ ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 } as Record<string, number>)[e.key];
    if (n === undefined) return; e.preventDefault();
    const t = TABS[(n + TABS.length) % TABS.length][0]; onChange(t, true); document.getElementById(`tab-${t}`)?.focus();
  };
  return <div className="vtabs" role="tablist" aria-label="View" onKeyDown={key}>{TABS.map(([t, label]) => (
    <button key={t} type="button" role="tab" id={`tab-${t}`} className="vtab" aria-selected={t === tab} aria-controls={`panel-${t}`} tabIndex={t === tab ? 0 : -1} onClick={() => onChange(t)} data-testid={`tab-${t}`}>{label}</button>))}</div>;
}
function Conn({ s }: { s: OfficeState }) {
  const label = { 'no-token': 'no token', connecting: 'connecting…', open: 'live', reconnecting: `reconnecting (try ${s.retries})` }[s.conn];
  return <div className={`conn conn-${s.conn}`} data-testid="conn"><IconDot size={10} />{label}</div>;
}
