import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import type { ModelReportResponse, ModelStats } from './types';
import { fetchModelReport, reportStatus } from './modelReportApi';
import { isAbort } from './historyApi';
import {
  barMax, barWidth, CAT_HINT, CAT_LABEL, CATS, colorSlot, effortTop, fmtDay, fmtDayTime, fmtDec, fmtDur, fmtN, fmtNum, fmtPct, fmtStamp, fmtTick, fmtUsd, labeler, linePath, mainCause, nearestIndex, niceScale,
  patternGroups, pct, perTurn, RATE_COLS, rateOf, RECHECK_MS, reportErrorText, reportTiles, shortSid, shortTool, tipLeft, trendSeries, weekLabel, weekRows, windowText, WINDOWS, xAt, xTicks, type TrendKind,
} from './modelReport';

type Lbl = (id: string) => string;
/** Series color of a slot (0 = neutral); text never takes it, only swatches, lines and markers. */
const slotVar = (s: number) => ({ '--c': `var(--mr-s${s})` } as CSSProperties);
function Sw({ slot }: { slot: number }) { return <span className="mr-sw" style={slotVar(slot)} aria-hidden="true" />; }
function Model({ m, order }: { m: ModelStats; order: readonly string[] }) { return <><Sw slot={colorSlot(m.model, order)} />{m.label}{m.smallSample ? <Small /> : null}</>; }
function Small() { return <span className="mr-tag" title="Dưới 200 lần gọi tool hoặc dưới 20 lượt: tỉ lệ chưa có ý nghĩa">ít dữ liệu</span>; }
const none = (cols: number) => <tr><td colSpan={cols} className="muted">Không có</td></tr>;

