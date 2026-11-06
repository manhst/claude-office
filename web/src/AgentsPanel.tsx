import { useState } from 'react';
import type { OfficeState } from './reducer';
import { STATE_COLORS } from './layout';
import { loadCollapse, setCollapse } from './collapse';
import { TASK_UNAVAILABLE, countAgents, sessionAgentTree, type AgentRow } from './sessionAgents';
import { IconBranch, IconTool, IconUser } from './icons';

/** Collapsible Agents list for the selected session: desks plus current subagents. */
export function AgentsPanel({ s, selected }: { s: OfficeState; selected?: string }) {
  const rows = sessionAgentTree(s, selected);
  const n = countAgents(rows);
  const [collapsed, setCollapsed] = useState(() => loadCollapse().agents);
  const toggle = () => setCollapsed(setCollapse('agents', !collapsed).agents);
  return (
    <aside className={`log agents${collapsed ? ' collapsed' : ''}`} data-testid="agents">
      <button type="button" className="collapse-toggle log-collapse" data-testid="agents-collapse" aria-expanded={!collapsed} onClick={toggle}>
        <span className="collapse-caret" aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
        Agents <small>{n}</small>
      </button>
      {!collapsed && (
        <ul className="alist" data-testid="agents-list">
          {!selected && <li className="muted">No session selected.</li>}
          {selected && !rows.length && <li className="muted">No agents reported for this session.</li>}
          {rows.map((r) => <Row key={r.key} r={r} />)}
        </ul>
      )}
    </aside>
  );
}

function Row({ r }: { r: AgentRow }) {
  const Icon = r.kind === 'subagent' ? IconBranch : IconUser;
  const meta = [r.kind === 'desk' ? r.model : r.id, r.role].filter(Boolean).join(' · ');
  return (
    <li>
      <div
        className={`arow arow-${r.kind}${r.working ? ' is-working' : ''}`}
        data-testid={`agent-${r.key}`}
        data-kind={r.kind}
        data-status={r.statusKey}
        data-working={r.working ? 'true' : 'false'}
      >
        <i className="sdot" style={{ background: STATE_COLORS[r.statusKey] ?? STATE_COLORS.idle }} />
        <Icon />
        <b>{r.name}</b>
        <span className="st" data-testid="agent-status">{r.statusLabel}</span>
        {meta ? <span className="meta">{meta}</span> : null}
        <span className={`task${r.task === TASK_UNAVAILABLE ? ' none' : ''}`} data-testid="agent-task">{r.task === TASK_UNAVAILABLE ? TASK_UNAVAILABLE : <><IconTool size={12} /> {r.task}</>}</span>
      </div>
      {r.children.length > 0 && <ul className="alist alist-sub">{r.children.map((c) => <Row key={c.key} r={c} />)}</ul>}
    </li>
  );
}
