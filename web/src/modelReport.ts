import type { ModelErrorCategory, ModelErrorPattern, ModelReportResponse, ModelStats, ModelToolStat, ModelTrendPoint, ModelTrendWeek } from './types';
/** Pure helpers for the "Hiệu suất" tab (unit-tested in test/model-report.test.ts). Wording follows _local/model-report/model_report.py; numbers are vi-VN (`1.234,5`). */

export const CATS: readonly ModelErrorCategory[] = ['misuse', 'cmd_fail', 'infra', 'auto_denied', 'user_rejected', 'other'];
export const CAT_LABEL: Record<ModelErrorCategory, string> = { misuse: 'Model dùng sai tool', cmd_fail: 'Lệnh chạy nhưng trả lỗi', infra: 'Hạ tầng / mạng', auto_denied: 'Auto mode chặn', user_rejected: 'Bạn từ chối', other: 'Khác' };
export const CAT_HINT: Record<ModelErrorCategory, string> = {
  misuse: 'Gọi sai tham số, Edit không khớp chuỗi, sửa file chưa đọc, SQL/ES query sai, đoán sai đường dẫn hoặc lệnh. Đây là lỗi do model.',
  cmd_fail: 'Bash/PowerShell trả exit code khác 0: test/build fail, grep không thấy… Không hẳn là model sai.',
  infra: 'Không kết nối được DB/ES, timeout, VPN, 401/403/5xx, MCP server lỗi. Không phải lỗi của model.',
  auto_denied: 'Bộ phân loại của auto mode chặn hành động (thường là ghi lên prd, lệnh nguy hiểm).',
  user_rejected: 'Bạn bấm từ chối khi Claude xin quyền chạy tool.', other: 'Không xếp được vào nhóm nào.',
};
/** "Lỗi gặp nhiều nhất" groups: a rejection always reads the same, so it has no group. */
export const PATTERN_CATS: readonly ModelErrorCategory[] = CATS.filter((c) => c !== 'user_rejected');
export const WINDOWS: readonly (readonly [number, string])[] = [[7, '7 ngày'], [30, '30 ngày'], [90, '90 ngày'], [0, 'Toàn bộ']];

