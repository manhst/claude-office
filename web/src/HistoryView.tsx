import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { HistoryBookmarkResponse, HistoryDetailResponse, HistoryHit, HistoryItem, HistoryListResponse, HistorySession } from './types';
import { fetchHistory, fetchHistorySession, fetchHistoryUpTo, HistoryHttpError, isAbort, setBookmark } from './historyApi';
import { absTime, bookmarkRequest, continuePage, fmtCost, fmtDuration, fmtSpan, ghostSession, GHOST_RETRY_MS, highlight, historyErrorText, isGhost, NOTE_MAX, parseTerms, patchList, patchSession, projectOptions, relTime, resumeCommand, unGhost, type OpenRequest } from './history';
import { IconBranch } from './icons';

const PAGE = 50;
type ListState = { data?: HistoryListResponse; next: number; loading: boolean; more?: boolean; err?: string; moreErr?: string };
type DetState = { sid: string; data?: HistoryDetailResponse; err?: string };
const errText = (e: unknown, kind: 'list' | 'session' | 'bookmark') => historyErrorText(e instanceof HistoryHttpError ? e.status : 0, kind);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
/** Text nodes + <mark> only (no HTML injection). */
function Hl({ text, terms }: { text: string; terms: readonly string[] }) { return <>{highlight(text, terms).map((g, i) => g.m ? <mark key={i}>{g.t}</mark> : <Fragment key={i}>{g.t}</Fragment>)}</>; }
type OnStar = (x: HistorySession, on: boolean, note?: string) => void;
/** Bookmark toggle: its own button (never selects the row), aria-pressed state. */
function Star({ on, onClick, className = '', testid }: { on: boolean; onClick: () => void; className?: string; testid?: string }) {
  return <button type="button" className={`hstar ${className}`} aria-pressed={on} aria-label={on ? 'Remove bookmark' : 'Bookmark session'} title={on ? 'Remove bookmark' : 'Bookmark'} onClick={(e) => { e.stopPropagation(); onClick(); }} data-testid={testid}>{on ? '★' : '☆'}</button>;
}

/** History tab: search every past Claude Code session on this machine (GET /history) and read one transcript (GET /history/session).
 *  openReq (from another tab) selects that sid: its listed row, else a placeholder filled in by /history/session even when it isn't on the current page. */
