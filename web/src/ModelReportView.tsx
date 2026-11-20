import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import type { ModelReportResponse, ModelStats } from './types';
import { fetchModelReport, reportStatus } from './modelReportApi';
import { isAbort } from './historyApi';
import {
  barMax, barWidth, CAT_HINT, CAT_LABEL, CATS, colorSlot, effortTop, fmtDay, fmtDayTime, fmtDec, fmtDur, fmtN, fmtNum, fmtPct, fmtStamp, fmtTick, fmtUsd, labeler, linePath, mainCause, nearestIndex, niceScale,
  patternGroups, pct, perTurn, plural, RATE_COLS, rateOf, RECHECK_MS, reportErrorText, reportTiles, shortSid, shortTool, tipLeft, trendSeries, weekLabel, weekRows, windowText, WINDOWS, xAt, xTicks, type TrendKind,
} from './modelReport';

type Lbl = (id: string) => string;
/** Series color of a slot (0 = neutral); text never takes it, only swatches, lines and markers. */
const slotVar = (s: number) => ({ '--c': `var(--mr-s${s})` } as CSSProperties);
function Sw({ slot }: { slot: number }) { return <span className="mr-sw" style={slotVar(slot)} aria-hidden="true" />; }
function Model({ m, order }: { m: ModelStats; order: readonly string[] }) { return <><Sw slot={colorSlot(m.model, order)} />{m.label}{m.smallSample ? <Small /> : null}</>; }
function Small() { return <span className="mr-tag" title="Under 200 tool calls or under 20 turns: the rates don't mean much yet">small sample</span>; }
const none = (cols: number) => <tr><td colSpan={cols} className="muted">None</td></tr>;

/** "Performance" tab: how each Claude model did in this machine's Claude Code transcripts (GET /model-report). Fetches only while visible. */
export const ModelReportView = memo(function ModelReportView({ token, active, onOpenSession }: { token: string; active: boolean; onOpenSession: (sid: string) => void }) {
  const [days, setDays] = useState(30), [auto, setAuto] = useState(false), [reload, setReload] = useState(0);
  const [data, setData] = useState<{ r: ModelReportResponse; key: string }>(), [loading, setLoading] = useState(false), [recheck, setRecheck] = useState(false), [err, setErr] = useState<string>(), [pick, setPick] = useState<string>();
  const done = useRef<string | undefined>(undefined), freshAt = useRef(-1), key = `${days}|${auto ? 1 : 0}|${reload}`;
  useEffect(() => { // a window/auto change or "Refresh" makes a new key; the last report stays up (dimmed) until the new one lands. Hidden → abort, refetched on return.
    if (!active || done.current === key) return;
    const ac = new AbortController(), fresh = freshAt.current === reload, show = (r: ModelReportResponse) => { setData({ r, key }); setErr(undefined); };
    let timer: ReturnType<typeof setTimeout> | undefined, follow = false;
    setLoading(true);
    fetchModelReport(token, { days, auto, fresh }, ac.signal).then((r) => {
      done.current = key; if (fresh) freshAt.current = -1; show(r); setLoading(false);
      if (!r.refreshing) return; // a rescan is running: one more (non-fresh) fetch after a moment, then stop, never a loop
      follow = true; setRecheck(true);
      timer = setTimeout(() => void fetchModelReport(token, { days, auto }, ac.signal).then(show, () => {}).finally(() => { if (!ac.signal.aborted) { follow = false; setRecheck(false); } }), RECHECK_MS);
    }, (e) => { if (ac.signal.aborted || isAbort(e)) return; done.current = key; setErr(reportErrorText(reportStatus(e))); setLoading(false); });
    return () => { ac.abort(); clearTimeout(timer); if (follow) { done.current = undefined; setRecheck(false); } }; // follow-up cut short (tab hidden): fetch again on return
  }, [token, key, active, days, auto, reload]);
  const r = data?.r, sel = pick && r?.models.some((m) => m.model === pick) ? pick : undefined;
  const onPick = useCallback((m: string) => setPick((p) => p === m ? undefined : m), []);
  const refresh = () => { freshAt.current = reload + 1; setReload(reload + 1); }; // only "Refresh" / "Retry" ask the server to rescan first
  return (
    <div className="mr" data-testid="report">
      <div className="mr-head">
        <div className="cc-seg" role="group" aria-label="Time range">{WINDOWS.map(([d, l]) => <button key={d} type="button" aria-pressed={d === days} onClick={() => setDays(d)} data-testid={`report-days-${d}`}>{l}</button>)}</div>
        <label className="hist-auto" title="Sessions run with claude -p from a script or plugin (entrypoint sdk-cli)"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} data-testid="report-auto" />Include automated sessions (sdk-cli)</label>
        <button type="button" className="hist-btn" onClick={refresh} disabled={loading} data-testid="report-refresh">Refresh</button>
        <span className="mr-stamp" role="status" title={r ? `Report built at ${fmtStamp(r.generatedAt)}` : undefined}>{loading ? 'Building report…' : r ? `data as of ${fmtStamp(r.scannedAt || r.generatedAt)}${recheck ? ' · rescanning…' : ''}` : ''}</span>
      </div>
      {err ? <div className="hist-err" role="alert"><span>{err}</span><button type="button" className="hist-btn" onClick={refresh} disabled={loading}>Retry</button></div> : null}
      {r ? <Report r={r} stale={loading || data?.key !== key} sel={sel} onPick={onPick} onOpen={onOpenSession} />
        : loading ? <div className="muted hist-empty">Reading Claude Code transcripts…</div> : null}
    </div>
  );
});

