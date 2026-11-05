import type { OfficeState } from './reducer';
import type { SessionView } from './types';
import { STATE_COLORS } from './layout';
import { STATE_KEY, STATE_LABEL, activeSubagents, agoLabel } from './sessionView';
import { IconBranch, IconTerminal, IconTool } from './icons';
/** Lists every active session the `office` mod reported; the selected one shows its live activity (agent profiles are not shown). */
export function SessionPanel({ s, selected, onSelect, now }: { s: OfficeState; selected?: string; onSelect: (sid: string) => void; now: number }) {
  const cur = s.sessions.find((x) => x.sid === selected);
  return (
    <section className="sessions" data-testid="sessions">
      <h2>Sessions <small>{s.sessions.length}</small></h2>
      {!s.sessions.length && <div className="muted">No active Claude Code sessions. Install the <code>office</code> mod and open a session.</div>}
      <ul>{s.sessions.map((x) => (
        <li key={x.sid}><button className={`sess ${x.sid === selected ? 'sel' : ''}`} onClick={() => onSelect(x.sid)} data-testid={`session-${x.sid}`} aria-pressed={x.sid === selected}>
          <i className="sdot" style={{ background: STATE_COLORS[STATE_KEY[x.state]] }} /><IconTerminal />
          <b>{x.project}</b><span className="st">{STATE_LABEL[x.state]}</span>
          <span className="sub">{x.title ?? x.prompt ?? x.sid.slice(0, 8)}</span>
        </button></li>))}</ul>
      {cur && <Detail x={cur} now={now} />}
    </section>
  );
}
function Detail({ x, now }: { x: SessionView; now: number }) {
  const subs = activeSubagents(x);
  return (
    <div className="sdetail" data-testid="session-detail">
      <div className="kv"><span>Project</span><b title={x.cwd}>{x.project}</b></div>
      {x.title && <div className="kv"><span>Title</span><b>{x.title}</b></div>}
      <div className="kv"><span>State</span><b style={{ color: STATE_COLORS[STATE_KEY[x.state]] }}>{STATE_LABEL[x.state]}</b><em>{agoLabel(x.lastSeen, now)}</em></div>
      {x.tool && <div className="kv"><span>Tool</span><b className="mono"><IconTool size={12} /> {x.tool.name}{x.tool.detail ? ` · ${x.tool.detail}` : ''}</b></div>}
      {x.prompt && <div className="kv"><span>Prompt</span><b>{x.prompt}</b></div>}
      {subs.length > 0 && <div className="kv"><span>Subagents</span><b>{subs.map((a, i) => <span key={i} className="tag"><IconBranch size={12} />{a.type ?? 'agent'}{a.description ? `: ${a.description}` : ''}</span>)}</b></div>}
      {x.costUsd != null && <div className="kv"><span>Cost</span><b>${x.costUsd.toFixed(3)}</b></div>}
    </div>
  );
}