export const HistoryView = memo(function HistoryView({ token, live, active, focusTick, openReq }: { token: string; live: ReadonlySet<string>; active: boolean; focusTick: number; openReq?: OpenRequest }) {
  const [q, setQ] = useState(''), [dq, setDq] = useState(''), [project, setProject] = useState(''), [auto, setAuto] = useState(false), [reload, setReload] = useState(0);
  const [list, setList] = useState<ListState>({ next: 0, loading: true });
  const [sel, setSel] = useState<HistorySession>(), [det, setDet] = useState<DetState>(), [detReload, setDetReload] = useState(0);
  const [now, setNow] = useState(Date.now);
  const [bmOnly, setBmOnly] = useState(false), [bmErr, setBmErr] = useState<{ sid: string; text: string }>();
  const bmSeq = useRef(new Map<string, number>()), bmTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(bmTimer.current), []);
  const input = useRef<HTMLInputElement>(null), listEl = useRef<HTMLDivElement>(null), detEl = useRef<HTMLElement>(null), gen = useRef(0), moreAc = useRef<AbortController | undefined>(undefined);
  const terms = useMemo(() => parseTerms(dq), [dq]);
  useEffect(() => { if (focusTick) input.current?.focus(); }, [focusTick]); // click-opened tab (not arrow-key tab navigation)
  useEffect(() => { if (!active) return; setNow(Date.now()); const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, [active]);
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    const ac = new AbortController(), g = ++gen.current; moreAc.current?.abort();
    setList((l) => ({ data: l.data, next: l.next, loading: true }));
    fetchHistory(token, { q: dq, project, auto, bookmarked: bmOnly, limit: PAGE }, ac.signal).then((d) => {
      if (g !== gen.current) return;
      setList({ data: d, next: d.offset + d.sessions.length, loading: false }); setSel((cur) => cur ?? d.sessions[0]); if (listEl.current) listEl.current.scrollTop = 0;
    }, (e) => { if (g === gen.current && !isAbort(e)) setList({ next: 0, loading: false, err: errText(e, 'list') }); });
    return () => { ac.abort(); moreAc.current?.abort(); };
  }, [token, dq, project, auto, bmOnly, reload]);
  const loadMore = () => { // overlap one row; if the order drifted (a session jumped to the top) reload rows [0, have+PAGE) instead of skipping
    const prev = list.data; if (!prev || list.more) return;
    const g = gen.current, ac = new AbortController(), qq = { q: dq, project, auto, bookmarked: bmOnly }, at = Math.max(0, list.next - 1); moreAc.current = ac;
    setList((l) => ({ ...l, more: true, moreErr: undefined }));
    (async () => {
      const n = await fetchHistory(token, { ...qq, limit: PAGE + 1, offset: at }, ac.signal), kept = continuePage(prev, n);
      return kept ? { data: kept, next: n.offset + n.sessions.length } : fetchHistoryUpTo(token, qq, prev.sessions.length + PAGE, ac.signal);
    })().then((r) => { if (g === gen.current) setList((l) => ({ ...l, ...r, more: false })); },
      (e) => { if (g === gen.current && !isAbort(e)) setList((l) => ({ ...l, more: false, moreErr: errText(e, 'list') })); });
  };
  const sid = sel?.sid, ghost = !!sel && isGhost(sel);
  useEffect(() => {
    if (!sid) { setDet(undefined); return; }
    const ac = new AbortController(); let t: ReturnType<typeof setTimeout> | undefined; setDet({ sid });
    const load = (again: boolean): void => void fetchHistorySession(token, sid, ac.signal).then((d) => { if (!ac.signal.aborted) setDet({ sid, data: d }); }, (e) => {
      if (ac.signal.aborted || isAbort(e)) return;
      if (again && e instanceof HistoryHttpError && e.status === 404) { t = setTimeout(() => load(false), GHOST_RETRY_MS); return; } // a sid opened from another tab may be newer than the index: the server rescans once, so ask once more
      setDet({ sid, err: errText(e, 'session') });
    });
    load(ghost);
    return () => { ac.abort(); clearTimeout(t); };
  }, [token, sid, detReload]);
  useEffect(() => { if (sel && det) { const u = unGhost(sel, det); if (u !== sel) setSel(u); } }, [sel, det]); // placeholder → loaded session, also when the same sid is reopened
  const d = list.data, rows = d?.sessions ?? [], nAuto = !auto && d ? d.autoHidden : 0;
  const opts = useMemo(() => projectOptions(d?.projects ?? [], project), [d, project]);
  const clear = () => { setQ(''); setDq(''); };
  const pick = useCallback((x: HistorySession) => { setSel(x); if (window.matchMedia?.('(max-width:900px)').matches) detEl.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, []); // stacked layout: detail sits below the list
  const retry = useCallback(() => setDetReload((r) => r + 1), []);
  useEffect(() => { if (openReq) pick(list.data?.sessions.find((x) => x.sid === openReq.sid) ?? ghostSession(openReq.sid)); }, [openReq]); // only a new request re-selects (not list reloads)
  const applyBm = useCallback((r: HistoryBookmarkResponse) => {
    setList((l) => l.data ? { ...l, data: patchList(l.data, r) } : l); setSel((x) => x && patchSession(x, r));
    setDet((v) => v?.data ? { ...v, data: { ...v.data, session: patchSession(v.data.session, r) } } : v);
  }, []);
  /** Optimistic: patch rows + detail now, then the server's reply; on failure roll back and show a short inline error. Latest action per sid wins. */
  const onStar = useCallback<OnStar>((x, on, note) => {
    const sid = x.sid, prev = x.bookmark ?? null, seq = (bmSeq.current.get(sid) ?? 0) + 1, req = bookmarkRequest(sid, on, note); bmSeq.current.set(sid, seq);
    applyBm({ sid, bookmark: on ? { at: prev?.at ?? Date.now(), ...(req.note ? { note: req.note } : {}) } : null }); setBmErr((e) => e?.sid === sid ? undefined : e);
    setBookmark(token, req).then((r) => { if (bmSeq.current.get(sid) === seq) applyBm(r); }, (e) => {
      if (bmSeq.current.get(sid) !== seq) return;
      applyBm({ sid, bookmark: prev }); setBmErr({ sid, text: errText(e, 'bookmark') }); clearTimeout(bmTimer.current); bmTimer.current = setTimeout(() => setBmErr(undefined), 5000);
    });
  }, [token, applyBm]);
  const bmOld = !!d && typeof d.bookmarked !== 'number', bm = !!d && !bmOld; // an orchestrator without bookmarks omits the count
  return (
    <div className="hist" data-testid="history">
      <section className="hist-list" aria-label="Session history">
        <div className="hist-tools">
          <input ref={input} type="search" className="hist-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder='Search all sessions (words AND, "exact phrase")' aria-label="Search sessions" spellCheck={false} data-testid="history-q"
            onKeyDown={(e) => { if (e.key === 'Escape' && q) { e.preventDefault(); e.stopPropagation(); clear(); } }} />
          <div className="hist-filters">
            <select value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project" data-testid="history-project">
              {opts.map((o) => <option key={o.value || '*'} value={o.value} title={o.title}>{o.label}</option>)}
            </select>
            <button type="button" className="hist-bm" aria-pressed={bmOnly} onClick={() => setBmOnly((v) => !v)} disabled={bmOld} data-testid="history-bookmarked"
              title={bmOld ? 'Restart the orchestrator to enable bookmarks' : 'Show only bookmarked sessions (automated ones included)'}><span aria-hidden="true">★</span> Bookmarked{bm ? ` (${d.bookmarked})` : ''}</button>
            <label className={`hist-auto${bmOnly ? ' off' : ''}`} title={bmOnly ? 'The bookmarked view includes automated sessions' : undefined}><input type="checkbox" checked={auto || bmOnly} disabled={bmOnly} onChange={(e) => setAuto(e.target.checked)} data-testid="history-auto" />Show automated{nAuto && !bmOnly ? ` (${nAuto})` : ''}</label>
            <button type="button" className="hist-btn" onClick={() => setReload((r) => r + 1)} disabled={list.loading}>Refresh</button>
          </div>
          <div className="hist-count" role="status">{list.loading ? 'Searching…' : d ? `${plural(d.total, bmOnly ? 'bookmarked session' : 'session')}${dq ? ' matching' : ''}${nAuto && !bmOnly ? ` · ${nAuto} automated hidden` : ''}${bmOld ? ' · restart the orchestrator to enable bookmarks' : ''}` : ''}</div>
        </div>
        <div className="hist-scroll" ref={listEl}>
          {list.err ? <div className="hist-err" role="alert"><span>{list.err}</span><button type="button" className="hist-btn" onClick={() => setReload((r) => r + 1)}>Retry</button></div> : null}
          {d && !rows.length && !list.loading && !list.err ? <div className="muted hist-empty">
            {bmOnly ? (dq ? <>No bookmarked sessions match <b>{dq}</b>.</> : project ? 'No bookmarked sessions in this project.' : 'No bookmarks yet. Click ☆ on a session to bookmark it.')
              : dq ? <>No sessions match <b>{dq}</b>. Every word must appear; use "quotes" for a phrase.</> : project ? 'No sessions in this project.' : 'No Claude Code sessions found on this machine.'}
            {nAuto && !bmOnly ? ` ${plural(nAuto, 'automated session')} hidden.` : ''}</div> : null}
          {!d && list.loading ? <div className="muted hist-empty">Loading history…</div> : null}
          {rows.length > 0 && !list.err ? <ul className={`hist-rows${list.loading ? ' stale' : ''}`}>{rows.map((x) => <Row key={x.sid} x={x} sel={x.sid === sid} live={live.has(x.sid)} terms={terms} now={now} onPick={pick} onStar={bm ? onStar : undefined} dim={bmOnly && !x.bookmark} err={bmErr?.sid === x.sid ? bmErr.text : undefined} />)}</ul> : null}
          {d && !list.err && list.next < d.total ? <button type="button" className="hist-btn hist-more" onClick={loadMore} disabled={list.more || list.loading}>{list.more ? 'Loading…' : `Load more (${d.total - list.next} left)`}</button> : null}
          {list.moreErr ? <div className="hist-err" role="alert"><span>{list.moreErr}</span></div> : null}
        </div>
      </section>
      <section className="hist-detail" aria-label="Session transcript" data-testid="history-detail" ref={detEl}>
        {sel ? <Detail key={sel.sid} x={sel} det={det?.sid === sel.sid ? det : undefined} terms={terms} live={live.has(sel.sid)} onRetry={retry} onStar={bm ? onStar : undefined} err={bmErr?.sid === sel.sid ? bmErr.text : undefined} />
          : <div className="muted hist-empty">{list.loading ? '' : 'Select a session to read its transcript.'}</div>}
      </section>
    </div>
  );
});

