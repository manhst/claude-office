import { useCallback, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { PromptAck, SessionView } from './types';
import { capabilityNote, composerBusy, statusNote } from './composerCopy';
import { EFFORT_CHOICES, MODEL_CHOICES, newNonce, postPrompt } from './submitPrompt';

const PICK_KEY = 'deck.promptPick';
function loadPick(): { model: string; effort: string } {
  try {
    const j = JSON.parse(localStorage.getItem(PICK_KEY) ?? '{}');
    const model = MODEL_CHOICES.some((c) => c.value === j?.model) ? j.model : '';
    const effort = EFFORT_CHOICES.some((c) => c.value === j?.effort) ? j.effort : '';
    return { model, effort };
  } catch { return { model: '', effort: '' }; }
}
function savePick(p: { model: string; effort: string }) { try { localStorage.setItem(PICK_KEY, JSON.stringify(p)); } catch { /* storage off */ } }
import { IconSend } from './icons';

/** Per-session draft map lives in the parent so switching sessions does not send and does not lose text. */
export function PromptComposer({ selected, token, ack, drafts, setDraft, demo }: {
  selected?: SessionView; token: string; ack?: PromptAck; drafts: Record<string, string>;
  setDraft: (sid: string, text: string) => void; demo?: boolean;
}) {
  const sid = selected?.sid;
  const text = sid ? (drafts[sid] ?? '') : '';
  const [err, setErr] = useState<string>();
  const [pending, setPending] = useState(false);
  const [pick, setPickState] = useState(loadPick);
  const setPick = (p: Partial<{ model: string; effort: string }>) => setPickState((cur) => { const n = { ...cur, ...p }; savePick(n); return n; });
  const can = !!selected?.canSubmit && !demo;
  const busy = composerBusy(ack) || pending;
  const disabled = !sid || !can || busy || !text.trim();
  const send = useCallback(async () => {
    if (!sid || !can || busy || !text.trim() || pending) return; // explicit Send only
    setErr(undefined); setPending(true);
    try {
      const r = await postPrompt(token, sid, text, newNonce(), pick);
      if (!r.ok) setErr(r.error); else setDraft(sid, '');
    } catch (e) { setErr(String((e as Error).message ?? e).slice(0, 160)); }
    finally { setPending(false); }
  }, [sid, can, busy, text, pending, token, setDraft, pick]);
  const onSubmit = (e: FormEvent) => { e.preventDefault(); void send(); };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void send(); } };
  return (
    <form className="composer" data-testid="prompt-composer" data-demo={demo ? '1' : undefined} data-cansubmit={can ? '1' : '0'} onSubmit={onSubmit}>
      <div className="composer-head">
        <span>Prompt</span>
        {selected?.model ? <small data-testid="composer-model" className="mono">session: {selected.model}</small> : <small data-testid="composer-model" className="muted">session model unknown</small>}
      </div>
      {demo ? <p className="composer-banner" data-testid="composer-demo">DEMO — no live Claude Code runtime. Send is disabled. This is not a real submit.</p> : null}
      <p className="composer-note" data-testid="composer-cap">{capabilityNote(selected)}</p>
      <textarea data-testid="composer-text" rows={3} value={sid ? text : ''} disabled={!sid} placeholder={sid ? 'Type a prompt for this session' : 'Select a live session'}
        onChange={(e) => { if (sid) setDraft(sid, e.target.value); }} onKeyDown={onKey} />
      <div className="composer-row composer-pick">
        <label>Model <select data-testid="composer-pick-model" value={pick.model} disabled={!can} onChange={(e) => setPick({ model: e.target.value })}>
          {MODEL_CHOICES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select></label>
        <label>Effort <select data-testid="composer-pick-effort" value={pick.effort} disabled={!can} onChange={(e) => setPick({ effort: e.target.value })}>
          {EFFORT_CHOICES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select></label>
      </div>
      <div className="composer-row">
        <button type="submit" className="composer-send" data-testid="composer-send" disabled={disabled}><IconSend size={14} /> Send</button>
        {busy ? <small data-testid="composer-busy">{pending ? 'sending…' : ack?.state}</small> : null}
      </div>
      {err ? <p className="composer-err" data-testid="composer-err">{err}</p> : null}
      {statusNote(ack) ? <p className="composer-status" data-testid="composer-status">{statusNote(ack)}</p> : null}
    </form>
  );
}