/** "Hiệu suất" tab: how each Claude model did in this machine's Claude Code transcripts (GET /model-report). Fetches only while visible. */
export const ModelReportView = memo(function ModelReportView({ token, active, onOpenSession }: { token: string; active: boolean; onOpenSession: (sid: string) => void }) {
  const [days, setDays] = useState(30), [auto, setAuto] = useState(false), [reload, setReload] = useState(0);
  const [data, setData] = useState<{ r: ModelReportResponse; key: string }>(), [loading, setLoading] = useState(false), [recheck, setRecheck] = useState(false), [err, setErr] = useState<string>(), [pick, setPick] = useState<string>();
  const done = useRef<string | undefined>(undefined), freshAt = useRef(-1), key = `${days}|${auto ? 1 : 0}|${reload}`;
  useEffect(() => { // a window/auto change or "Làm mới" makes a new key; the last report stays up (dimmed) until the new one lands. Hidden → abort, refetched on return.
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
  const refresh = () => { freshAt.current = reload + 1; setReload(reload + 1); }; // only "Làm mới" / "Thử lại" ask the server to rescan first
  return (
    <div className="mr" data-testid="report">
      <div className="mr-head">
        <div className="cc-seg" role="group" aria-label="Khoảng thời gian">{WINDOWS.map(([d, l]) => <button key={d} type="button" aria-pressed={d === days} onClick={() => setDays(d)} data-testid={`report-days-${d}`}>{l}</button>)}</div>
        <label className="hist-auto" title="Phiên chạy bằng claude -p từ script/plugin (entrypoint sdk-cli)"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} data-testid="report-auto" />Tính cả phiên tự động (sdk-cli)</label>
        <button type="button" className="hist-btn" onClick={refresh} disabled={loading} data-testid="report-refresh">Làm mới</button>
        <span className="mr-stamp" role="status" title={r ? `Báo cáo tạo lúc ${fmtStamp(r.generatedAt)}` : undefined}>{loading ? 'Đang tạo báo cáo…' : r ? `dữ liệu lúc ${fmtStamp(r.scannedAt || r.generatedAt)}${recheck ? ' · đang quét lại…' : ''}` : ''}</span>
      </div>
      {err ? <div className="hist-err" role="alert"><span>{err}</span><button type="button" className="hist-btn" onClick={refresh} disabled={loading}>Thử lại</button></div> : null}
      {r ? <Report r={r} stale={loading || data?.key !== key} sel={sel} onPick={onPick} onOpen={onOpenSession} />
        : loading ? <div className="muted hist-empty">Đang đọc transcript Claude Code…</div> : null}
    </div>
  );
});

const Report = memo(function Report({ r, stale, sel, onPick, onOpen }: { r: ModelReportResponse; stale: boolean; sel?: string; onPick: (m: string) => void; onOpen: (sid: string) => void }) {
  const label = useMemo(() => labeler(r.models), [r.models]), has = r.models.length > 0;
  return (
    <div className={`mr-body${stale ? ' stale' : ''}`}>
      <p className="mr-lead">Từ transcript Claude Code trên máy này, {windowText(r)}. Mọi số là tín hiệu gián tiếp; xem phần “Cách đọc” ở cuối.</p>
      <div className="mr-tiles">{reportTiles(r).map((t) => <div key={t.k} className="mr-tile"><div className="k">{t.k}</div><div className="v">{t.v}</div><div className="d">{t.d}</div></div>)}</div>
      {has ? <Quality r={r} sel={sel} onPick={onPick} /> : <p className="muted hist-empty">Không có phiên Claude Code nào trong khoảng này{r.auto ? '' : ' (chưa tính phiên tự động)'}.</p>}
      <h2>Xu hướng theo tuần</h2>
      <p className="mr-note">Mỗi đường là một model (tối đa 5 model gọi tool nhiều nhất trong giai đoạn này). Màu của mỗi model giữ nguyên khi đổi khoảng thời gian.</p>
      <div className="mr-charts">
        <TrendChart r={r} kind="misuse" title="Model dùng sai tool" sub="% số lần gọi tool, tuần có ít nhất 30 lần gọi" unit="%" vol="lần gọi tool" label={label} />
        <TrendChart r={r} kind="friction" title="Bạn ngắt hoặc sửa" sub="số lần trên 100 lượt, tuần có ít nhất 10 lượt" unit="" vol="lượt" label={label} />
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
    <h2>Chất lượng theo model</h2>
    <p className="mr-note">Thấp là tốt, trừ cột cuối. “Bạn ngắt” = số lần bấm Esc trên 100 lượt. “Bạn sửa” = số câu kiểu “sai rồi”, “vẫn lỗi”, “làm lại”, “revert” trên 100 câu hỏi (ước lượng theo từ khoá). Test/build xanh = phiên có chạy test, build hoặc typecheck mà lần chạy cuối cùng pass. Bấm vào một model để lọc phần “Lỗi gặp nhiều nhất”.</p>
    <div className="mr-tw"><table className="mr-t" data-testid="report-quality">
      <thead><tr><th>Model</th><th className="num">Phiên</th><th className="num">Lượt</th><th className="num">Gọi tool</th>{RATE_COLS.map((c) => <th key={c.key} className="num" title={c.title}>{c.label}</th>)}<th className="num">Test/build fail</th><th className="num">Lần cuối xanh</th></tr></thead>
      <tbody>{ms.map((m) => { const on = sel === m.model; return <tr key={m.model} className={`mr-pick${on ? ' sel' : ''}`} onClick={() => onPick(m.model)}>
        <th scope="row"><button type="button" className="mr-mbtn" aria-pressed={on} title={on ? 'Bỏ lọc' : 'Chỉ xem lỗi của model này'}><Sw slot={colorSlot(m.model, r.modelOrder)} />{m.label}</button>{m.smallSample ? <Small /> : null}</th>
        <td className="num">{fmtN(m.sessions)}{m.subagentRuns ? <span className="mr-sub">+ {fmtN(m.subagentRuns)} subagent</span> : null}</td>
        <td className="num">{fmtN(m.turns)}</td><td className="num">{fmtN(m.toolCalls)}</td>
        {RATE_COLS.map((c, i) => <Rate key={c.key} v={rateOf(m, c)} max={mx[i]} unit={c.unit} />)}
        <td className="num">{fmtPct(pct(m.verifyFails, m.verifyRuns), 0)}<span className="mr-sub">{fmtN(m.verifyFails)}/{fmtN(m.verifyRuns)} lần</span></td>
        <td className="num">{fmtPct(pct(m.verifyGreen, m.verifySessions), 0)}<span className="mr-sub">{fmtN(m.verifyGreen)}/{fmtN(m.verifySessions)} phiên</span></td>
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
      {empty ? <div className="muted mr-nodata">Chưa đủ dữ liệu theo tuần.</div> : w > 0 ? <svg width={w} height={CH} role="img" aria-label={`${title} theo tuần: ${t.series.map((s) => label(s.model)).join(', ')}`} tabIndex={0}
        onPointerMove={(e) => { setKb(false); move(e); }} onPointerLeave={() => setHi(undefined)} onKeyDown={key} onBlur={() => setHi(undefined)}>
        <g className="mr-grid">{sc.ticks.map((v) => <line key={v} x1={CL} x2={x1} y1={y(v)} y2={y(v)} />)}</g>
        <g className="mr-axis">{sc.ticks.map((v) => <text key={v} x={CL - 6} y={y(v) + 3.5} textAnchor="end">{`${fmtTick(v)}${unit}`}</text>)}
          {xTicks(n, Math.floor((x1 - CL) / 46) + 1).map((i) => <text key={i} x={x(i)} y={CH - 6} textAnchor="middle">{weekLabel(t.weeks[i])}</text>)}</g>
        {h !== undefined ? <line className="mr-xh" x1={x(h)} x2={x(h)} y1={CT} y2={CH - CB} /> : null}
        {t.series.map((s) => <g key={s.model} className="mr-line" style={slotVar(s.slot)}><path d={linePath(s.values, x, y)} />
          {s.values.map((v, i) => v === null ? null : <circle key={i} cx={x(i)} cy={y(v)} r={i === h ? 5 : 4} />)}</g>)}
      </svg> : null}
      {h !== undefined && !empty ? <div className="mr-tip" ref={tip} style={{ left: tipLeft(x(h), tw, w) }}>
        <div className="muted">Tuần từ {weekLabel(t.weeks[h])}</div>
        {rows.length ? rows.map((s) => <div key={s.model}><Sw slot={s.slot} />{label(s.model)}: <b>{fmt(s.values[h])}</b> <span className="muted">({fmtN(s.volume[h])} {vol})</span></div>) : <div className="muted">Không có dữ liệu tuần này</div>}
      </div> : null}
    </div>
    <span className="mr-sr" aria-live="polite">{kb && h !== undefined ? `Tuần từ ${weekLabel(t.weeks[h])}: ${rows.length ? rows.map(line).join('; ') : 'không có dữ liệu'}` : ''}</span>
    {!empty ? <div className="mr-legend">{t.series.map((s) => <span key={s.model}><Sw slot={s.slot} />{label(s.model)}</span>)}</div> : null}
  </div>;
}

function Speed({ r }: { r: ModelReportResponse }) {
  const ms = r.models.filter((m) => m.turns || m.toolCalls), mt = ms.some((m) => m.maxTokensStops), rf = ms.some((m) => m.refusals);
  return <section>
    <h2>Tốc độ và chi phí</h2>
    <div className="mr-tw"><table className="mr-t">
      <thead><tr><th>Model</th><th className="num">Thời gian lượt (trung vị)</th><th className="num">p90</th><th className="num">Tool / lượt</th><th className="num">Token ra / lượt</th><th className="num">Chi phí</th><th className="num">$ / lượt</th><th className="num">Compact</th>
        {mt ? <th className="num">Cắt vì max_tokens</th> : null}{rf ? <th className="num">Từ chối trả lời</th> : null}<th className="num">Dòng code sửa</th><th className="num">PR tạo</th><th>Effort hay dùng</th></tr></thead>
      <tbody>{ms.length ? ms.map((m) => { const ot = perTurn(m.outputTokens, m.turns), ct = perTurn(m.costUsd, m.turns); return <tr key={m.model}>
        <th scope="row"><Model m={m} order={r.modelOrder} /></th><td className="num">{fmtDur(m.turnMedianMs)}</td><td className="num">{fmtDur(m.turnP90Ms)}</td>
        <td className="num">{fmtNum(perTurn(m.toolCalls, m.turns))}</td><td className="num">{ot === null ? '–' : fmtN(ot)}</td><td className="num">{fmtUsd(m.costUsd)}</td><td className="num">{ct === null ? '–' : fmtUsd(ct)}</td>
        <td className="num">{fmtN(m.compactions)}</td>{mt ? <td className="num">{fmtN(m.maxTokensStops)}</td> : null}{rf ? <td className="num">{fmtN(m.refusals)}</td> : null}
        <td className="num">{fmtN(m.linesChanged)}</td><td className="num">{fmtN(m.prs)}</td><td className="nw">{effortTop(m.effort)}</td>
      </tr>; }) : none(11 + +mt + +rf)}</tbody>
    </table></div>
    <p className="mr-note mr-after">Chi phí lấy theo model trong cost-state của từng phiên (gồm cả subagent và các lệnh phụ). Thời gian lượt tính từ lúc bạn gửi câu hỏi tới dòng cuối cùng trước câu hỏi tiếp theo, nên gồm cả lúc chờ bạn duyệt quyền.</p>
    <p className="mr-note">Tổng chi phí ở trên còn gồm lệnh phụ của các model không có dòng ở đây (ví dụ Haiku đặt tiêu đề phiên), và một phiên được tính trọn chi phí khi hoạt động cuối của nó nằm trong khoảng đang xem.</p>
  </section>;
}

function Causes({ r }: { r: ModelReportResponse }) {
  return <section>
    <h2>Lỗi tool chia theo nguyên nhân</h2>
    <div className="mr-tw"><table className="mr-t">
      <thead><tr><th>Nguyên nhân</th>{r.models.map((m) => <th key={m.model} scope="col" className="num"><Sw slot={colorSlot(m.model, r.modelOrder)} />{m.label}</th>)}</tr></thead>
      <tbody>{CATS.map((k) => <tr key={k}><th scope="row">{CAT_LABEL[k]}<span className="mr-hint">{CAT_HINT[k]}</span></th>
        {r.models.map((m) => <td key={m.model} className="num">{fmtN(m.errors[k])}<span className="mr-sub">{fmtPct(pct(m.errors[k], m.toolCalls), 2)}</span></td>)}</tr>)}</tbody>
    </table></div>
  </section>;
}

function Patterns({ r, sel, label, onClear }: { r: ModelReportResponse; sel?: string; label: Lbl; onClear: () => void }) {
  const gs = useMemo(() => patternGroups(r, sel), [r, sel]);
  return <section data-testid="report-patterns">
    <h2>Lỗi gặp nhiều nhất</h2>
    {sel ? <p className="mr-filter">Chỉ hiện lỗi của <span className="nw"><Sw slot={colorSlot(sel, r.modelOrder)} /><b>{label(sel)}</b></span><button type="button" className="hist-btn" onClick={onClear}>Bỏ lọc</button></p>
      : <p className="mr-note">Bấm vào một model trong bảng “Chất lượng theo model” để chỉ xem lỗi của model đó.</p>}
    {gs.length ? gs.map((g) => <details key={g.cat} className="mr-pg" open={g.cat === 'misuse'}>
      <summary>{CAT_LABEL[g.cat]} <span className="muted">({fmtN(g.total)})</span></summary>
      <div className="mr-tw"><table className="mr-t mr-pat">
        <thead><tr><th className="num">Lần</th><th>Thông báo lỗi (đã rút gọn, che secret)</th><th>Tool</th></tr></thead>
        <tbody>{g.items.map((p, i) => <tr key={i} title={`Gần nhất ${fmtDayTime(p.lastAt)}`}><td className="num">{fmtN(p.count)}</td><td><code>{p.pattern}</code></td><td className="muted">{shortTool(p.tool)}</td></tr>)}</tbody>
      </table></div>
    </details>) : <p className="muted">{sel ? 'Model này không có lỗi nào trong danh sách.' : 'Không có lỗi tool nào.'}</p>}
  </section>;
}

function Tools({ r }: { r: ModelReportResponse }) {
  const ts = r.tools.filter((t) => t.errors > 0);
  return <div>
    <h2>Tool hay lỗi nhất</h2>
    <div className="mr-tw"><table className="mr-t">
      <thead><tr><th>Tool</th><th className="num">Gọi</th><th className="num">Lỗi</th><th className="num">Tỉ lệ</th><th>Nguyên nhân chính</th></tr></thead>
      <tbody>{ts.length ? ts.map((t) => { const c = mainCause(t); return <tr key={t.tool}><td><code>{shortTool(t.tool)}</code></td><td className="num">{fmtN(t.calls)}</td><td className="num">{fmtN(t.errors)}</td>
        <td className="num">{fmtPct(pct(t.errors, t.calls))}</td><td>{c ? <>{CAT_LABEL[c.cat]} <span className="muted">{fmtPct(c.share, 0)}</span></> : '–'}</td></tr>; }) : none(5)}</tbody>
    </table></div>
  </div>;
}

function Api({ r }: { r: ModelReportResponse }) {
  return <div>
    <h2>Lỗi phía API</h2>
    <div className="mr-tw"><table className="mr-t">
      <thead><tr><th>Phản hồi lỗi</th><th className="num">Lần</th><th>Gần nhất</th></tr></thead>
      <tbody>{r.apiErrors.length ? r.apiErrors.map((a) => <tr key={a.kind}><td><code>{a.kind}</code></td><td className="num">{fmtN(a.count)}</td><td className="nw">{fmtDayTime(a.lastAt)}</td></tr>) : none(3)}</tbody>
    </table></div>
    <div className="mr-tw mr-gap"><table className="mr-t">
      <thead><tr><th>Retry tự động</th><th className="num">Sự cố</th><th className="num">Lần retry</th></tr></thead>
      <tbody>{r.retries.length ? r.retries.map((x) => <tr key={x.kind}><td><code>{x.kind}</code></td><td className="num">{fmtN(x.incidents)}</td><td className="num">{fmtN(x.retries)}</td></tr>) : none(3)}</tbody>
    </table></div>
  </div>;
}

/** Rows open the session in the History tab (the button is the keyboard target; its click bubbles to the row). */
function Review({ r, label, onOpen }: { r: ModelReportResponse; label: Lbl; onOpen: (sid: string) => void }) {
  return <section>
    <h2>Phiên nên xem lại</h2>
    <p className="mr-note">Xếp theo: dùng sai tool + 2×ngắt + 2×sửa + từ chối. Bấm vào một phiên để đọc transcript trong tab Lịch sử, hoặc chạy <code>claude --resume &lt;mã&gt;</code>.</p>
    <div className="mr-tw"><table className="mr-t" data-testid="report-review">
      <thead><tr><th>Ngày</th><th>Phiên</th><th>Model</th><th className="num">Lượt</th><th className="num">Tool</th><th className="num">Sai tool</th><th className="num">Ngắt</th><th className="num">Sửa</th><th className="num">Từ chối</th><th className="num">Chi phí</th></tr></thead>
      <tbody>{r.review.length ? r.review.map((s) => <tr key={s.sid} className="mr-pick" onClick={() => onOpen(s.sid)}>
        <td className="nw">{fmtDay(s.lastAt)}</td>
        <td className="mr-ses"><button type="button" className="mr-link" title="Mở trong tab Lịch sử" data-testid={`report-open-${s.sid}`}>{s.title || '(không tên)'}</button><span className="mr-sub" title={s.project}>{s.projectName} · <code>{shortSid(s.sid)}</code></span></td>
        <td className="nw"><Sw slot={colorSlot(s.model, r.modelOrder)} />{label(s.model)}</td>
        <td className="num">{fmtN(s.turns)}</td><td className="num">{fmtN(s.toolCalls)}</td><td className="num">{fmtN(s.misuse)}</td><td className="num">{fmtN(s.interrupts)}</td><td className="num">{fmtN(s.corrections)}</td><td className="num">{fmtN(s.rejected)}</td><td className="num">{fmtUsd(s.costUsd)}</td>
      </tr>) : none(10)}</tbody>
    </table></div>
  </section>;
}

function Notes() {
  return <section>
    <h2>Cách đọc</h2>
    <ul className="mr-notes">
      <li>Transcript không cho biết câu trả lời có <b>đúng</b> hay không. Báo cáo chỉ đo các dấu hiệu: model gọi tool sai, bạn phải ngắt hoặc sửa, test/build có xanh ở cuối phiên, lỗi API, thời gian và tiền.</li>
      <li>“Dùng sai tool” là lỗi do model (sai tham số, Edit không khớp, query sai cú pháp, đoán sai đường dẫn). Lỗi kết nối DB/ES, VPN, 401/403, auto mode chặn được tách riêng vì không phải lỗi của model.</li>
      <li>So sánh giữa các model chỉ công bằng khi chúng làm việc giống nhau. Model nhỏ thường được giao việc dễ hơn (subagent tra cứu), nên tỉ lệ lỗi thấp chưa chắc là giỏi hơn. Model có nhãn “ít dữ liệu” thì đừng kết luận.</li>
      <li>“Bạn sửa” đếm theo từ khoá (cả có dấu lẫn không dấu), có thể bắt nhầm câu như “fix lỗi X vẫn còn” khi bạn nói về bug của sản phẩm.</li>
      <li>Muốn chấm điểm chất lượng thật: cho một model đọc lại một mẫu phiên và chấm theo tiêu chí (LLM-as-judge), hoặc theo dõi kết quả sau phiên như commit bị revert hay PR bị sửa lại.</li>
    </ul>
  </section>;
}