export const pct = (a: number, b: number): number | null => b ? 100 * a / b : null;
const group = (s: string, sep: string) => s.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
/** vi-VN number with d decimals: `.` thousands, `,` decimals (1234.5 → `1.234,5`); no `-0`. */
export function fmtDec(v: number, d = 0) { const [i, f] = Math.abs(v).toFixed(d).split('.'); return `${v < 0 && /[1-9]/.test(i + (f ?? '')) ? '-' : ''}${group(i, '.')}${f ? `,${f}` : ''}`; }
/** Count: 13550 → `13.550`. */
export const fmtN = (v: number) => fmtDec(v, 0);
/** `1,59%` (d decimals), `–` when there is nothing to divide by. */
export const fmtPct = (v: number | null, d = 1) => v === null ? '–' : `${fmtDec(v, d)}%`;
/** Rate without a unit (per 100 turns): `4,4`, `–`. */
export const fmtNum = (v: number | null, d = 1) => v === null ? '–' : fmtDec(v, d);
/** `$845,06`, `$1.234,50`. */
export const fmtUsd = (v: number) => { const s = fmtDec(v, 2); return s[0] === '-' ? `-$${s.slice(1)}` : `$${s}`; };
/** Axis tick: at most one decimal, no trailing zero (`0,5`, `10`). */
export const fmtTick = (v: number) => fmtDec(v, Number.isInteger(+v.toFixed(1)) ? 0 : 1);
/** Turn time: `45 giây` under 90 s, `6.0 phút` under 90 min, then `1.6 giờ`; `–` when unknown. */
export function fmtDur(ms: number | null) {
  if (ms === null || !Number.isFinite(ms)) return '–';
  const s = Math.max(0, ms / 1000);
  return s < 90 ? `${Math.round(s)} giây` : s < 5400 ? `${fmtDec(s / 60, 1)} phút` : `${fmtDec(s / 3600, 1)} giờ`;
}
const p2 = (n: number) => String(n).padStart(2, '0');
/** Local `dd/mm`. */
export function fmtDay(ts: number) { const d = new Date(ts); return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}`; }
/** Local `dd/mm/yyyy`. */
export function fmtDate(ts: number) { return `${fmtDay(ts)}/${new Date(ts).getFullYear()}`; }
/** Local `HH:MM dd/mm/yyyy` ("cập nhật lúc …"). */
export function fmtStamp(ts: number) { const d = new Date(ts); return `${p2(d.getHours())}:${p2(d.getMinutes())} ${fmtDate(ts)}`; }
/** Local `dd/mm HH:MM`. */
export function fmtDayTime(ts: number) { const d = new Date(ts); return `${fmtDay(ts)} ${p2(d.getHours())}:${p2(d.getMinutes())}`; }
/** Trend week (its Monday, `YYYY-MM-DD`) → `dd/mm`. */
export const weekLabel = (w: string) => `${w.slice(8, 10)}/${w.slice(5, 7)}`;
/** One-line scope of the report: `30 ngày gần nhất (từ 21/10/2026)` / `toàn bộ lịch sử`. */
export const windowText = (r: Pick<ModelReportResponse, 'days' | 'since'>) => r.days > 0 ? `${r.days} ngày gần nhất (từ ${fmtDate(r.since)})` : 'toàn bộ lịch sử';

/** `claude-opus-5-5` → `Opus 5.5`, `claude-haiku-4-5-20251001` → `Haiku 4.5`; anything else unchanged. */
export function niceModel(m: string) {
  const x = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(m);
  return x ? `${x[1][0].toUpperCase()}${x[1].slice(1)} ${x[2]}${x[3] ? `.${x[3]}` : ''}` : m || '?';
}
/** Label lookup: the server's label for models in the window, else `niceModel` (trend / review rows may name older models). */
export function labeler(models: readonly Pick<ModelStats, 'model' | 'label'>[]): (id: string) => string {
  const m = new Map(models.map((x) => [x.model, x.label]));
  return (id) => m.get(id) || niceModel(id);
}
export const SLOTS = 8;
/** Chart color slot 1..8 = position in `modelOrder` (every model ever seen, so a color follows its model across windows); 0 = past the palette (neutral). */
export function colorSlot(model: string, order: readonly string[]) { const i = order.indexOf(model); return i >= 0 && i < SLOTS ? i + 1 : 0; }
/** `mcp__claude_ai_Sentry__get_issue` → `Sentry · get_issue`, `mcp__postgresql-prd__execute_query` → `postgresql-prd · execute_query`. */
export const shortTool = (n: string) => n.replace(/^mcp__(.+?)__/, (_, s: string) => `${s.replaceAll('claude_ai_', '')} · `);
export const shortSid = (sid: string) => sid.slice(0, 8);

export type Tile = { k: string; v: string; d: string };
/** The six stat tiles at the top. */
export function reportTiles(r: Pick<ModelReportResponse, 'sessions' | 'auto' | 'autoSkipped' | 'totals'>): Tile[] {
  const t = r.totals;
  return [
    { k: 'Phiên', v: fmtN(r.sessions), d: r.auto ? 'gồm cả phiên tự động (sdk-cli)' : r.autoSkipped ? `không tính ${fmtN(r.autoSkipped)} phiên tự động (sdk-cli)` : 'không tính phiên tự động (sdk-cli)' },
    { k: 'Lượt hỏi–đáp', v: fmtN(t.turns), d: `${fmtN(t.toolCalls)} lần gọi tool` },
    { k: 'Model dùng sai tool', v: fmtPct(pct(t.errors.misuse, t.toolCalls), 2), d: 'trên tổng số lần gọi tool' },
    { k: 'Bạn ngắt hoặc sửa', v: fmtNum(pct(t.interrupts + t.corrections, t.turns)), d: 'lần ngắt hoặc câu sửa trên 100 lượt' },
    { k: 'Chi phí', v: fmtUsd(t.costUsd), d: 'theo cost-state của từng phiên' },
    { k: 'Lỗi API', v: fmtN(t.apiErrors), d: `${fmtN(t.retryIncidents)} lần phải retry` },
  ];
}

export type RateCol = { key: string; label: string; title: string; unit: '%' | ''; of: (m: ModelStats) => [number, number] };
/** Rate columns of "Chất lượng theo model" (lower is better); each gets an inline data bar. */
export const RATE_COLS: readonly RateCol[] = [
  { key: 'misuse', label: 'Dùng sai tool', unit: '%', title: '% số lần gọi tool hỏng vì model gọi sai', of: (m) => [m.errors.misuse, m.toolCalls] },
  { key: 'edit', label: 'Edit hỏng', unit: '%', title: '% số lần Edit/Write hỏng vì model (không khớp chuỗi, chưa đọc file…)', of: (m) => [m.editFails, m.edits] },
  { key: 'cmd', label: 'Lệnh trả lỗi', unit: '%', title: '% số lần gọi tool mà lệnh chạy nhưng trả lỗi', of: (m) => [m.errors.cmd_fail, m.toolCalls] },
  { key: 'intr', label: 'Bạn ngắt /100 lượt', unit: '', title: 'số lần bấm Esc trên 100 lượt', of: (m) => [m.interrupts, m.turns] },
  { key: 'corr', label: 'Bạn sửa /100 câu', unit: '', title: 'số câu kiểu “sai rồi”, “vẫn lỗi” trên 100 câu hỏi', of: (m) => [m.corrections, m.prompts] },
  { key: 'rej', label: 'Bạn từ chối', unit: '%', title: '% số lần gọi tool bạn bấm từ chối', of: (m) => [m.errors.user_rejected, m.toolCalls] },
];
export const rateOf = (m: ModelStats, c: RateCol) => pct(...c.of(m));
/** Bar scale of a rate column: the largest value among models with enough data (all models when every one is a small sample). */
export function barMax(models: readonly ModelStats[], c: RateCol) {
  const big = models.filter((m) => !m.smallSample), use = big.length ? big : models;
  return use.reduce((a, m) => Math.max(a, rateOf(m, c) ?? 0), 0);
}
/** Bar length in % of its track (2..100), null = no bar. */
export const barWidth = (v: number | null, max: number): number | null => v === null || !(max > 0) ? null : Math.max(2, Math.min(100, 100 * v / max));
export const perTurn = (v: number, turns: number): number | null => turns ? v / turns : null;
/** Two most used effort levels: `high 70% · xhigh 22%`. */
export function effortTop(effort: Record<string, number>, n = 2) {
  const e = Object.entries(effort).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]), t = e.reduce((a, [, v]) => a + v, 0);
  return t ? e.slice(0, n).map(([k, v]) => `${k} ${Math.round(100 * v / t)}%`).join(' · ') : '–';
}
/** Most frequent cause of a tool's errors and its share of them. */
export function mainCause(t: ModelToolStat): { cat: ModelErrorCategory; share: number | null } | null {
  let best: ModelErrorCategory | undefined, n = 0;
  for (const c of CATS) { const v = t.byCategory[c] ?? 0; if (v > n) { best = c; n = v; } }
  return best ? { cat: best, share: pct(n, t.errors) } : null;
}

export type PatternRow = Pick<ModelErrorPattern, 'pattern' | 'count' | 'tool' | 'lastAt'>;
export type PatternGroup = { cat: ModelErrorCategory; total: number; items: PatternRow[] };
/** "Lỗi gặp nhiều nhất" groups in category order. With a model: only its patterns, counted with `byModel`, and the group total is that model's count. */
export function patternGroups(r: Pick<ModelReportResponse, 'patterns' | 'models' | 'totals'>, model?: string): PatternGroup[] {
  const m = model ? r.models.find((x) => x.model === model) : undefined;
  return PATTERN_CATS.map((cat) => {
    const items = r.patterns.filter((p) => p.category === cat).map((p) => ({ pattern: p.pattern, tool: p.tool, lastAt: p.lastAt, count: model ? p.byModel[model] ?? 0 : p.count }))
      .filter((p) => p.count > 0).sort((a, b) => b.count - a.count);
    const sum = items.reduce((a, p) => a + p.count, 0);
    return { cat, items, total: Math.max(sum, model ? m?.errors[cat] ?? 0 : r.totals.errors[cat] ?? 0) };
  }).filter((g) => g.items.length > 0);
}

export const TREND_MAX_MODELS = 5, TREND_LEAD_TURNS = 5;
export type TrendKind = 'misuse' | 'friction';
/** misuse: % of tool calls, plotted when the week has ≥30 tool calls; friction: interrupts + corrections per 100 turns, when ≥10 turns. */
export const TREND: Record<TrendKind, { min: number; vol: (p: ModelTrendPoint) => number; val: (p: ModelTrendPoint) => number }> = {
  misuse: { min: 30, vol: (p) => p.toolCalls, val: (p) => 100 * p.misuse / p.toolCalls },
  friction: { min: 10, vol: (p) => p.turns, val: (p) => 100 * (p.interrupts + p.corrections) / p.turns },
};
/** Trend weeks from the first one with ≥5 turns (the server pads the range with empty weeks; gaps after that stay). */
export function trendWeeks(trend: readonly ModelTrendWeek[]): ModelTrendWeek[] {
  const turns = (w: ModelTrendWeek) => Object.values(w.models).reduce((a, p) => a + p.turns, 0);
  let i = 0; while (i < trend.length && turns(trend[i]) < TREND_LEAD_TURNS) i++;
  return trend.slice(i);
}
export type TrendSeries = { model: string; slot: number; values: (number | null)[]; volume: number[] };
/** One line per model for a chart: models with ≥1 plotted week, most tool calls in the trend first (ties: modelOrder), at most `max`. */
export function trendSeries(trend: readonly ModelTrendWeek[], order: readonly string[], kind: TrendKind, max = TREND_MAX_MODELS): { weeks: string[]; series: TrendSeries[] } {
  const ws = trendWeeks(trend), k = TREND[kind], tot = new Map<string, number>();
  for (const w of ws) for (const [m, p] of Object.entries(w.models)) tot.set(m, (tot.get(m) ?? 0) + p.toolCalls);
  const rank = (m: string) => { const i = order.indexOf(m); return i < 0 ? Infinity : i; };
  const series = [...tot.keys()].map((model): TrendSeries => {
    const volume = ws.map((w) => { const p = w.models[model]; return p ? k.vol(p) : 0; });
    return { model, slot: colorSlot(model, order), volume, values: ws.map((w, i) => volume[i] >= k.min ? k.val(w.models[model]) : null) };
  }).filter((s) => s.values.some((v) => v !== null)).sort((a, b) => (tot.get(b.model)! - tot.get(a.model)!) || rank(a.model) - rank(b.model) || (a.model < b.model ? -1 : 1));
  return { weeks: ws.map((w) => w.week), series: series.slice(0, max) };
}
/** Y axis 0..max with round steps (python report's scale, plus 0.1 steps under 0.5). */
export function niceScale(v: number): { max: number; step: number; ticks: number[] } {
  const m = v > 0 && Number.isFinite(v) ? v : 1, step = m <= .5 ? .1 : m <= 2 ? .5 : m <= 5 ? 1 : m <= 20 ? 5 : m <= 50 ? 10 : Math.ceil(m / 50) * 10;
  const n = Math.max(1, Math.ceil(m / step - 1e-9));
  return { max: +(n * step).toFixed(2), step, ticks: Array.from({ length: n + 1 }, (_, i) => +(i * step).toFixed(2)) };
}
/** x of point i of n between x0 and x1 (a single point sits in the middle). */
export const xAt = (i: number, n: number, x0: number, x1: number) => n <= 1 ? (x0 + x1) / 2 : x0 + (x1 - x0) * i / (n - 1);
/** Week index nearest to pixel x (crosshair). */
export const nearestIndex = (px: number, n: number, x0: number, x1: number) => n <= 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round((px - x0) * (n - 1) / (x1 - x0))));
/** Indexes of weeks that get an x label: every `step`-th counted back from the last week, at most `max` labels. */
export function xTicks(n: number, max = 8): number[] {
  const step = Math.max(1, Math.ceil(n / Math.max(1, max))), out: number[] = [];
  for (let i = n - 1; i >= 0; i -= step) out.unshift(i);
  return out;
}
/** Tooltip rows for week i: only models with data that week (a model under the threshold still shows, as `–`). */
export const weekRows = (series: readonly TrendSeries[], i: number) => series.filter((s) => (s.volume[i] ?? 0) > 0);
/** Tooltip left edge: beside the crosshair (right of it in the left half, left of it in the right half), kept inside [0, w - tipW]. */
export function tipLeft(px: number, tipW: number, w: number, gap = 10) { const l = px > w / 2 ? px - gap - tipW : px + gap; return Math.max(0, Math.min(l, w - tipW)); }
/** SVG path through the plotted values; a missing week lifts the pen. */
export function linePath(values: readonly (number | null)[], x: (i: number) => number, y: (v: number) => number) {
  let d = '', pen = false;
  values.forEach((v, i) => { if (v === null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${+x(i).toFixed(1)} ${+y(v).toFixed(1)}`; pen = true; });
  return d;
}
/** Wait before the single follow-up fetch when an answer says `refreshing` (a rescan is running). */
export const RECHECK_MS = 1500;
/** User-facing text for a failed GET /model-report (status 0 = network, -1 = not JSON). */
export function reportErrorText(status: number) {
  if (status === 401 || status === 403) return 'Run token bị từ chối. Mở lại URL trong orchestrator/.run/ui-url.txt.';
  if (status === 0) return 'Không kết nối được orchestrator. Nó có đang chạy không?';
  if (status === -1) return 'Orchestrator trả về dữ liệu không đọc được.';
  if (status === 404 || status === 405 || status === 501) return 'Orchestrator này chưa có báo cáo (thiếu /model-report). Khởi động lại nó.';
  return `Không tạo được báo cáo (${status}).`;
}
