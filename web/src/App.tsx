import { useEffect, useReducer, useState } from 'react';
import { reduce, initialState, type AgentUI, type OfficeState } from './reducer';
import { takeToken, connect } from './connection';
import type { OfficeEvent } from './types';
const CELL_W = 290, CELL_H = 250, PAD = 30, MSG_MS = 4000, BUBBLE_MS = 8000;
const STATE_COLORS: Record<string, string> = { idle: '#94a3b8', thinking: '#a78bfa', working: '#f59e0b', talking: '#38bdf8', done: '#22c55e', error: '#ef4444' };
const center = (d: { x: number; y: number }) => ({ x: PAD + d.x * CELL_W + CELL_W / 2, y: PAD + d.y * CELL_H + 135 });
function useNow(ms = 250) { const [n, set] = useState(Date.now()); useEffect(() => { const t = setInterval(() => set(Date.now()), ms); return () => clearInterval(t); }, [ms]); return n; }

export function App() {
  const [boot] = useState(() => takeToken());
  const [s, dispatch] = useReducer(reduce, undefined, () => initialState(boot.token ? 'connecting' : 'no-token'));
  useEffect(() => {
    if (!boot.token) return;
    return connect(boot.wsUrl, boot.token, (e) => dispatch({ type: 'event', e: e as OfficeEvent }), (status, retries) => dispatch({ type: 'conn', status, retries }));
  }, [boot]);
  const now = useNow();
  return (
    <div className="app">
      <header><h1>Văn phòng ảo <span>· virtual office</span></h1><Conn s={s} /><Legend /></header>
      <main>
        {s.conn === 'no-token' ? <div className="empty">No run token. Open the URL from <code>orchestrator/.run/ui-url.txt</code>.</div> : <Office s={s} now={now} />}
        <EventLog s={s} />
      </main>
    </div>
  );
}
function Conn({ s }: { s: OfficeState }) {
  const label = { 'no-token': 'no token', connecting: 'connecting…', open: 'live', reconnecting: `reconnecting (try ${s.retries})` }[s.conn];
  return <div className={`conn conn-${s.conn}`} data-testid="conn">● {label}</div>;
}
function Legend() { return <div className="legend">{Object.entries(STATE_COLORS).map(([k, c]) => <span key={k}><i style={{ background: c }} />{k}</span>)}</div>; }
function Office({ s, now }: { s: OfficeState; now: number }) {
  const agents = s.order.map((id) => s.agents[id]).filter(Boolean);
  const rows = Math.max(1, ...agents.map((a) => a.desk.y + 1)); const cols = 3;
  const W = PAD * 2 + cols * CELL_W, H = PAD * 2 + rows * CELL_H;
  const live = s.messages.filter((m) => now - m.ts < MSG_MS && s.agents[m.from] && s.agents[m.to]);
  return (
    <section className="office" style={{ width: W, height: H }} data-testid="office">
      {Array.from({ length: rows * cols }, (_, i) => <div key={i} className="desk-slot" style={{ left: PAD + (i % cols) * CELL_W + 10, top: PAD + Math.floor(i / cols) * CELL_H + 10, width: CELL_W - 20, height: CELL_H - 20 }} />)}
      <svg className="wires" width={W} height={H}>
        <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" fill="#38bdf8" /></marker></defs>
        {live.map((m, i) => { const a = center(s.agents[m.from].desk), b = center(s.agents[m.to].desk); const bend = m.kind === 'reply' ? 40 : -40;
          return <path key={i} d={`M${a.x},${a.y} Q${(a.x + b.x) / 2},${(a.y + b.y) / 2 + bend} ${b.x},${b.y}`} className={`wire wire-${m.kind}`} markerEnd="url(#arrow)" />; })}
      </svg>
      {live.map((m, i) => { const a = center(s.agents[m.from].desk), b = center(s.agents[m.to].desk);
        return <div key={i} className={`envelope env-${m.kind}`} style={{ left: (a.x + b.x) / 2 - 110, top: (a.y + b.y) / 2 + (m.kind === 'reply' ? 55 : 15) }}>{m.kind === 'ask' ? '✉ ' : '↩ '}{m.text}</div>; })}
      {agents.map((a) => <Desk key={a.id} a={a} now={now} />)}
      {!agents.length && <div className="empty">Waiting for agents…</div>}
    </section>
  );
}
function Desk({ a, now }: { a: AgentUI; now: number }) {
  const c = center(a.desk);
  const showBubble = a.text && a.textTs && (now - a.textTs < BUBBLE_MS || a.state === 'talking');
  return (
    <div className={`agent st-${a.state}`} style={{ left: c.x - CELL_W / 2 + 20, top: c.y - 45 }} data-testid={`agent-${a.role}`} data-state={a.state}>
      {showBubble && <div className="bubble">{a.text}</div>}
      <div className="avatar" style={{ background: STATE_COLORS[a.state] }}>{a.state === 'thinking' ? '…' : a.name[0]}</div>
      <div className="name">{a.name} <small>{a.state}</small></div>
      {a.tool && a.state !== 'done' && <div className={`chip ${a.tool.ok === false ? 'chip-bad' : a.tool.ok ? 'chip-ok' : ''}`} title={a.tool.summary}>🔧 {a.tool.name}{a.tool.ok === undefined ? '…' : a.tool.ok ? ' ✓' : ' ✗'}</div>}
      {a.state === 'done' && a.result && <div className="result">✓ {a.result}{a.costUsd != null && <em> ${a.costUsd.toFixed(3)}</em>}</div>}
      {a.state === 'error' && <div className="result err">✗ {a.error}</div>}
      <div className="desk-top" />
    </div>
  );
}
function describe(e: OfficeEvent, s: OfficeState): string {
  const n = (id?: string) => (id && s.agents[id]?.name) || id || '';
  switch (e.t) {
    case 'agent.spawned': return `${e.name} joined (${e.tools.join(', ')})`;
    case 'agent.state': return `${n(e.id)} → ${e.state}`;
    case 'agent.text': return `${n(e.id)}: ${e.text}`;
    case 'tool.call': return `${n(e.id)} ▶ ${e.tool} ${e.inputSummary}`;
    case 'tool.result': return `${n(e.id)} ◀ ${e.ok ? 'ok' : 'FAIL'} ${e.summary}`;
    case 'agent.message': return `${n(e.from)} ${e.kind === 'reply' ? '↩' : '✉'} ${n(e.to)}: ${e.text}`;
    case 'agent.done': return `${n(e.id)} done${e.costUsd != null ? ` ($${e.costUsd.toFixed(3)})` : ''}`;
    case 'agent.error': return `${n(e.id)} ERROR ${e.error}`;
    case 'office.notice': return `⚠ ${e.text}`;
    default: return e.t;
  }
}
function EventLog({ s }: { s: OfficeState }) {
  const items = s.log.filter((e) => e.t !== 'agent.state').slice(-60).reverse();
  return (
    <aside className="log" data-testid="log"><h2>Events <small>{s.log.length}</small></h2>
      <ol>{items.map((e, i) => <li key={s.log.length - i} className={`ev ev-${e.t.replace('.', '-')}`}><time>{new Date(e.ts).toLocaleTimeString([], { hour12: false })}</time><span>{describe(e, s)}</span></li>)}</ol>
    </aside>
  );
}
