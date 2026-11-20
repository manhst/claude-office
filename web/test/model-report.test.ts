import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  fmtN, fmtDec, fmtTick, fmtPct, fmtNum, fmtUsd, fmtDur, weekRows, RECHECK_MS, fmtDay, fmtDate, fmtStamp, fmtDayTime, weekLabel, windowText, niceModel, labeler, colorSlot, SLOTS, shortTool, shortSid, reportTiles, RATE_COLS, rateOf, barMax, barWidth,
  perTurn, effortTop, mainCause, patternGroups, PATTERN_CATS, trendWeeks, trendSeries, niceScale, xAt, nearestIndex, xTicks, linePath, tipLeft, reportErrorText, pct, CATS, CAT_LABEL, CAT_HINT,
} from '../src/modelReport';
import { fetchModelReport, reportQs, ReportHttpError, reportStatus } from '../src/modelReportApi';
import { ghostSession, isGhost, loadTab, unGhost, GHOST_RETRY_MS } from '../src/history';
import type { ModelErrorCounts, ModelErrorPattern, ModelReportResponse, ModelStats, ModelTrendPoint, ModelTrendWeek } from '../src/types';

const errs = (p: Partial<ModelErrorCounts> = {}): ModelErrorCounts => ({ misuse: 0, cmd_fail: 0, infra: 0, auto_denied: 0, user_rejected: 0, other: 0, ...p });
const ms = (model: string, p: Partial<ModelStats> = {}): ModelStats => ({
  model, label: niceModel(model), sessions: 1, subagentRuns: 0, turns: 100, prompts: 80, apiCalls: 500, toolCalls: 1000, edits: 100, errors: errs(), editFails: 0, interrupts: 0, corrections: 0,
  verifyRuns: 0, verifyFails: 0, verifySessions: 0, verifyGreen: 0, turnMedianMs: null, turnP90Ms: null, outputTokens: 0, costUsd: 0, compactions: 0, maxTokensStops: 0, refusals: 0, linesChanged: 0, prs: 0,
  effort: {}, smallSample: false, ...p,
});
const pt = (p: Partial<ModelTrendPoint> = {}): ModelTrendPoint => ({ toolCalls: 0, misuse: 0, turns: 0, interrupts: 0, corrections: 0, ...p });
const wk = (week: string, models: Record<string, ModelTrendPoint> = {}): ModelTrendWeek => ({ week, models });
const pat = (category: ModelErrorPattern['category'], pattern: string, count: number, byModel: Record<string, number>, tool = 'Bash'): ModelErrorPattern => ({ category, pattern, count, tool, byModel, lastAt: 1 });
const report = (p: Partial<ModelReportResponse> = {}): ModelReportResponse => ({
  days: 30, since: 0, generatedAt: 0, scannedAt: 0, refreshing: false, auto: false, autoSkipped: 0, sessions: 0,
  totals: { turns: 0, toolCalls: 0, errors: errs(), interrupts: 0, corrections: 0, costUsd: 0, apiErrors: 0, retryIncidents: 0 },
  models: [], modelOrder: [], trend: [], patterns: [], tools: [], apiErrors: [], retries: [], review: [], ...p,
});
const O = 'claude-opus-5-5', S = 'claude-sonnet-5-5', H = 'claude-haiku-4-5-20251001';