const Report = memo(function Report({ r, stale, sel, onPick, onOpen }: { r: ModelReportResponse; stale: boolean; sel?: string; onPick: (m: string) => void; onOpen: (sid: string) => void }) {
  const label = useMemo(() => labeler(r.models), [r.models]), has = r.models.length > 0;
  return (
    <div className={`mr-body${stale ? ' stale' : ''}`}>
      <p className="mr-lead">From the Claude Code transcripts on this machine, {windowText(r)}. Every number is an indirect signal; see “How to read this” at the end.</p>
      <div className="mr-tiles">{reportTiles(r).map((t) => <div key={t.k} className="mr-tile"><div className="k">{t.k}</div><div className="v">{t.v}</div><div className="d">{t.d}</div></div>)}</div>
      {has ? <Quality r={r} sel={sel} onPick={onPick} /> : <p className="muted hist-empty">No Claude Code sessions in this range{r.auto ? '' : ' (automated sessions excluded)'}.</p>}
      <h2>Weekly trend</h2>
      <p className="mr-note">One line per model (up to the 5 models with the most tool calls in this range). Each model keeps its color when you change the range.</p>
      <div className="mr-charts">
        <TrendChart r={r} kind="misuse" title="Model misused a tool" sub="% of tool calls, weeks with at least 30 calls" unit="%" vol="tool calls" label={label} />
        <TrendChart r={r} kind="friction" title="You interrupted or corrected" sub="per 100 turns, weeks with at least 10 turns" unit="" vol="turns" label={label} />
      </div>
      {has ? <>
        <Speed r={r} />
        <Causes r={r} />
        <Patterns r={r} sel={sel} label={label} onClear={() => onPick(sel!)} />
        <div className="mr-cols"><Tools r={r} /><Api r={r} /></div>
        <Review r={r} label={label} onOpen={onOpen} />
      </> : null}
      <Notes />
    </div>
  );
});

