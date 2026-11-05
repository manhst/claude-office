import { useState } from 'react';
import type { OfficeState } from './reducer';
import type { SessionView } from './types';
import { STATE_COLORS } from './layout';
import { STATE_KEY, STATE_LABEL, sessionDumpRows } from './sessionView';
import { loadCollapse, setCollapse } from './collapse';
import { IconBranch, IconTerminal, IconTool } from './icons';

/** Lists every active session the `office` mod reported; selected session shows a CLI-like field dump (no agent MD bodies). */
export function SessionPanel({ s, selected, onSelect, now }: { s: OfficeState; selected?: string; onSelect: (sid: string) => void; now: number }) {
  const cur = s.sessions.find((x) => x.sid === selected);
  const [collapsed, setCollapsed] = useState(() => loadCollapse().session);
  const toggle = () => setCollapsed(setCollapse('session', !collapsed).session);
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
      {cur && (
        <div className="sdetail" data-testid="session-detail">
          <button
            type="button"
            className="collapse-toggle"
            data-testid="session-collapse"
            aria-expanded={!collapsed}
            onClick={toggle}
          >
            <span className="collapse-caret" aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
            Session <small>{STATE_LABEL[cur.state]} · {cur.sid.slice(0, 12)}</small>
          </button>
          {!collapsed && <Detail x={cur} now={now} />}
        </div>
      )}
    </section>
  );
}

function Detail({ x, now }: { x: SessionView; now: number }) {
  const rows = sessionDumpRows(x, now);
  return (
    <ol className="sdump" data-testid="session-dump">
      {rows.map((r) => (
        <li key={r.key} className="kv" data-testid={`dump-${r.key}`}>
          <span>{r.label}</span>
          {r.lines ? (
            <b className={r.mono ? 'mono dump-lines' : 'dump-lines'}>
              {r.key === 'subagents' && <IconBranch size={12} />}
              {r.lines.map((line, i) => <div key={i}>{line}</div>)}
            </b>
          ) : (
            <b className={r.mono ? 'mono' : undefined}>
              {r.key === 'tool' && <IconTool size={12} />}
              {r.value}
            </b>
          )}
        </li>
      ))}
    </ol>
  );
}