describe('formatting (en-US: , thousands, . decimals)', () => {
  it('counts, percents, rates', () => {
    expect(fmtN(0)).toBe('0'); expect(fmtN(999)).toBe('999'); expect(fmtN(1129)).toBe('1,129'); expect(fmtN(13550)).toBe('13,550'); expect(fmtN(1234567.6)).toBe('1,234,568'); expect(fmtN(-4200)).toBe('-4,200');
    expect(fmtDec(1234.5, 1)).toBe('1,234.5'); expect(fmtDec(-0.001, 2)).toBe('0.00'); expect(fmtDec(-1.25, 1)).toBe('-1.3'); expect(fmtDec(0.3, 0)).toBe('0');
    expect(fmtPct(1.5912, 2)).toBe('1.59%'); expect(fmtPct(4.44)).toBe('4.4%'); expect(fmtPct(96.3, 0)).toBe('96%'); expect(fmtPct(1234.5)).toBe('1,234.5%'); expect(fmtPct(null)).toBe('–');
    expect(fmtNum(4.44)).toBe('4.4'); expect(fmtNum(12.3)).toBe('12.3'); expect(fmtNum(null)).toBe('–'); expect(pct(1, 0)).toBeNull(); expect(pct(1, 4)).toBe(25);
    expect(fmtTick(0.5)).toBe('0.5'); expect(fmtTick(10)).toBe('10'); expect(fmtTick(0.30000000000000004)).toBe('0.3'); expect(fmtTick(1500)).toBe('1,500');
  });
  it('money', () => {
    expect(fmtUsd(845.064)).toBe('$845.06'); expect(fmtUsd(0)).toBe('$0.00'); expect(fmtUsd(0.812)).toBe('$0.81'); expect(fmtUsd(1234.5)).toBe('$1,234.50'); expect(fmtUsd(-0.001)).toBe('$0.00'); expect(fmtUsd(-2.5)).toBe('-$2.50');
  });
  it('turn durations: s under 90 s, min under 90 min, then h', () => {
    expect(fmtDur(null)).toBe('–'); expect(fmtDur(73_000)).toBe('73 s'); expect(fmtDur(89_400)).toBe('89 s');
    expect(fmtDur(372_000)).toBe('6.2 min'); expect(fmtDur(57.1 * 60_000)).toBe('57.1 min'); expect(fmtDur(5400_000)).toBe('1.5 h');
  });
  it('dates are local mm/dd', () => {
    const t = new Date(2026, 9, 21, 9, 5).getTime();
    expect(fmtDay(t)).toBe('10/21'); expect(fmtDate(t)).toBe('10/21/2026'); expect(fmtStamp(t)).toBe('10/21/2026 09:05'); expect(fmtDayTime(t)).toBe('10/21 09:05');
    expect(weekLabel('2026-11-16')).toBe('11/16');
    expect(windowText({ days: 30, since: t })).toBe('the last 30 days (since 10/21/2026)'); expect(windowText({ days: 0, since: 0 })).toBe('all history');
  });
  it('model labels and short names', () => {
    expect(niceModel(O)).toBe('Opus 5.5'); expect(niceModel(H)).toBe('Haiku 4.5'); expect(niceModel('claude-opus-4')).toBe('Opus 4'); expect(niceModel('gpt-x')).toBe('gpt-x'); expect(niceModel('')).toBe('?');
    const l = labeler([{ model: O, label: 'Opus 5.5 (server)' }]); expect(l(O)).toBe('Opus 5.5 (server)'); expect(l(S)).toBe('Sonnet 5.5');
    expect(shortTool('mcp__claude_ai_Sentry__get_sentry_resource')).toBe('Sentry · get_sentry_resource');
    expect(shortTool('mcp__postgresql-prd__execute_query')).toBe('postgresql-prd · execute_query');
    expect(shortTool('mcp__elasticsearch-mcp-server__search')).toBe('elasticsearch-mcp-server · search');
    expect(shortTool('Bash')).toBe('Bash'); expect(shortTool('mcp__x')).toBe('mcp__x'); expect(shortSid('0123456789abcdef')).toBe('01234567');
  });
  it('categories have labels and hints', () => {
    for (const c of CATS) { expect(CAT_LABEL[c]).toBeTruthy(); expect(CAT_HINT[c]).toBeTruthy(); }
    expect(CAT_LABEL.misuse).toBe('Model misused a tool'); expect(PATTERN_CATS).not.toContain('user_rejected');
  });
});

describe('color slots', () => {
  it('follow modelOrder, not the rank in the current window', () => {
    const order = [O, S, H], a = report({ modelOrder: order, models: [ms(O), ms(S), ms(H)] }), b = report({ modelOrder: order, models: [ms(H), ms(S)] });
    const slots = (r: ModelReportResponse) => Object.fromEntries(r.models.map((m) => [m.model, colorSlot(m.model, r.modelOrder)]));
    expect(slots(a)).toEqual({ [O]: 1, [S]: 2, [H]: 3 }); expect(slots(b)).toEqual({ [H]: 3, [S]: 2 });
  });
  it('past the palette or unknown → 0 (neutral)', () => {
    const order = Array.from({ length: 10 }, (_, i) => `m${i}`);
    expect(colorSlot('m7', order)).toBe(SLOTS); expect(colorSlot('m8', order)).toBe(0); expect(colorSlot('zz', order)).toBe(0);
  });
});

