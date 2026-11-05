import { useState, type ReactNode } from 'react';
import type { OfficeState } from './reducer';
import type { OfficeEvent } from './types';
import { loadCollapse, setCollapse } from './collapse';
import { IconCall, IconCheck, IconCross, IconMail, IconPlus, IconReply, IconResult, IconWarn } from './icons';

export function describe(e: OfficeEvent, s: OfficeState): { icon: ReactNode; text: string } | null {
  const n = (id?: string) => (id && s.agents[id]?.name) || id || '';
  switch (e.t) {
    case 'agent.spawned': return { icon: <IconPlus />, text: `${e.name} joined (${e.tools.join(', ')})` };
    case 'agent.text': return { icon: null, text: `${n(e.id)}: ${e.text}` };
    case 'tool.call': return { icon: <IconCall />, text: `${n(e.id)} ${e.tool} ${e.inputSummary}` };
    case 'tool.result': return { icon: e.ok ? <IconResult /> : <IconCross />, text: `${n(e.id)} ${e.ok ? 'ok' : 'FAIL'} ${e.summary}` };
    case 'agent.message': return { icon: e.kind === 'reply' ? <IconReply /> : <IconMail />, text: `${n(e.from)} to ${n(e.to)}: ${e.text}` };
    case 'agent.done': return { icon: <IconCheck />, text: `${n(e.id)} done${e.costUsd != null ? ` ($${e.costUsd.toFixed(3)})` : ''}` };
    case 'agent.error': return { icon: <IconCross />, text: `${n(e.id)} ERROR ${e.error}` };
    case 'agent.left': return { icon: <IconCross />, text: `${n(e.id)} left` };
    case 'office.notice': return { icon: <IconWarn />, text: e.text };
    default: return null;
  }
}

export function EventLog({ s }: { s: OfficeState }) {
  const items = s.log.filter((e) => e.t !== 'agent.state').slice(-60).reverse();
  const [collapsed, setCollapsed] = useState(() => loadCollapse().events);
  const toggle = () => setCollapsed(setCollapse('events', !collapsed).events);
  return (
    <aside className="log" data-testid="log">
      <button
        type="button"
        className="collapse-toggle log-collapse"
        data-testid="events-collapse"
        aria-expanded={!collapsed}
        onClick={toggle}
      >
        <span className="collapse-caret" aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
        Events <small>{s.log.length}</small>
      </button>
      {!collapsed && (
        <ol data-testid="events-list">{items.map((e, i) => {
          const d = describe(e, s); if (!d) return null;
          return <li key={s.log.length - i} className={`ev ev-${e.t.replace('.', '-')}`}><time>{new Date(e.ts).toLocaleTimeString([], { hour12: false })}</time><i>{d.icon}</i><span>{d.text}</span></li>;
        })}</ol>
      )}
    </aside>
  );
}
