import { useEffect, useId, useRef, type ReactNode } from 'react';

/** A pending confirmation: OK runs `run`; cancel label defaults to "Cancel". */
export type Ask = { title: string; body: ReactNode; ok: string; cancel?: string; danger?: boolean; run: () => void };
const FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
/** Small modal confirm shared by the Claude config and History tabs (both stay mounted, hidden when not shown).
 *  Esc / backdrop = cancel; focus starts on Cancel, Tab stays inside, and on close focus goes back to the element focused when it first showed
 *  (the opener; if it opened while its tab was hidden, the element focused when the tab came back), when that is still visible.
 *  active = its tab is visible: the Esc/Tab/focus listeners exist only then, so a dialog left open in a hidden tab never swallows keys elsewhere,
 *  and focus moves back into it when the tab is shown again. */
export function Confirm({ a, onClose, active = true }: { a: Ask; onClose: () => void; active?: boolean }) {
  const id = useId(), box = useRef<HTMLDivElement>(null), cancel = useRef<HTMLButtonElement>(null), close = useRef(onClose); close.current = onClose;
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => () => { const o = opener.current; if (o?.isConnected && o.getClientRects().length) o.focus(); }, []);
  useEffect(() => {
    if (!active) return;
    opener.current ??= document.activeElement as HTMLElement | null;
    cancel.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close.current(); return; }
      if (e.key !== 'Tab' || !box.current) return;
      const f = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)], first = f[0], last = f[f.length - 1], at = document.activeElement;
      if (!first) return;
      if (e.shiftKey ? at === first || !box.current.contains(at) : at === last || !box.current.contains(at)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
    };
    const into = (e: FocusEvent) => { if (box.current && !box.current.contains(e.target as Node)) cancel.current?.focus(); };
    document.addEventListener('keydown', key, true); document.addEventListener('focusin', into);
    return () => { document.removeEventListener('keydown', key, true); document.removeEventListener('focusin', into); };
  }, [active]);
  return <div className="editor-back" onClick={onClose}><div ref={box} className="editor cc-confirm" role="alertdialog" aria-modal="true" aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`} onClick={(e) => e.stopPropagation()} data-testid="cc-confirm">
    <h3 id={`${id}-t`}>{a.title}</h3><p id={`${id}-d`}>{a.body}</p>
    <div className="editor-foot"><button ref={cancel} type="button" onClick={onClose}>{a.cancel ?? 'Cancel'}</button><button type="button" className={a.danger ? 'cc-danger-b' : 'primary'} onClick={() => { onClose(); a.run(); }} data-testid="cc-confirm-ok">{a.ok}</button></div>
  </div></div>;
}
