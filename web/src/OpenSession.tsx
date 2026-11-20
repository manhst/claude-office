import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { HistoryOpener, HistoryOpenerId } from './types';
import { HistoryHttpError, openSession } from './historyApi';
import { isOpenConfirm, loadOpener, OPEN_SLOW_MS, openedText, openErrorText, openerHint, pickOpener, saveOpener } from './history';
import type { Ask } from './Confirm';

export type OpenMsg = { kind: 'ok' | 'err'; text: string };
/** "Reopen" state for one session: last-used app, busy flag, inline status, the app label once a launch is slow (≥3 s: maybe the macOS
 *  Automation prompt), and the confirm the server asks for (409 confirm-required: live or just-written session → its reason, resend with confirm:true). */
export function useOpenSession(token: string, sid: string, openers: readonly HistoryOpener[]) {
  const [last, setLast] = useState(loadOpener), [busy, setBusy] = useState(false), [slow, setSlow] = useState<string>(), [msg, setMsg] = useState<OpenMsg>(), [ask, setAsk] = useState<Ask>();
  const alive = useRef(true), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), slowT = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), inFlight = useRef(false);
  useEffect(() => () => { alive.current = false; clearTimeout(timer.current); clearTimeout(slowT.current); }, []);
  const open = useCallback((app: HistoryOpenerId, confirm = false) => {
    if (inFlight.current) return; // one launch at a time from this pane (the server also answers 409 busy)
    const label = openers.find((o) => o.id === app)?.label ?? app;
    inFlight.current = true; saveOpener(app); setLast(app); setBusy(true); setMsg(undefined); clearTimeout(timer.current);
    clearTimeout(slowT.current); slowT.current = setTimeout(() => setSlow(label), OPEN_SLOW_MS);
    openSession(token, { sid, app, ...(confirm ? { confirm: true } : {}) }).then((r) => {
      if (!alive.current) return;
      setMsg({ kind: 'ok', text: openedText(r, label) }); timer.current = setTimeout(() => setMsg(undefined), r.note ? 12_000 : 6000);
    }, (e) => {
      if (!alive.current) return;
      const h = e instanceof HistoryHttpError ? e : undefined;
      if (!confirm && isOpenConfirm(h?.error)) setAsk({ title: 'Open another window?', body: h?.reason ?? 'This session is running in Claude Deck.', ok: 'Open anyway', cancel: 'Cancel', run: () => open(app, true) });
      else setMsg({ kind: 'err', text: openErrorText(h?.status ?? 0, h?.error, h?.reason) });
    }).finally(() => { inFlight.current = false; clearTimeout(slowT.current); if (alive.current) { setBusy(false); setSlow(undefined); } });
  }, [token, sid, openers]);
  return { cur: pickOpener(openers, last), busy, slow, msg, ask, closeAsk: useCallback(() => setAsk(undefined), []), open };
}

/** Split button: the main part opens with the last-used app; ▾ is a menu button (WAI-ARIA pattern: ↓/↑/Enter/Space open it on the current app,
 *  ↑/↓/Home/End move, Enter/Space pick, Esc closes back to ▾, Tab or a click outside closes). Picking an app makes it the default.
 *  While busy both halves are aria-disabled and ignore clicks (not `disabled`, which would drop the focus to <body>). */
export function OpenButton({ openers, cur, busy, onOpen }: { openers: readonly HistoryOpener[]; cur: HistoryOpener; busy: boolean; onOpen: (app: HistoryOpenerId) => void }) {
  const [at, setAt] = useState<number>(), id = useId(), wrap = useRef<HTMLDivElement>(null), btn = useRef<HTMLButtonElement>(null), items = useRef<(HTMLButtonElement | null)[]>([]);
  const shown = at !== undefined, n = openers.length, home = Math.max(0, openers.findIndex((o) => o.id === cur.id));
  useEffect(() => { if (at !== undefined) items.current[at]?.focus(); }, [at]);
  useEffect(() => {
    if (!shown) return;
    const down = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setAt(undefined); };
    document.addEventListener('mousedown', down); return () => document.removeEventListener('mousedown', down);
  }, [shown]);
  const close = () => { setAt(undefined); btn.current?.focus(); };
  const pick = (o: HistoryOpener) => { close(); onOpen(o.id); };
  const btnKey = (e: KeyboardEvent) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setAt(e.key === 'ArrowUp' ? n - 1 : home); } };
  const menuKey = (e: KeyboardEvent) => {
    const i = at ?? 0, to = ({ ArrowDown: (i + 1) % n, ArrowUp: (i - 1 + n) % n, Home: 0, End: n - 1 } as Record<string, number>)[e.key];
    if (to !== undefined) { e.preventDefault(); setAt(to); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } else if (e.key === 'Tab') setAt(undefined);
  };
  const hint = openerHint(cur);
  return <div className="hopen" ref={wrap}>
    <button type="button" className="hist-btn hopen-main" aria-disabled={busy} aria-busy={busy} onClick={() => { if (!busy) onOpen(cur.id); }} title={`Reopen this session in ${cur.label}${hint ? ` ${hint}` : ''}`} data-testid="history-open">
      {busy ? <><span className="hopen-spin" aria-hidden="true" />Opening…</> : <>Reopen <small>{cur.label}</small></>}</button>
    <button ref={btn} type="button" className="hist-btn hopen-more" aria-haspopup="menu" aria-expanded={shown} aria-controls={shown ? id : undefined} aria-label="Choose an app to reopen in" aria-disabled={busy}
      onClick={() => { if (!busy) setAt(shown ? undefined : home); }} onKeyDown={(e) => { if (!busy) btnKey(e); }} data-testid="history-open-menu">▾</button>
    {shown ? <div id={id} role="menu" aria-label="Reopen in" className="hopen-list" onKeyDown={menuKey}>
      {openers.map((o, i) => <button key={o.id} ref={(el) => { items.current[i] = el; }} type="button" role="menuitemradio" aria-checked={o.id === cur.id} tabIndex={i === at ? 0 : -1}
        onClick={() => pick(o)} onMouseEnter={() => setAt(i)} data-testid={`history-open-${o.id}`}><i aria-hidden="true">{o.id === cur.id ? '✓' : ''}</i>{o.label}{openerHint(o) ? <small>{openerHint(o)}</small> : null}</button>)}
    </div> : null}
  </div>;
}