function Quality({ r, sel, onPick }: { r: ModelReportResponse; sel?: string; onPick: (m: string) => void }) {
  const ms = r.models, mx = useMemo(() => RATE_COLS.map((c) => barMax(ms, c)), [ms]);
  return <section>
    <h2>Quality by model</h2>
    <p className="mr-note">Lower is better, except the last column. “You interrupt” = Esc presses per 100 turns. “You correct” = prompts like “that's wrong”, “still broken”, “redo”, “revert” per 100 prompts (a keyword estimate). Last run green = sessions that ran tests, a build or a typecheck and whose last run passed. Click a model to filter “Most common errors”.</p>
    <div className="mr-tw"><table className="mr-t" data-testid="report-quality">
      <thead><tr><th>Model</th><th className="num">Sessions</th><th className="num">Turns</th><th className="num">Tool calls</th>{RATE_COLS.map((c) => <th key={c.key} className="num" title={c.title}>{c.label}</th>)}<th className="num">Test/build fail</th><th className="num">Last run green</th></tr></thead>
      <tbody>{ms.map((m) => { const on = sel === m.model; return <tr key={m.model} className={`mr-pick${on ? ' sel' : ''}`} onClick={() => onPick(m.model)}>
        <th scope="row"><button type="button" className="mr-mbtn" aria-pressed={on} title={on ? 'Clear filter' : 'Show only this model\'s errors'}><Sw slot={colorSlot(m.model, r.modelOrder)} />{m.label}</button>{m.smallSample ? <Small /> : null}</th>
        <td className="num">{fmtN(m.sessions)}{m.subagentRuns ? <span className="mr-sub">+ {plural(m.subagentRuns, 'subagent run')}</span> : null}</td>
        <td className="num">{fmtN(m.turns)}</td><td className="num">{fmtN(m.toolCalls)}</td>
        {RATE_COLS.map((c, i) => <Rate key={c.key} v={rateOf(m, c)} max={mx[i]} unit={c.unit} />)}
        <td className="num">{fmtPct(pct(m.verifyFails, m.verifyRuns), 0)}<span className="mr-sub">{fmtN(m.verifyFails)}/{fmtN(m.verifyRuns)} runs</span></td>
        <td className="num">{fmtPct(pct(m.verifyGreen, m.verifySessions), 0)}<span className="mr-sub">{fmtN(m.verifyGreen)}/{fmtN(m.verifySessions)} sessions</span></td>
      </tr>; })}</tbody>
    </table></div>
  </section>;
}
/** Rate with a thin single-hue bar scaled to the column's max (small samples excluded from the scale). */
function Rate({ v, max, unit }: { v: number | null; max: number; unit: '%' | '' }) {
  const w = barWidth(v, max);
  return <td className="num" title={unit ? fmtPct(v, 2) : fmtNum(v, 2)}><span className="mr-cb"><span className="mr-track" aria-hidden="true">{w !== null ? <i style={{ width: `${w}%` }} /> : null}</span>{v === null ? '–' : `${fmtDec(v, 1)}${unit}`}</span></td>;
}