describe('tiles and table rates', () => {
  it('tiles', () => {
    const t = reportTiles({ sessions: 95, auto: false, autoSkipped: 1419, totals: { turns: 1129, toolCalls: 13550, errors: errs({ misuse: 243 }), interrupts: 40, corrections: 18, costUsd: 845.06, apiErrors: 18, retryIncidents: 6 } });
    expect(t.map((x) => x.k)).toEqual(['Sessions', 'Turns', 'Model misused a tool', 'You interrupted or corrected', 'Cost', 'API errors']);
    expect(t.map((x) => x.v)).toEqual(['95', '1,129', '1.79%', '5.1', '$845.06', '18']);
    expect(t[0].d).toBe('1,419 automated sessions (sdk-cli) excluded'); expect(reportTiles({ sessions: 1, auto: false, autoSkipped: 1, totals: { ...report().totals, toolCalls: 1, retryIncidents: 1 } }).map((x) => x.d)).toEqual(expect.arrayContaining(['1 automated session (sdk-cli) excluded', '1 tool call', '1 retry incident'])); expect(t[1].d).toBe('13,550 tool calls'); expect(t[5].d).toBe('6 retry incidents');
    expect(reportTiles({ sessions: 0, auto: true, autoSkipped: 0, totals: report().totals }).map((x) => x.v)).toEqual(['0', '0', '–', '–', '$0.00', '0']);
    expect(reportTiles({ sessions: 0, auto: true, autoSkipped: 0, totals: report().totals })[0].d).toMatch(/included/);
  });
  it('rates and bar scale ignore small samples', () => {
    const mis = RATE_COLS.find((c) => c.key === 'misuse')!, edit = RATE_COLS.find((c) => c.key === 'edit')!, corr = RATE_COLS.find((c) => c.key === 'corr')!;
    const a = ms(O, { errors: errs({ misuse: 16 }) }), b = ms(S, { errors: errs({ misuse: 47 }) }), small = ms(H, { toolCalls: 10, errors: errs({ misuse: 5 }), smallSample: true, edits: 0 });
    expect(rateOf(a, mis)).toBeCloseTo(1.6); expect(rateOf(small, edit)).toBeNull(); expect(rateOf(ms(O, { corrections: 2, prompts: 40 }), corr)).toBe(5);
    expect(barMax([a, b, small], mis)).toBeCloseTo(4.7); // 50% of the small model is ignored
    expect(barMax([small], mis)).toBe(50); // only small samples: scale on them
    expect(barWidth(4.7, 4.7)).toBe(100); expect(barWidth(50, 4.7)).toBe(100); expect(barWidth(0, 4.7)).toBe(2); expect(barWidth(2.35, 4.7)).toBeCloseTo(50);
    expect(barWidth(null, 4.7)).toBeNull(); expect(barWidth(1, 0)).toBeNull();
  });
  it('per turn, effort, main cause', () => {
    expect(perTurn(1230, 100)).toBe(12.3); expect(perTurn(5, 0)).toBeNull();
    expect(effortTop({ high: 70, xhigh: 22, medium: 8 })).toBe('high 70% · xhigh 22%'); expect(effortTop({})).toBe('–'); expect(effortTop({ low: 0 })).toBe('–');
    expect(mainCause({ tool: 'Bash', calls: 100, errors: 10, byCategory: { cmd_fail: 6, misuse: 4 } })).toEqual({ cat: 'cmd_fail', share: 60 });
    expect(mainCause({ tool: 'Bash', calls: 100, errors: 0, byCategory: {} })).toBeNull();
  });
});

describe('patternGroups', () => {
  const r = report({
    models: [ms(O, { errors: errs({ misuse: 30, infra: 9 }) }), ms(S, { errors: errs({ misuse: 12 }) })],
    totals: { ...report().totals, errors: errs({ misuse: 42, infra: 9, user_rejected: 3 }) },
    patterns: [pat('misuse', 'column "…" does not exist', 20, { [O]: 15, [S]: 5 }, 'mcp__postgresql-prd__execute_query'), pat('misuse', 'Exit code 1 · x not found', 12, { [S]: 7, [O]: 5 }),
      pat('infra', 'Failed to connect to <ip>', 9, { [O]: 9 }), pat('user_rejected', "The user doesn't want to proceed", 3, { [O]: 3 })],
  });
  it('all models: category order, server counts, totals from the window', () => {
    const g = patternGroups(r);
    expect(g.map((x) => x.cat)).toEqual(['misuse', 'infra']); // user_rejected has no group, empty categories are dropped
    expect(g[0].items.map((p) => p.count)).toEqual([20, 12]); expect(g[0].total).toBe(42); expect(g[1].total).toBe(9);
  });
  it('one model: byModel counts, re-sorted, its own totals; others dropped', () => {
    const g = patternGroups(r, S);
    expect(g.map((x) => x.cat)).toEqual(['misuse']); expect(g[0].items.map((p) => [p.pattern, p.count])).toEqual([['Exit code 1 · x not found', 7], ['column "…" does not exist', 5]]); expect(g[0].total).toBe(12);
    expect(patternGroups(r, O).find((x) => x.cat === 'infra')?.items[0].count).toBe(9);
    expect(patternGroups(r, 'claude-nope')).toEqual([]);
  });
});

