import { useState } from 'react';
import type { OfficeState } from './reducer';
import { loadCollapse, setCollapse } from './collapse';
import { listResponses } from './responseLog';
import { IconCheck, IconCross, IconResult } from './icons';

export function ResponseLog({ s }: { s: OfficeState }) {
  const nameOf = (id: string) => s.agents[id]?.name || id;
  const items = listResponses(s.log, nameOf);
  const [collapsed, setCollapsed] = useState(() => loadCollapse().responses);
  const toggle = () => setCollapsed(setCollapse('responses', !collapsed).responses);
  return (
    <aside className="log responses" data-testid="responses">
      <button
        type="button"
        className="collapse-toggle log-collapse"
        data-testid="responses-collapse"
        aria-expanded={!collapsed}
        onClick={toggle}
      >
        <span className="collapse-caret" aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
        Responses <small>{items.length}</small>
      </button>
      {!collapsed && (
        <ol data-testid="responses-list">
          {!items.length && <li className="muted ev">No agent responses yet.</li>}
          {items.map((r) => (
            <li key={r.key} className={`ev ev-response ev-${r.kind}`} data-testid={`response-${r.kind}`}>
              <time>{new Date(r.ts).toLocaleTimeString([], { hour12: false })}</time>
              <i>{r.kind === 'done' ? <IconCheck /> : r.kind === 'error' ? <IconCross /> : r.kind === 'tool' ? (r.ok === false ? <IconCross /> : <IconResult />) : null}</i>
              <span>{r.body}</span>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