function useWidth(ref: RefObject<HTMLElement | null>) {
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return; setW(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setW(el.clientWidth)); ro.observe(el); return () => ro.disconnect();
  }, [ref]);
  return w;
}
const CH = 220, CL = 42, CR = 12, CT = 10, CB = 24;
/** Weekly line chart in real pixels (labels stay legible on a phone); crosshair + tooltip on hover, ←/→ when focused. */
function TrendChart({ r, kind, title, sub, unit, vol, label }: { r: ModelReportResponse; kind: TrendKind; title: string; sub: string; unit: string; vol: string; label: Lbl }) {
  const t = useMemo(() => trendSeries(r.trend, r.modelOrder, kind), [r.trend, r.modelOrder, kind]);
  const box = useRef<HTMLDivElement>(null), tip = useRef<HTMLDivElement>(null), w = useWidth(box), [hi, setHi] = useState<number>(), [tw, setTw] = useState(0), [kb, setKb] = useState(false);
  const n = t.weeks.length, empty = !t.series.length, sc = useMemo(() => niceScale(t.series.reduce((a, s) => s.values.reduce<number>((b, v) => Math.max(b, v ?? 0), a), 0)), [t]);
  const x1 = Math.max(CL + 1, w - CR), x = (i: number) => xAt(i, n, CL, x1), y = (v: number) => CT + (CH - CT - CB) * (1 - v / sc.max);
  const fmt = (v: number | null) => kind === 'misuse' ? fmtPct(v, 2) : fmtNum(v, 1), h = hi !== undefined && hi < n ? hi : undefined;
  useLayoutEffect(() => { if (tip.current) setTw(tip.current.offsetWidth); }, [h, w, t]); // measured so the tooltip can be kept inside the plot
  const rows = h === undefined ? [] : weekRows(t.series, h), line = (s: (typeof rows)[number]) => `${label(s.model)}: ${fmt(s.values[h!])} (${fmtN(s.volume[h!])} ${vol})`;
  const move = (e: PointerEvent<SVGSVGElement>) => setHi(nearestIndex(e.clientX - e.currentTarget.getBoundingClientRect().left, n, CL, x1));
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { setHi(undefined); return; }
    const d = ({ ArrowLeft: -1, ArrowRight: 1 } as Record<string, number>)[e.key]; if (d === undefined || !n) return;
    e.preventDefault(); setKb(true); setHi((v) => v === undefined ? n - 1 : Math.max(0, Math.min(n - 1, v + d)));
  };
  return <div className="mr-chart">
    <h3>{title}</h3><div className="muted">{sub}</div>
    <div className="mr-plot" ref={box}>
      {empty ? <div className="muted mr-nodata">Not enough weekly data yet.</div> : w > 0 ? <svg width={w} height={CH} role="img" aria-label={`${title} by week: ${t.series.map((s) => label(s.model)).join(', ')}`} tabIndex={0}
        onPointerMove={(e) => { setKb(false); move(e); }} onPointerLeave={() => setHi(undefined)} onKeyDown={key} onBlur={() => setHi(undefined)}>
        <g className="mr-grid">{sc.ticks.map((v) => <line key={v} x1={CL} x2={x1} y1={y(v)} y2={y(v)} />)}</g>
        <g className="mr-axis">{sc.ticks.map((v) => <text key={v} x={CL - 6} y={y(v) + 3.5} textAnchor="end">{`${fmtTick(v)}${unit}`}</text>)}
          {xTicks(n, Math.floor((x1 - CL) / 46) + 1).map((i) => <text key={i} x={x(i)} y={CH - 6} textAnchor="middle">{weekLabel(t.weeks[i])}</text>)}</g>
        {h !== undefined ? <line className="mr-xh" x1={x(h)} x2={x(h)} y1={CT} y2={CH - CB} /> : null}
        {t.series.map((s) => <g key={s.model} className="mr-line" style={slotVar(s.slot)}><path d={linePath(s.values, x, y)} />
          {s.values.map((v, i) => v === null ? null : <circle key={i} cx={x(i)} cy={y(v)} r={i === h ? 5 : 4} />)}</g>)}
      </svg> : null}
      {h !== undefined && !empty ? <div className="mr-tip" ref={tip} style={{ left: tipLeft(x(h), tw, w) }}>
        <div className="muted">Week of {weekLabel(t.weeks[h])}</div>
        {rows.length ? rows.map((s) => <div key={s.model}><Sw slot={s.slot} />{label(s.model)}: <b>{fmt(s.values[h])}</b> <span className="muted">({fmtN(s.volume[h])} {vol})</span></div>) : <div className="muted">No data this week</div>}
      </div> : null}
    </div>
    <span className="mr-sr" aria-live="polite">{kb && h !== undefined ? `Week of ${weekLabel(t.weeks[h])}: ${rows.length ? rows.map(line).join('; ') : 'no data'}` : ''}</span>
    {!empty ? <div className="mr-legend">{t.series.map((s) => <span key={s.model}><Sw slot={s.slot} />{label(s.model)}</span>)}</div> : null}
  </div>;
}

function Speed({ r }: { r: ModelReportResponse }) {
  const ms = r.models.filter((m) => m.turns || m.toolCalls), mt = ms.some((m) => m.maxTokensStops), rf = ms.some((m) => m.refusals);
  return <section>
    <h2>Speed and cost</h2>
    <div className="mr-tw"><table className="mr-t">
      <thead><tr><th>Model</th><th className="num">Turn time (median)</th><th className="num">p90</th><th className="num">Tools / turn</th><th className="num">Output tokens / turn</th><th className="num">Cost</th><th className="num">$ / turn</th><th className="num">Compact</th>
        {mt ? <th className="num">Cut at max_tokens</th> : null}{rf ? <th className="num">Refusals</th> : null}<th className="num">Lines changed</th><th className="num">PRs opened</th><th>Usual effort</th></tr></thead>
      <tbody>{ms.length ? ms.map((m) => { const ot = perTurn(m.outputTokens, m.turns), ct = perTurn(m.costUsd, m.turns); return <tr key={m.model}>
        <th scope="row"><Model m={m} order={r.modelOrder} /></th><td className="num">{fmtDur(m.turnMedianMs)}</td><td className="num">{fmtDur(m.turnP90Ms)}</td>
        <td className="num">{fmtNum(perTurn(m.toolCalls, m.turns))}</td><td className="num">{ot === null ? '–' : fmtN(ot)}</td><td className="num">{fmtUsd(m.costUsd)}</td><td className="num">{ct === null ? '–' : fmtUsd(ct)}</td>
        <td className="num">{fmtN(m.compactions)}</td>{mt ? <td className="num">{fmtN(m.maxTokensStops)}</td> : null}{rf ? <td className="num">{fmtN(m.refusals)}</td> : null}
        <td className="num">{fmtN(m.linesChanged)}</td><td className="num">{fmtN(m.prs)}</td><td className="nw">{effortTop(m.effort)}</td>
      </tr>; }) : none(11 + +mt + +rf)}</tbody>
    </table></div>
    <p className="mr-note mr-after">Cost comes from each session's per-model cost-state (subagents and side calls included). Turn time runs from your prompt to the last line before the next prompt, so it includes time spent waiting for you to approve permissions.</p>
    <p className="mr-note">The total cost above also includes side calls by models that have no row here (e.g. Haiku naming sessions), and a session's whole cost counts when its last activity falls in the range shown.</p>
  </section>;
}

