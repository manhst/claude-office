import type { AgentUI, OfficeState } from './reducer';
import { BUBBLE_MS, MSG_MS, STATE_COLORS, cardPosition } from './layout';
import { IconCheck, IconCross, IconMail, IconReply, IconTool } from './icons';
import { agentKey, type Looks } from './town/looks';
import { Chibi } from './town/Avatar';
const CELL_W = 290, CELL_H = 250, LANE = 70, PAD = 24, CARD_W = 220;
const rowTop = (y: number) => PAD + LANE + y * (CELL_H + LANE);
export const center = (d: { x: number; y: number }) => ({ x: PAD + d.x * CELL_W + CELL_W / 2, y: rowTop(d.y) + 135 });
export interface Office2DExtras { hidden?: Set<string>; looks?: Looks; onMenu?: (a: AgentUI, x: number, y: number) => void }
export function Office2D({ s, now, selected, onSelect, hidden, looks, onMenu }: { s: OfficeState; now: number; selected?: string; onSelect?: (sid: string) => void } & Office2DExtras) {
  const project = (a: AgentUI) => s.sessions.find((x) => x.sid === a.sessionId)?.project;
  const all = s.order.map((id) => s.agents[id]).filter(Boolean); const agents = all.filter((a) => !hidden?.has(a.id));
  const rows = Math.max(1, ...all.map((a) => a.desk.y + 1)), cols = 3;
  const W = PAD * 2 + cols * CELL_W, H = rowTop(rows) - LANE + PAD;
  const live = s.messages.filter((m) => now - m.ts < MSG_MS && s.agents[m.from] && s.agents[m.to]);
  const perRow: Record<number, number> = {};
  const cards = live.map((m) => {
    const fa = s.agents[m.from], ta = s.agents[m.to]; const a = center(fa.desk), b = center(ta.desk);
    const row = Math.min(fa.desk.y, ta.desk.y); const idx = (perRow[row] = (perRow[row] ?? -1) + 1);
    const pos = cardPosition(a, b, rowTop(row), idx, CARD_W);
    return { m, a, b, pos, anchor: { x: pos.left + CARD_W / 2, y: pos.top + 30 } };
  });
  return (
    <section className="office" style={{ width: W, height: H }} data-testid="office">
      {Array.from({ length: rows * cols }, (_, i) => <div key={i} className="desk-slot" style={{ left: PAD + (i % cols) * CELL_W + 10, top: rowTop(Math.floor(i / cols)) + 10, width: CELL_W - 20, height: CELL_H - 20 }} />)}
      <svg className="wires" width={W} height={H}>
        <defs>{(['ask', 'reply'] as const).map((k) => <marker key={k} id={`arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" className={`arrowhead-${k}`} /></marker>)}</defs>
        {cards.map(({ m, a, b, anchor }, i) => <path key={i} d={`M${a.x},${a.y - 50} Q${anchor.x},${anchor.y - 30} ${b.x},${b.y - 50}`} className={`wire wire-${m.kind}`} markerEnd={`url(#arrow-${m.kind})`} />)}
      </svg>
      {cards.map(({ m, pos }, i) => <div key={i} className={`envelope env-${m.kind}`} style={{ left: pos.left, top: pos.top, width: CARD_W }} data-testid="msg-card">
        {m.kind === 'ask' ? <IconMail /> : <IconReply />}<span>{m.text}</span></div>)}
      {agents.map((a) => <Desk key={a.id} a={a} now={now} ident={looks?.[agentKey(a)]} onMenu={onMenu ? (x, y) => onMenu(a, x, y) : undefined} c={center(a.desk)} project={project(a)} sel={!!selected && a.sessionId === selected} onClick={a.sessionId && onSelect ? () => onSelect(a.sessionId!) : undefined} />)}
      {!all.length && <div className="empty">Waiting for Claude Code sessions…</div>}
    </section>
  );
}
export function ToolChip({ a }: { a: AgentUI }) {
  if (!a.tool || a.state === 'done') return null;
  const t = a.tool;
  return <div className={`chip ${t.ok === false ? 'chip-bad' : t.ok ? 'chip-ok' : ''}`} title={t.summary}>
    <IconTool size={12} />{t.name}{t.ok === undefined ? <span className="spin" /> : t.ok ? <IconCheck size={12} /> : <IconCross size={12} />}</div>;
}
function Desk({ a, now, c, project, sel, onClick, ident, onMenu }: { a: AgentUI; now: number; c: { x: number; y: number }; project?: string; sel?: boolean; onClick?: () => void; ident?: { name?: string; look?: string }; onMenu?: (x: number, y: number) => void }) {
  const showBubble = a.text && a.textTs && (now - a.textTs < BUBBLE_MS || a.state === 'talking');
  return (
    <div className={`agent st-${a.state}${sel ? ' sel' : ''}`} onClick={onClick} onContextMenu={onMenu ? (ev) => { ev.preventDefault(); onMenu(ev.clientX, ev.clientY); } : undefined} style={{ left: c.x - 125, top: c.y - 45 }} data-testid={`agent-${a.role}`} data-state={a.state}>
      {showBubble && <div className="bubble">{a.text}</div>}
      <div className="avatar" style={{ background: STATE_COLORS[a.state] }}>{ident?.look ? <Chibi id={ident.look} size={50} /> : a.state === 'thinking' ? <span className="dots"><i /><i /><i /></span> : (ident?.name ?? a.name)[0]}</div>
      <div className="name">{ident?.name ?? a.name} <small>{ident?.name ? `${a.name} · ` : ''}{a.state}</small></div>
      {project && <div className="proj">{project}</div>}
      <ToolChip a={a} />
      <div className="desk-top" />
      {a.state === 'done' && a.result && <div className="result" title={a.result}><IconCheck size={12} /><span className="clamp">{a.result}{a.costUsd != null && <em> ${a.costUsd.toFixed(3)}</em>}</span></div>}
      {a.state === 'error' && <div className="result err" title={a.error}><IconCross size={12} /><span className="clamp">{a.error}</span></div>}
    </div>
  );
}