/** Memoised: re-renders only when the row's data, selection, live flag, terms, bookmark error or the 30 s clock change (not per keystroke).
 *  dim: un-starred while the bookmarked filter is on; it stays in place until the next reload so the list doesn't jump. */
const Row = memo(function Row({ x, sel, live, terms, now, onPick, onStar, dim, err }: { x: HistoryHit; sel: boolean; live: boolean; terms: readonly string[]; now: number; onPick: (x: HistorySession) => void; onStar?: OnStar; dim: boolean; err?: string }) {
  return <li className={`hrow-li${onStar ? ' has-star' : ''}${dim ? ' dim' : ''}`}><button type="button" className={`hrow${sel ? ' sel' : ''}`} aria-pressed={sel} onClick={() => onPick(x)} data-testid={`hist-${x.sid}`}>
    <span className="hrow-top"><b className="hrow-title"><Hl text={x.title || x.sid.slice(0, 8)} terms={terms} /></b>{live ? <span className="hbadge live">live</span> : null}{x.auto ? <span className="hbadge">auto</span> : null}</span>
    {x.bookmark?.note ? <span className="hrow-note" title="bookmark note">{x.bookmark.note}</span> : null}
    <span className="hrow-meta">
      <span className="hchip" title={x.project}>{x.projectName}</span>
      {x.gitBranch ? <span title="git branch"><IconBranch size={11} />{x.gitBranch}</span> : null}
      <span title={absTime(x.endedAt)}>{relTime(x.endedAt, now)}</span>
      <span>{plural(x.prompts, 'prompt')}</span>
      {x.costUsd ? <span>{fmtCost(x.costUsd)}</span> : null}
      {x.hits ? <span>{plural(x.hits, 'hit')}</span> : null}
    </span>
    {x.snippet ? <span className="hrow-snip"><Hl text={x.snippet} terms={terms} /></span> : null}
  </button>
  {onStar ? <Star on={!!x.bookmark} onClick={() => onStar(x, !x.bookmark)} testid={`star-${x.sid}`} /> : null}
  {err ? <div className="hrow-err" role="alert">{err}</div> : null}</li>;
});