function Causes({ r }: { r: ModelReportResponse }) {
  return <section>
    <h2>Tool errors by cause</h2>
    <div className="mr-tw"><table className="mr-t">
      <thead><tr><th>Cause</th>{r.models.map((m) => <th key={m.model} scope="col" className="num"><Sw slot={colorSlot(m.model, r.modelOrder)} />{m.label}</th>)}</tr></thead>
      <tbody>{CATS.map((k) => <tr key={k}><th scope="row">{CAT_LABEL[k]}<span className="mr-hint">{CAT_HINT[k]}</span></th>
        {r.models.map((m) => <td key={m.model} className="num">{fmtN(m.errors[k])}<span className="mr-sub">{fmtPct(pct(m.errors[k], m.toolCalls), 2)}</span></td>)}</tr>)}</tbody>
    </table></div>
  </section>;
}

function Patterns({ r, sel, label, onClear }: { r: ModelReportResponse; sel?: string; label: Lbl; onClear: () => void }) {
  const gs = useMemo(() => patternGroups(r, sel), [r, sel]);
  return <section data-testid="report-patterns">
    <h2>Most common errors</h2>
    {sel ? <p className="mr-filter">Showing only errors from <span className="nw"><Sw slot={colorSlot(sel, r.modelOrder)} /><b>{label(sel)}</b></span><button type="button" className="hist-btn" onClick={onClear}>Clear filter</button></p>
      : <p className="mr-note">Click a model in “Quality by model” to see only its errors.</p>}
    {gs.length ? gs.map((g) => <details key={g.cat} className="mr-pg" open={g.cat === 'misuse'}>
      <summary>{CAT_LABEL[g.cat]} <span className="muted">({fmtN(g.total)})</span></summary>
      <div className="mr-tw"><table className="mr-t mr-pat">
        <thead><tr><th className="num">Count</th><th>Error message (shortened, secrets masked)</th><th>Tool</th></tr></thead>
        <tbody>{g.items.map((p, i) => <tr key={i} title={`Last seen ${fmtDayTime(p.lastAt)}`}><td className="num">{fmtN(p.count)}</td><td><code>{p.pattern}</code></td><td className="muted">{shortTool(p.tool)}</td></tr>)}</tbody>
      </table></div>
    </details>) : <p className="muted">{sel ? 'No listed errors for this model.' : 'No tool errors.'}</p>}
  </section>;
}

function Tools({ r }: { r: ModelReportResponse }) {
  const ts = r.tools.filter((t) => t.errors > 0);
  return <div>
    <h2>Most error-prone tools</h2>
    <div className="mr-tw"><table className="mr-t">
      <thead><tr><th>Tool</th><th className="num">Calls</th><th className="num">Errors</th><th className="num">Rate</th><th>Main cause</th></tr></thead>
      <tbody>{ts.length ? ts.map((t) => { const c = mainCause(t); return <tr key={t.tool}><td><code>{shortTool(t.tool)}</code></td><td className="num">{fmtN(t.calls)}</td><td className="num">{fmtN(t.errors)}</td>
        <td className="num">{fmtPct(pct(t.errors, t.calls))}</td><td>{c ? <>{CAT_LABEL[c.cat]} <span className="muted">{fmtPct(c.share, 0)}</span></> : '–'}</td></tr>; }) : none(5)}</tbody>
    </table></div>
  </div>;
}

