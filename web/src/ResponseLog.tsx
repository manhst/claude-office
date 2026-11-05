import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { turnKey, type OfficeState } from './reducer';
import type { TurnView } from './types';
import { loadCollapse, setCollapse } from './collapse';
import { multiSession, turnLines, turnsSig, type TurnLine } from './turnLines';

const hms = (ts: number) => new Date(ts).toLocaleTimeString([], { hour12: false });

/** Claude Code turns as the CLI shows them: `> prompt`, ● text / ● Tool(detail) steps, answer, status. Oldest on top, sticks to the bottom. */
export function ResponseLog({ s, now }: { s: OfficeState; now?: number }) {
  const turns = s.turns;
  const [collapsed, setCollapsed] = useState(() => loadCollapse().responses);
  const toggle = () => setCollapsed(setCollapse('responses', !collapsed).responses);
  const box = useRef<HTMLOListElement>(null), stick = useRef(true);
  const sig = useMemo(() => turnsSig(turns), [turns]), multi = useMemo(() => multiSession(turns), [turns]), sec = now != null ? Math.floor(now / 1000) : undefined;
  useLayoutEffect(() => { const el = box.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [sig, collapsed]);
  const onScroll = () => { const el = box.current; if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24; };
  return (
    <aside className={`log responses${collapsed ? ' collapsed' : ''}`} data-testid="responses">
      <button type="button" className="collapse-toggle log-collapse" data-testid="responses-collapse" aria-expanded={!collapsed} onClick={toggle}>
        <span className="collapse-caret" aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
        Responses <small>{turns.length}</small>
      </button>
      {!collapsed && (
        <ol className="rl" data-testid="responses-list" ref={box} onScroll={onScroll}>
          {!turns.length && <li className="muted">No turns yet. Type a prompt in Claude Code.</li>}
          {turns.map((t) => <Turn key={turnKey(t)} t={t} multi={multi} sec={t.status === 'running' ? sec : undefined} />)}
        </ol>
      )}
    </aside>
  );
}

/** One turn; memoized so clock ticks only re-render running turns (sec is undefined for finished ones). */
const Turn = memo(function Turn({ t, multi, sec }: { t: TurnView; multi: boolean; sec?: number }) {
  const [open, setOpen] = useState(false), flip = () => setOpen((o) => !o);
  const lines = useMemo(() => turnLines(t, { multi, now: sec != null ? sec * 1000 : undefined }), [t, multi, sec]);
  return (
    <li className={`rl-turn rl-${t.status}${t.who ? ' rl-subagent' : ''}`} data-testid="response-turn" data-status={t.status}>
      {lines.map((l, i) => <Line key={i} l={l} open={open} flip={flip} />)}
    </li>
  );
});

function Line({ l, open, flip }: { l: TurnLine; open: boolean; flip: () => void }) {
  switch (l.k) {
    case 'head': return <div className="rl-head"><time>{hms(l.ts)}</time>{l.project && <span className="rl-proj">{l.project}</span>}{l.who && <span className="rl-who">● {l.who}</span>}</div>;
    case 'prompt': return (<>
      <div className={`rl-line rl-prompt${l.long && !open ? ' rl-clamp' : ''}`}><i>&gt;</i><span>{l.text}</span></div>
      {l.long && <button type="button" className="rl-more" aria-expanded={open} onClick={flip}>{open ? '▴ show less' : '▾ show full prompt'}</button>}
    </>);
    case 'text': return <div className="rl-line rl-text"><i>●</i><span>{l.text}</span></div>;
    case 'answer': return <div className="rl-line rl-text rl-answer" data-testid="turn-answer"><i>●</i><span>{l.text}</span></div>;
    case 'tool': return <div className={`rl-line rl-tool${l.isError ? ' rl-tool-err' : ''}`}><i>●</i><span><b>{l.name}</b>{l.detail != null && `(${l.detail})`}</span></div>;
    case 'tool-error': return <div className="rl-line rl-sub rl-err"><i>⎿</i><span>Error</span></div>;
    case 'working': return <div className="rl-line rl-working" data-testid="turn-working"><i>✻</i><span>Working…{l.secs != null && ` (${l.secs}s)`}</span></div>;
    case 'interrupted': return <div className="rl-line rl-sub rl-dim"><i>⎿</i><span>Interrupted</span></div>;
    case 'fail': return <div className="rl-line rl-sub rl-err"><i>⎿</i><span>{l.text}</span></div>;
    case 'duration': return <div className="rl-line rl-dim"><i /><span>{l.text}</span></div>;
    default: return null;
  }
}