describe('trend', () => {
  const weeks = [wk('2026-08-31'), wk('2026-09-07', { [O]: pt({ turns: 3, toolCalls: 40 }) }), wk('2026-09-14', { [O]: pt({ turns: 20, toolCalls: 200, misuse: 4, interrupts: 1, corrections: 1 }), [S]: pt({ turns: 9, toolCalls: 29, misuse: 3 }) }),
    wk('2026-09-21'), wk('2026-09-28', { [O]: pt({ turns: 10, toolCalls: 30, misuse: 3 }), [S]: pt({ turns: 12, toolCalls: 100, misuse: 2, interrupts: 3 }) })];
  it('drops leading weeks under 5 turns, keeps gaps after', () => {
    expect(trendWeeks(weeks).map((w) => w.week)).toEqual(['2026-09-14', '2026-09-21', '2026-09-28']); expect(trendWeeks([wk('a'), wk('b')])).toEqual([]);
  });
  it('misuse: points only with ≥30 tool calls; friction: ≥10 turns', () => {
    const order = [S, O], m = trendSeries(weeks, order, 'misuse'), f = trendSeries(weeks, order, 'friction');
    expect(m.weeks).toEqual(['2026-09-14', '2026-09-21', '2026-09-28']);
    const mo = m.series.find((s) => s.model === O)!, mS = m.series.find((s) => s.model === S)!;
    expect(mo.values).toEqual([2, null, 10]); expect(mo.volume).toEqual([200, 0, 30]); expect(mS.values).toEqual([null, null, 2]); // 29 calls: no point
    expect(f.series.find((s) => s.model === O)!.values).toEqual([10, null, 0]); expect(f.series.find((s) => s.model === S)!.values).toEqual([null, null, 25]); // 9 turns: no point
    expect(f.series.find((s) => s.model === O)!.volume).toEqual([20, 0, 10]);
    expect(m.series.map((s) => [s.model, s.slot])).toEqual([[O, 2], [S, 1]]); // most tool calls first; colors from modelOrder
  });
  it('drops models with no point and keeps at most 5 by volume', () => {
    const many = [wk('2026-01-05', Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`m${i}`, pt({ turns: 10, toolCalls: 100 + i })]))), wk('2026-01-12', { x: pt({ turns: 10, toolCalls: 5 }) })];
    const s = trendSeries(many, [], 'misuse');
    expect(s.series.map((x) => x.model)).toEqual(['m6', 'm5', 'm4', 'm3', 'm2']); expect(s.series.every((x) => x.slot === 0)).toBe(true);
    expect(trendSeries(many, [], 'misuse', 2).series).toHaveLength(2);
    expect(trendSeries([wk('2026-01-05', { a: pt({ turns: 6, toolCalls: 3 }) })], [], 'misuse').series).toEqual([]);
  });
  it('scale, x positions, labels, path', () => {
    expect(niceScale(1.87)).toEqual({ max: 2, step: .5, ticks: [0, .5, 1, 1.5, 2] });
    expect(niceScale(16.39).ticks).toEqual([0, 5, 10, 15, 20]); expect(niceScale(37).max).toBe(40); expect(niceScale(100)).toMatchObject({ max: 100, step: 20 });
    expect(niceScale(0.3).ticks).toEqual([0, .1, .2, .3]); expect(niceScale(0).max).toBe(1); expect(niceScale(NaN).max).toBe(1);
    expect(xAt(0, 5, 40, 440)).toBe(40); expect(xAt(4, 5, 40, 440)).toBe(440); expect(xAt(0, 1, 40, 440)).toBe(240);
    expect(nearestIndex(0, 5, 40, 440)).toBe(0); expect(nearestIndex(250, 5, 40, 440)).toBe(2); expect(nearestIndex(999, 5, 40, 440)).toBe(4); expect(nearestIndex(300, 1, 40, 440)).toBe(0);
    expect(xTicks(6)).toEqual([0, 1, 2, 3, 4, 5]); expect(xTicks(52)).toEqual([2, 9, 16, 23, 30, 37, 44, 51]); expect(xTicks(12, 4)).toEqual([2, 5, 8, 11]); expect(xTicks(0)).toEqual([]);
    const ser = trendSeries(weeks, [O, S], 'misuse').series, ord = (i: number) => weekRows(ser, i).map((s) => s.model);
    expect(ord(0)).toEqual([O, S]); expect(ord(1)).toEqual([]); expect(ord(2)).toEqual([O, S]); // week 0: S has 29 calls (row shows –); week 1: nobody worked, no rows
    expect(tipLeft(100, 200, 600)).toBe(110); expect(tipLeft(500, 200, 600)).toBe(290); // right of the crosshair in the left half, left of it in the right half
    expect(tipLeft(250, 250, 360)).toBe(0); expect(tipLeft(150, 250, 360)).toBe(110); expect(tipLeft(10, 400, 360)).toBe(0); // kept inside the plot
    expect(linePath([1, null, 2, 3], (i) => i * 10, (v) => v)).toBe('M0 1M20 2L30 3'); expect(linePath([null], (i) => i, (v) => v)).toBe('');
  });
});