function Api({ r }: { r: ModelReportResponse }) {
  return <div>
    <h2>API errors</h2>
    <div className="mr-tw"><table className="mr-t">
      <thead><tr><th>Error response</th><th className="num">Count</th><th>Last seen</th></tr></thead>
      <tbody>{r.apiErrors.length ? r.apiErrors.map((a) => <tr key={a.kind}><td><code>{a.kind}</code></td><td className="num">{fmtN(a.count)}</td><td className="nw">{fmtDayTime(a.lastAt)}</td></tr>) : none(3)}</tbody>
    </table></div>
    <div className="mr-tw mr-gap"><table className="mr-t">
      <thead><tr><th>Automatic retry</th><th className="num">Incidents</th><th className="num">Retries</th></tr></thead>
      <tbody>{r.retries.length ? r.retries.map((x) => <tr key={x.kind}><td><code>{x.kind}</code></td><td className="num">{fmtN(x.incidents)}</td><td className="num">{fmtN(x.retries)}</td></tr>) : none(3)}</tbody>
    </table></div>
  </div>;
}

/** Rows open the session in the History tab (the button is the keyboard target; its click bubbles to the row). */
function Review({ r, label, onOpen }: { r: ModelReportResponse; label: Lbl; onOpen: (sid: string) => void }) {
  return <section>
    <h2>Sessions worth a review</h2>
    <p className="mr-note">Ranked by tool misuse + 2×interrupts + 2×corrections + rejections. Click a session to read its transcript in the History tab, or run <code>claude --resume &lt;id&gt;</code>.</p>
    <div className="mr-tw"><table className="mr-t" data-testid="report-review">
      <thead><tr><th>Date</th><th>Session</th><th>Model</th><th className="num">Turns</th><th className="num">Tools</th><th className="num">Misuse</th><th className="num">Interrupts</th><th className="num">Corrections</th><th className="num">Rejected</th><th className="num">Cost</th></tr></thead>
      <tbody>{r.review.length ? r.review.map((s) => <tr key={s.sid} className="mr-pick" onClick={() => onOpen(s.sid)}>
        <td className="nw">{fmtDay(s.lastAt)}</td>
        <td className="mr-ses"><button type="button" className="mr-link" title="Open in the History tab" data-testid={`report-open-${s.sid}`}>{s.title || '(untitled)'}</button><span className="mr-sub" title={s.project}>{s.projectName} · <code>{shortSid(s.sid)}</code></span></td>
        <td className="nw"><Sw slot={colorSlot(s.model, r.modelOrder)} />{label(s.model)}</td>
        <td className="num">{fmtN(s.turns)}</td><td className="num">{fmtN(s.toolCalls)}</td><td className="num">{fmtN(s.misuse)}</td><td className="num">{fmtN(s.interrupts)}</td><td className="num">{fmtN(s.corrections)}</td><td className="num">{fmtN(s.rejected)}</td><td className="num">{fmtUsd(s.costUsd)}</td>
      </tr>) : none(10)}</tbody>
    </table></div>
  </section>;
}

function Notes() {
  return <section>
    <h2>How to read this</h2>
    <ul className="mr-notes">
      <li>A transcript can't tell whether an answer was <b>right</b>. The report only measures signals: the model misusing tools, you having to interrupt or correct it, whether tests/builds end green, API errors, time and money.</li>
      <li>“Tool misuse” is the model's fault (wrong parameters, Edit strings that don't match, bad query syntax, guessed paths). DB/ES connection errors, VPN, 401/403 and auto mode blocks are counted separately because they aren't the model's fault.</li>
      <li>Comparing models is only fair when they do the same kind of work. Small models usually get easier jobs (lookup subagents), so a lower error rate doesn't mean they're better. Don't draw conclusions from models tagged “small sample”.</li>
      <li>“You correct” is a keyword count (Vietnamese with or without diacritics, plus a few English phrases), so it can misfire on a prompt like “bug X is still broken” when you're talking about a product bug.</li>
      <li>To grade real quality, have a model review a sample of sessions against a rubric (LLM-as-judge), or track what happens afterwards, such as reverted commits or reworked PRs.</li>
    </ul>
  </section>;
}