/** Memoised (stable props), and the highlighted transcript is memoised on (items, terms): typing, list loads and the app tick don't redo it. */
const Detail = memo(function Detail({ x, det, terms, live, onRetry, onStar, err }: { x: HistorySession; det?: DetState; terms: readonly string[]; live: boolean; onRetry: () => void; onStar?: OnStar; err?: string }) {
  const m = det?.data?.session ?? x, items = det?.data?.items, cmd = resumeCommand(m.project, m.sid);
  const [copied, setCopied] = useState<'cmd' | 'sid' | 'fail'>();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), tx = useRef<HTMLDivElement>(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = (what: 'cmd' | 'sid', text: string) => {
    const done = (ok: boolean) => { setCopied(ok ? what : 'fail'); clearTimeout(timer.current); timer.current = setTimeout(() => setCopied(undefined), 1800); };
    const p = navigator.clipboard?.writeText(text); if (p) p.then(() => done(true), () => done(false)); else done(false);
  };
  useEffect(() => { // scroll the transcript (only) to the first match
    const c = tx.current; if (!c) return;
    const mk = terms.length ? c.querySelector('mark') : null;
    c.scrollTop = mk ? c.scrollTop + mk.getBoundingClientRect().top - c.getBoundingClientRect().top - c.clientHeight / 3 : 0;
  }, [items, terms]);
  const body = useMemo(() => items?.map((it, i) => <Item key={i} it={it} terms={terms} />), [items, terms]);
  const kv = (k: string, v: ReactNode, mono?: boolean) => <div className="kv"><span>{k}</span><b className={mono ? 'mono' : undefined}>{v}</b></div>;
  if (isGhost(m)) return (<><div className="hd-head"><h2 className="mono">{m.sid}</h2></div>
    <div className="hx-scroll" data-testid="history-transcript">{det?.err ? <div className="hist-err" role="alert"><span>{det.err}</span><button type="button" className="hist-btn" onClick={onRetry}>Retry</button></div> : <div className="muted hist-empty">Loading transcript…</div>}</div></>);
  return (<>
    <div className="hd-head"><h2><Hl text={m.title || m.sid.slice(0, 8)} terms={terms} /></h2>{live ? <span className="hbadge live">live</span> : null}{m.auto ? <span className="hbadge">auto</span> : null}
      {onStar ? <Star on={!!m.bookmark} onClick={() => onStar(m, !m.bookmark)} className="hd-star" testid="history-star" /> : null}</div>
    {onStar && m.bookmark ? <NoteField note={m.bookmark.note ?? ''} onSave={(n) => onStar(m, true, n)} /> : null}
    {err ? <p className="hist-err" role="alert">{err}</p> : null}
    <div className="hd-meta" data-testid="history-meta">
      {kv('Project', m.project, true)}
      {m.gitBranch ? kv('Branch', m.gitBranch, true) : null}
      {kv('Time', `${fmtSpan(m.startedAt, m.endedAt)} · ${fmtDuration(m.endedAt - m.startedAt)}`)}
      {kv('Activity', `${plural(m.prompts, 'prompt')} · ${plural(m.messages, 'message')} · ${plural(m.subagents, 'subagent')}`)}
      {m.model ? kv('Model', m.model, true) : null}
      {m.entrypoint || m.version ? kv('Entrypoint', [m.entrypoint, m.version && `v${m.version}`].filter(Boolean).join(' · ')) : null}
      {m.costUsd ? kv('Cost', fmtCost(m.costUsd)) : null}
      {kv('Sid', m.sid, true)}
    </div>
    <div className="hd-actions">
      <button type="button" className="hist-btn" onClick={() => copy('cmd', cmd)} data-testid="history-copy-resume">Copy resume command</button>
      <button type="button" className="hist-btn" onClick={() => copy('sid', m.sid)}>Copy sid</button>
      <span role="status" className={copied === 'fail' ? 'fail' : undefined}>{copied === 'cmd' ? 'Resume command copied' : copied === 'sid' ? 'Sid copied' : copied === 'fail' ? 'Copy failed: select the command below' : ''}</span>
    </div>
    <code className="hd-cmd">{cmd}</code>
    {det?.data?.truncated ? <p className="muted hd-note">Transcript truncated by the orchestrator: showing {plural(det.data.items.length, 'item')}.</p> : null}
    <div className="hx-scroll" ref={tx} data-testid="history-transcript">
      {det?.err ? <div className="hist-err" role="alert"><span>{det.err}</span><button type="button" className="hist-btn" onClick={onRetry}>Retry</button></div>
        : !items ? <div className="muted hist-empty">Loading transcript…</div>
        : !items.length ? <div className="muted hist-empty">No prompts or replies in this transcript.</div>
        : <ol className="hx">{body}</ol>}
    </div>
  </>);
});