describe('model report api', () => {
  afterEach(() => vi.unstubAllGlobals());
  const env = () => { vi.stubGlobal('sessionStorage', { getItem: () => '127.0.0.1:7777' }); vi.stubGlobal('location', { port: '7777', host: '127.0.0.1:7777' }); };
  it('query string', () => {
    expect(reportQs({ days: 30, auto: false })).toBe('?days=30&auto=0'); expect(reportQs({ days: 0, auto: true })).toBe('?days=0&auto=1'); expect(reportQs({ days: -3.5, auto: false })).toBe('?days=0&auto=0');
    expect(reportQs({ days: 7, auto: false, fresh: true })).toBe('?days=7&auto=0&fresh=1'); expect(reportQs({ days: 7, auto: false, fresh: false })).toBe('?days=7&auto=0');
  });
  it('sends the token only in the Authorization header', async () => {
    env(); const f = vi.fn(async () => ({ ok: true, status: 200, json: async () => report({ days: 7 }) })); vi.stubGlobal('fetch', f);
    const r = await fetchModelReport('tok', { days: 7, auto: true });
    expect(r.days).toBe(7);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:7777/model-report?days=7&auto=1'); expect(url).not.toContain('tok');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok'); expect(init.cache).toBe('no-store');
    await fetchModelReport('tok', { days: 30, auto: false, fresh: true });
    expect((f.mock.calls[1] as unknown as [string])[0]).toBe('http://127.0.0.1:7777/model-report?days=30&auto=0&fresh=1');
    expect(RECHECK_MS).toBeGreaterThan(0);
  });
  it('maps failures to status codes and Vietnamese text', async () => {
    env();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })));
    await expect(fetchModelReport('t', { days: 30, auto: false })).rejects.toMatchObject({ status: 401 });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const e = await fetchModelReport('t', { days: 30, auto: false }).catch((x) => x); expect(e).toBeInstanceOf(ReportHttpError); expect(reportStatus(e)).toBe(0);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('html'); } })));
    await expect(fetchModelReport('t', { days: 30, auto: false })).rejects.toMatchObject({ status: -1 });
    expect(reportStatus(new Error('x'))).toBe(0);
    expect(reportErrorText(403)).toMatch(/token/); expect(reportErrorText(0)).toMatch(/reach/); expect(reportErrorText(404)).toMatch(/model-report/); expect(reportErrorText(500)).toMatch(/500/); expect(reportErrorText(-1)).toMatch(/can't be read/);
  });
  it('aborts pass through untouched', async () => {
    env(); const ac = new AbortController(); ac.abort();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('aborted', 'AbortError'); }));
    await expect(fetchModelReport('t', { days: 30, auto: false }, ac.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('tab + History deep link', () => {
  it('report is a main tab', () => { expect(loadTab({ getItem: () => 'report', setItem: () => {} })).toBe('report'); });
  it('ghost session placeholder', () => {
    const g = ghostSession('abc'); expect(g.sid).toBe('abc'); expect(isGhost(g)).toBe(true); expect(isGhost({ ...g, bytes: 0 })).toBe(false); expect(GHOST_RETRY_MS).toBeGreaterThan(0);
  });
  it('a placeholder becomes the loaded session (also when the same sid is reopened)', () => {
    const g = ghostSession('abc'), real = { ...g, bytes: 10, title: 'Real' };
    expect(unGhost(g, { sid: 'abc', data: { session: real } })).toBe(real);
    expect(unGhost(g, { sid: 'abc' })).toBe(g); expect(unGhost(g, { sid: 'other', data: { session: real } })).toBe(g); // not loaded yet / another sid
    expect(unGhost(real, { sid: 'abc', data: { session: { ...real, title: 'x' } } })).toBe(real); // a real row is kept as is
  });
});
