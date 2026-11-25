import { useCallback, useEffect, useRef, useState } from 'react';
import type { HistoryDeleteItem, HistoryDeleteResponse } from './types';
import { deleteSession, HistoryHttpError } from './historyApi';
import { DELETE_NOTE, deleteItemSize, deleteKind, deleteStepError, deleteTotal, fmtBytes, isDeleteChanged, isOpenConfirm } from './history';
import type { Ask } from './Confirm';

/** Item rows: path, kind, size; a skipped item is muted with the reason it stays. */
export function DeleteItems({ items, testid }: { items: readonly HistoryDeleteItem[]; testid?: string }) {
  return <ul className="hdel-items" data-testid={testid}>{items.map((it, i) => <li key={i} className={it.skipped ? 'skip' : undefined}>
    <code title={it.path}>{it.path}{it.skipped ? <small>kept: {it.skipped}</small> : null}</code><span>{deleteKind(it)}</span><span>{deleteItemSize(it)}</span></li>)}</ul>;
}
/** What a delete would remove (dry-run answer): the server's "this machine only" note, the items, the total (skipped ones left out). changed: the list was re-read. */
export function DeleteList({ r, changed }: { r: HistoryDeleteResponse; changed?: boolean }) {
  const t = deleteTotal(r.items);
  return <>
    {changed ? <p className="hdel-changed" data-testid="history-delete-changed">The files changed since the last preview: this is the new list.</p> : null}
    <p className="hdel-note" data-testid="history-delete-note"><b>{r.note || DELETE_NOTE}</b></p>
    {r.items.length ? <DeleteItems items={r.items} testid="history-delete-items" /> : <p className="muted">Nothing left to delete on this machine.</p>}
    <p className="hdel-total" data-testid="history-delete-total">Total: {t.n} item{t.n === 1 ? '' : 's'} · {fmtBytes(t.bytes)}{t.skipped ? <span className="muted"> ({t.skipped} kept)</span> : null}</p>
  </>;
}

export type DeleteErr = { text: string; deleted?: HistoryDeleteItem[] };
/** "Delete…" state for one session: dry run (planId) → confirm listing the items → real delete with that planId. 409 confirm-required asks once more
 *  with its reason and resends with confirm:true; 409 changed re-runs the dry run and shows the new list; delete-failed keeps what was already removed.
 *  One request at a time; onDeleted gets the server's answer. */
export function useDeleteSession(token: string, sid: string, onDeleted: (r: HistoryDeleteResponse) => void) {
  const [busy, setBusy] = useState<'check' | 'delete'>(), [err, setErr] = useState<DeleteErr>(), [ask, setAsk] = useState<Ask>();
  const alive = useRef(true), inFlight = useRef(false), done = useRef(onDeleted); done.current = onDeleted;
  useEffect(() => () => { alive.current = false; }, []);
  const call = useCallback(function call(o: { dryRun?: boolean; confirm?: boolean; planId?: string; changed?: boolean }) {
    if (inFlight.current) return;
    const dry = !!o.dryRun; inFlight.current = true; setBusy(dry ? 'check' : 'delete'); setErr(undefined);
    let again: (() => void) | undefined;
    deleteSession(token, { sid, ...(dry ? { dryRun: true } : {}), ...(o.confirm ? { confirm: true } : {}), ...(!dry && o.planId ? { planId: o.planId } : {}) }).then((r) => {
      if (!alive.current) return;
      if (dry) setAsk({ title: 'Delete this session from this machine?', body: <DeleteList r={r} changed={o.changed} />, block: true, ok: 'Delete', danger: true, run: () => call({ planId: r.planId }) });
      else if (r.deleted) done.current(r);
      else setErr({ text: 'Delete failed: nothing was deleted.' });
    }, (e) => {
      if (!alive.current) return;
      const h = e instanceof HistoryHttpError ? e : undefined;
      if (!dry && isDeleteChanged(h?.error)) again = () => call({ dryRun: true, changed: true }); // re-read the plan once the slot is free
      else if (!dry && !o.confirm && isOpenConfirm(h?.error)) setAsk({ title: 'Delete it anyway?', body: h?.reason ?? 'This session is live or was written in the last 2 minutes.', ok: 'Delete anyway', danger: true, run: () => call({ confirm: true, planId: o.planId }) });
      else setErr({ text: deleteStepError(dry, h?.status ?? 0, h?.error, h?.reason), ...(h?.deleted?.length ? { deleted: h.deleted } : {}) });
    }).finally(() => { inFlight.current = false; if (alive.current) { setBusy(undefined); again?.(); } });
  }, [token, sid]);
  return { busy, err, ask, closeAsk: useCallback(() => setAsk(undefined), []), start: useCallback(() => call({ dryRun: true }), [call]) };
}

/** Low-emphasis danger button; aria-disabled while busy (keeps focus, unlike `disabled`). */
export function DeleteButton({ busy, onClick }: { busy?: 'check' | 'delete'; onClick: () => void }) {
  return <button type="button" className="hist-btn hdel-btn" aria-disabled={!!busy} aria-busy={!!busy} onClick={() => { if (!busy) onClick(); }} title="Delete this session's local files (transcript, history lines…) from this machine" data-testid="history-delete">{busy === 'delete' ? 'Deleting…' : busy ? 'Checking…' : 'Delete…'}</button>;
}
/** Inline error; after a partial delete, what was already removed. */
export function DeleteError({ err }: { err: DeleteErr }) {
  return <div className="hist-err hdel-err" role="alert" data-testid="history-delete-err"><span>{err.text}</span>
    {err.deleted ? <><b>Partly deleted:</b><DeleteItems items={err.deleted} testid="history-delete-partial" /></> : null}</div>;
}