/** Bookmark note: saves on Enter or blur when changed, Esc reverts. Follows outside changes (server reply, rollback) while not focused. */
function NoteField({ note, onSave }: { note: string; onSave: (n: string) => void }) {
  const [v, setV] = useState(note), focused = useRef(false), skip = useRef(false);
  useEffect(() => { if (!focused.current) setV(note); }, [note]);
  return <label className="hd-bm-note"><span>Note</span><input value={v} maxLength={NOTE_MAX} placeholder="Add a short note (Enter to save)" spellCheck={false} data-testid="history-note" onChange={(e) => setV(e.target.value)}
    onFocus={() => { focused.current = true; }} onBlur={() => { focused.current = false; if (skip.current) { skip.current = false; return; } if (v.trim() !== note) onSave(v); }}
    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); skip.current = true; setV(note); e.currentTarget.blur(); } }} /></label>;
}

function Item({ it, terms }: { it: HistoryItem; terms: readonly string[] }) {
  const ts = it.ts ? absTime(it.ts) : undefined;
  if (it.role === 'tool') return <li className="hx-tool" title={[`${it.name}${it.detail ? ` · ${it.detail}` : ''}`, ts].filter(Boolean).join('\n')}>▸ <b><Hl text={it.name} terms={terms} /></b>{it.detail ? <> · <Hl text={it.detail} terms={terms} /></> : null}</li>;
  return <li className={`hx-${it.role}`}><small>{it.role === 'user' ? 'You' : 'Claude'}{ts ? ` · ${ts}` : ''}</small><div className="hx-text"><Hl text={it.text} terms={terms} /></div></li>;
}
