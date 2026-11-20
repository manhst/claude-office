import { createReadStream, type Dirent } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { redactText } from './redact.js';
import { HISTORY_SID, decodeProjectDir, projectLabel, promptText } from './history.js';
import type { ModelApiErrorStat, ModelErrorCategory, ModelErrorCounts, ModelErrorPattern, ModelReportResponse, ModelRetryStat, ModelReviewSession, ModelStats, ModelToolStat, ModelTrendWeek } from './types.js';

// Heuristics ported from _local/model-report/model_report.py (keep both in step).
const CATS: ModelErrorCategory[] = ['misuse', 'cmd_fail', 'infra', 'auto_denied', 'user_rejected', 'other'];
const R_REJ = /doesn't want to (proceed|take this action)|User rejected|interrupted by user for tool use/i;
const R_INFRA_X = /gave no verdict|server-side auto mode classifier|while (reading from|writing to) stream|column reference \W*table_schema\W* is ambiguous/i;
const R_DENY = /Permission (for this action|to use \S+) (was|has been) denied|denied by the Claude Code auto/i;
const R_MISUSE_X = /\*\*Input Error\*\*|not found or inaccessible|\b404 (Project )?Not Found|\w_not_found\b|Validation error|failed to deserialize|missing field|old_str was not found/i;
const R_INFRA = new RegExp(String.raw`Failed to connect|No such host|nodename nor servname|Could not resolve host|Exception while reading from stream|ECONN(REFUSED|RESET)|ETIMEDOUT|EAI_AGAIN|ENOTFOUND` +
  String.raw`|timed? ?out|^Exit code 28\b|error sending request|error decoding response body|Connection (refused|reset|closed)|socket hang up|Method Not Allowed` +
  String.raw`|\b(HTTP|status)\b[^\n]{0,24}\b(401|403|429|5\d\d)\b|\b(401|403|429|5\d\d) (Unauthorized|Forbidden|Too Many|Internal|Bad Gateway|Service)|"code\\?"\s*:\s*(401|403|429|5\d\d)` +
  String.raw`|rate.?limit|unauthori[sz]ed|not connected|MCP error -32|Service Unavailable|Bad Gateway|certificate|Request timeout`, 'i');
const R_MISUSE = new RegExp(String.raw`<tool_use_error>|String to replace not found|File has not been read|InputValidationError|Invalid (input|parameters?|arguments?)|No such tool` +
  String.raw`|Error: [0-9A-Z]{5}:|syntax error|parsing_exception|verification_exception|400 Bad Request|Unknown (column|field|index)|does not exist` +
  String.raw`|No such file or directory|command not found|SyntaxError|NameError|is not defined|Found \d+ matches of the string|unexpected (token|EOF)` +
  String.raw`|unknown (option|flag|command)|invalid (option|argument|syntax)|Unrecognized|unknown revision|\(eval\):\d+: \S+ not found`, 'i');
const R_EXIT = /^\s*Exit code \d+/;
const R_VERIFY = new RegExp(String.raw`\b(vitest|jest|pytest|phpunit|rspec|npm (run )?test|npm t\b|yarn test|pnpm test|go test|dotnet (test|build)|cargo (test|build)|mvn \S*\s*(test|verify|package)` +
  String.raw`|gradlew? \S*\s*test|tsc\b|typecheck|npm run build|yarn build|pnpm build|go build|make test)`, 'i');
const R_VFAIL = /\b[1-9]\d* (failed|failing)\b|Tests?:?\s+[1-9]\d* failed|error TS\d+|\berror CS\d+|Build FAILED|npm ERR!|ELIFECYCLE|AssertionError|Traceback \(most recent|\bERROR in\b|compilation failed/i, R_VFAIL_CS = /\bFAIL\b/;
/** phrases aimed at the assistant's last answer, on folded text (no diacritics, lowercase); narrow on purpose. Intentionally matches Vietnamese user prompts: do not translate. */
const R_CORR = new RegExp(String.raw`^\s*(stop|dung lai|khoan|tu tu da)\b|\b(sai roi|sai het|lam sai|may sai|khong dung roi|chua dung|van loi|van sai|van chua (duoc|chay|dung|fix|sua)|van khong (duoc|chay)` +
  String.raw`|van bi loi|lam lai di|lam lai tu dau|lam lai cho|tu revert|sao tu nhien|tu y (sua|xoa|lam|commit|push)|ai bao (may|sua|xoa)|hieu sai|hieu nham|nham roi` +
  String.raw`|khong phai (the|vay|nhu the)|ko phai (the|vay)|that.?s (wrong|not (it|what))|still (broken|failing|fails|not working|doesn)|does ?n.?t work|not working|did ?n.?t work|you broke)\b`);
// Secret masks for error lines and titles, applied after redact.ts: cookie headers (to the end of the line), URL userinfo, query values, `key=value` / `key: value`
// whose key looks secret (an optional `Bearer `/`Basic ` in the value is consumed too), `Bearer x` / `token x` words, mysql/sshpass `-p<password>`, JWTs, long opaque
// tokens, emails. Over-masking only merges patterns; under-masking leaks, so keep these broad.
const R_COOKIE = /(?<![A-Za-z0-9])((?:set-)?cookie["']?\s*[=:]\s*)[^\n]*/gi, R_USERINFO = /\b([a-z][\w+.-]*:\/\/)[^\s/@]+@/gi, R_QUERY = /([?&][^=\s&#]+=)[^&\s#]+/g;
const R_KV = /(?<![A-Za-z0-9])([\w-]*(?:token|secret|passw(?:or)?d|pwd|api[-_]?key|key|cookie|session|auth|credential)[\w-]*["']?\s*[=:]\s*)(?:(?:bearer|basic)\s+)?(?:"[^"\n]*"|'[^'\n]*'|\S+)/gi;
const R_WORD = /(?<![A-Za-z0-9])(bearer|token|password|passwd|pwd|apikey|api_key|secret|authorization)(\s+)(?!…)\S+/gi;
const R_PFLAG = /\b((?:mysql\w*|mariadb\w*)\b[^\n]*?\s-p)(?!\s)\S+|\b(sshpass\s+-p\s*)\S+/gi;
const R_OPAQUE = /eyJ[\w-]+\.[\w-]+\.[\w-]*|(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{28,}(?![A-Za-z0-9_-])/g;
const R_PATH = /(?:[A-Za-z]:)?(?:[/\\][\p{L}\p{N}_.@-]+){2,}[/\\]?/gu, R_EMAIL = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g;
const EDIT = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']), SHELLS = new Set(['Bash', 'PowerShell']);
const INTR = '[Request interrupted by user';

/** Cause of a failed tool result (same regex order as the .py): user_rejected, infra/auto_denied/misuse overrides, infra, misuse, cmd_fail (`Exit code N`), other. */
export function classifyError(txt: string): ModelErrorCategory {
  const t = txt.length <= 1600 ? txt : `${txt.slice(0, 800)}\n${txt.slice(-800)}`;
  if (R_REJ.test(t)) return 'user_rejected';
  if (R_INFRA_X.test(t)) return 'infra';
  if (R_DENY.test(t)) return 'auto_denied';
  if (R_MISUSE_X.test(t)) return 'misuse';
  if (R_INFRA.test(t)) return 'infra';
  if (R_MISUSE.test(t)) return 'misuse';
  if (R_EXIT.test(t)) return 'cmd_fail';
  return 'other';
}
const cut = (s: string, n: number) => { if (s.length <= n) return s; let i = n; while (i > n - 200 && !/\s/.test(s[i - 1])) i--; return s.slice(0, i > n - 200 ? i : n); };
/** masks secrets in one line of arbitrary text (error lines, command output, titles) */
const scrub = (s: string) => redactText(s, Infinity).replace(R_COOKIE, '$1…').replace(R_USERINFO, '$1<cred>@').replace(R_QUERY, '$1…').replace(R_KV, '$1…').replace(R_WORD, '$1$2…')
  .replace(R_PFLAG, (_, a, b) => `${a ?? b}…`).replace(R_OPAQUE, '…').replace(R_EMAIL, '<email>');
/** Normalized one-line error message: first meaningful line (+ the last error-looking line after `Exit code N`, same masking), secrets (scrub), paths, quoted values,
 *  IPs and long numbers replaced, whitespace collapsed, ≤110 chars + '…', then redacted again. */
export function errorPattern(txt: string): string {
  const ls: string[] = [];
  for (const l of txt.replace(/\r/g, '').split('\n')) { const s = l.trim(); if ((s && !s.startsWith('<')) || l.includes('tool_use_error')) ls.push(s); }
  if (!ls.length) return '(empty)';
  let h = cut(ls[0].replace(/<\/?tool_use_error>/g, '').trim(), 1000);
  if (R_EXIT.test(h)) for (let i = ls.length - 1; i >= 1; i--) if (/error|fatal|not found|failed|denied|exception|cannot|no such/i.test(ls[i])) { h = `${h} · ${cut(ls[i], 1000)}`; break; }
  const t = scrub(h).replace(R_PATH, '<path>').replace(/(["'`])[^"'`]{1,120}\1/g, '$1…$1').replace(/\b\d{1,3}(\.\d{1,3}){3}(:\d+)?\b/g, '<ip>').replace(/\b\d{4,}\b/g, 'N').replace(/\s+/g, ' ');
  return redactText(t.length > 110 ? `${t.slice(0, 110)}…` : t, Infinity);
}
/** Short label of an API model id: claude-opus-5-5 → Opus 5.5, claude-haiku-4-5-20251001 → Haiku 4.5; anything else as is. */
export function modelLabel(m: string) { const x = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(m); return x ? `${x[1][0].toUpperCase()}${x[1].slice(1)} ${x[2]}${x[3] ? `.${x[3]}` : ''}` : m || '?'; }
/** Correction-phrase fold (the .py's; intentionally handles Vietnamese input): đ → d, NFD, combining marks dropped, lowercase; first 600 chars. */
const foldCorr = (s: string) => s.slice(0, 2400).replace(/[đĐ]/g, 'd').normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase().slice(0, 600);
const interrupted = (j: any) => { const c = j.message?.content; return typeof c === 'string' ? c.trimStart().startsWith(INTR) : Array.isArray(c) && c.some((b) => b?.type === 'text' && typeof b.text === 'string' && b.text.trimStart().startsWith(INTR)); };
const resultText = (b: any): string => { const c = b.content; return typeof c === 'string' ? c : Array.isArray(c) ? c.filter((x) => x?.type === 'text').map((x) => (typeof x.text === 'string' ? x.text : '')).join('\n') : ''; };
const obj = (v: unknown): any => (v && typeof v === 'object' ? v : {});
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0), usd = (v: number) => Math.round(v * 1e6) / 1e6;
const json = (l: string): any => { try { return JSON.parse(l); } catch { return undefined; } };
const names = new Map<string, string>();
/** model ids, tool names, error kinds: redacted, ≤n chars (memoized) */
const san = (s: string, n = 100) => { const x = s.slice(0, 4 * n), k = `${n}\0${x}`; let v = names.get(k); if (v === undefined) { v = redactText(x, n); if (names.size > 20_000) names.clear(); names.set(k, v); } return v; };
const inc = (m: Map<string, number>, k: string, n = 1) => m.set(k, (m.get(k) ?? 0) + n);
/** most frequent key, first inserted on ties (Counter.most_common) */
const top = (m: Map<string, number>) => { let k: string | undefined, n = -Infinity; for (const [x, v] of m) if (v > n) { k = x; n = v; } return k; };

// Local calendar days as day numbers (UTC epoch days of the local date); cached per 15 min (every UTC offset is a multiple of 15 min).
const DAY = 86_400_000, days15 = new Map<number, number>();
const dayOf = (ts: number) => { const k = Math.floor(ts / 900_000); let d = days15.get(k); if (d === undefined) { const x = new Date(ts); d = Date.UTC(x.getFullYear(), x.getMonth(), x.getDate()) / DAY; if (days15.size > 400_000) days15.clear(); days15.set(k, d); } return d; };
const monday = (d: number) => d - (((d + 3) % 7) + 7) % 7;
const isoDay = (d: number) => new Date(d * DAY).toISOString().slice(0, 10);
const midnight = (d: number) => { const x = new Date(d * DAY); return new Date(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()).getTime(); };
/** nearest-rank quantile with Python's round-half-even, as in the .py */
const quant = (xs: number[], p: number) => { if (!xs.length) return null; const x = p * (xs.length - 1), f = Math.floor(x), r = x - f > 0.5 || (x - f === 0.5 && f % 2) ? f + 1 : f; return xs[Math.min(xs.length - 1, Math.max(0, r))]; };

// Per day+model counters; K.cat..K.cat+5 follow CATS.
const K = { calls: 0, tools: 1, edits: 2, cat: 3, editFail: 9, verify: 10, vfail: 11, intr: 12, corr: 13, turns: 14, prompts: 15, compact: 16, maxTok: 17, refusal: 18, outTok: 19 }, NK = 20;
// Per day session counters (window counts of one main session).
const S = { tools: 0, intr: 1, corr: 2, turns: 3, prompts: 4, compact: 5, cat: 6 }, NS = 12;
interface Pat { n: number; last: number; models: Map<string, number>; tools: Map<string, number> }
/** one local day of one transcript: model counters, turn ms, effort, tools [calls, errors, …per category], patterns (key = category index + pattern),
 *  API errors [count, lastAt], retries [retries, incidents], session counters, verify results in order */
interface Day { m: Map<string, number[]>; dur: Map<string, number[]>; eff: Map<string, Map<string, number>>; tools: Map<string, number[]>; pat: Map<string, Pat>; api: Map<string, number[]>; retry: Map<string, number[]>; s: number[]; v: boolean[] }
/** Aggregates of one transcript file (never its text). */
interface Agg { sub: boolean; auto: boolean; days: Map<number, Day>; calls: Map<string, number>; main?: string; last?: number; lastDay?: number; sid: string; title: string; project: string; projectName: string; cost: number; costModels: Map<string, number>; lines: number; prs: number }
interface Turn { start: number; last: number; models: Map<string, number>; counted: boolean }
const newDay = (): Day => ({ m: new Map(), dur: new Map(), eff: new Map(), tools: new Map(), pat: new Map(), api: new Map(), retry: new Map(), s: new Array(NS).fill(0), v: [] });

const KEEP_T = /^\{"type":"(?:user|assistant|system|cost-state|ai-title|custom-title|pr-link)"/;
const ATTACH = /^\{"parentUuid":(?:null|"[^"]*"),(?:"logicalParentUuid":(?:null|"[^"]*"),)?"isSidechain":(?:true|false),"attachment":/;
const TYPES = new Set(['user', 'assistant', 'system', 'cost-state', 'ai-title', 'custom-title', 'pr-link']);
const ENTRY = Buffer.from('"entrypoint":"'), HEAD = 512, LINE = 8 * 1024 * 1024;
/** Streams a JSONL file: fn gets every line whose head may be a kept type (api-request*, attachments… are never decoded; >8 MB lines skipped).
 *  Returns the first `"entrypoint"` value found in the first 60 lines, kept or not (the .py's automation check). */
async function eachLine(file: string, fn: (line: string) => void): Promise<string | undefined> {
  const rs = createReadStream(file, { highWaterMark: 1 << 20 });
  let parts: Buffer[] = [], len = 0, mode = 0, n = 0, entry: string | undefined; // mode: 0 undecided, 1 keep, 2 skip, 3 peek only
  const whole = () => (parts.length === 1 ? parts[0] : Buffer.concat(parts, len));
  const peek = (b: Buffer) => { for (let i = b.indexOf(ENTRY); i >= 0 && entry === undefined; i = b.indexOf(ENTRY, i + 1)) { const s = i + ENTRY.length, e = b.indexOf(34, s); if (e > s) entry = b.toString('utf8', s, e); } };
  const decide = () => { const h = whole(); parts = [h]; const k = h.toString('latin1', 0, Math.min(h.length, HEAD)); mode = (k.startsWith('{"type":"') ? KEEP_T.test(k) : !ATTACH.test(k)) ? 1 : n < 60 && entry === undefined ? 3 : 2; if (mode === 2) { parts = []; len = 0; } };
  const done = () => { if (mode === 1 || mode === 3) { const b = whole(); if (n < 60 && entry === undefined) peek(b); if (mode === 1) fn(b.toString('utf8')); } parts = []; len = 0; mode = 0; n++; };
  try {
    for await (const c of rs as AsyncIterable<Buffer>) {
      for (let i = 0; i < c.length;) {
        const nl = c.indexOf(10, i), end = nl < 0 ? c.length : nl;
        if (mode !== 2 && end > i) { parts.push(c.subarray(i, end)); len += end - i; }
        if (!mode && len && (len >= HEAD || nl >= 0)) decide();
        if ((mode === 1 || mode === 3) && len > LINE) { parts = []; len = 0; mode = 2; } // >8 MB: dropped unparsed (its calls/results are lost; a >8 MB prompt starts no turn)
        if (nl < 0) break;
        done(); i = nl + 1;
      }
    }
    if (len && !mode) decide();
    if (len) done();
  } finally { rs.destroy(); }
  return entry;
}

/** Parses one transcript into day-bucketed aggregates (the .py's per-file pass). sub = a subagent transcript: no prompts/turns/cost. */
async function parseFile(file: string, sub: boolean, sid: string, dir: string, home: string): Promise<Agg> {
  const a: Agg = { sub, auto: false, days: new Map(), calls: new Map(), sid, title: '', project: '', projectName: '', cost: 0, costModels: new Map(), lines: 0, prs: 0 };
  const tu = new Map<unknown, [string | undefined, string, boolean]>(), seen = new Set<unknown>(), outTok = new Map<unknown, [string | undefined, number | undefined, number]>(), stops = new Set<string>(), prs = new Set<string>();
  let turn: Turn | undefined, prev: string | undefined, lastModel: string | undefined, cwd: string | undefined, custom: string | undefined, ai: string | undefined, last: number | undefined;
  const day = (ts: number) => { const d = dayOf(ts); let x = a.days.get(d); if (!x) a.days.set(d, (x = newDay())); return x; };
  const add = (m: string | undefined, k: number, ts: number | undefined, n = 1) => { if (ts === undefined || !m) return; const D = day(ts); let c = D.m.get(m); if (!c) D.m.set(m, (c = new Array(NK).fill(0))); c[k] += n; };
  const sAdd = (k: number, ts: number | undefined) => { if (ts !== undefined) day(ts).s[k]++; };
  const close = () => {
    if (!turn?.models.size) return undefined;
    const t = turn, mm = top(t.models)!, D = day(t.start);
    add(mm, K.turns, t.start); let d = D.dur.get(mm); if (!d) D.dur.set(mm, (d = [])); d.push(Math.max(0, t.last - t.start)); sAdd(S.turns, t.start);
    if (t.counted) { add(mm, K.prompts, t.start); sAdd(S.prompts, t.start); }
    return mm;
  };
  const entry = await eachLine(file, (l) => {
    const j = json(l), ty = j?.type; if (!TYPES.has(ty)) return;
    const p = Date.parse(j.timestamp), ts = typeof j.timestamp === 'string' && p === p ? p : undefined;
    const prompt = !sub && ty === 'user' ? promptText(j) : undefined;
    // a turn lasts until the last line before the next prompt (the prompt that closes it does not extend it)
    if (ts !== undefined) { last = ts; if (turn && prompt === undefined) turn.last = ts; }
    if (cwd === undefined && typeof j.cwd === 'string' && j.cwd) cwd = j.cwd.slice(0, 4096);
    if (ty === 'assistant') {
      const m = obj(j.message), raw = m.model || j.requestedModel;
      if (j.isApiErrorMessage || raw === '<synthetic>') {
        if (ts === undefined) return;
        const e = j.error || j.apiError || j.apiErrorType || 'unknown', st = j.apiErrorStatus, s = typeof e === 'string' ? e : JSON.stringify(e) ?? 'unknown';
        const k = san(st ? `${s} (${String(st)})` : s, 80), x = day(ts).api.get(k);
        if (x) { x[0]++; if (ts > x[1]) x[1] = ts; } else day(ts).api.set(k, [1, ts]);
        return;
      }
      const model = typeof raw === 'string' && raw ? san(raw) : undefined, mid = m.id || j.requestId || j.uuid;
      if (!seen.has(mid)) {
        seen.add(mid); add(model, K.calls, ts);
        if (model) {
          inc(a.calls, model); lastModel = model; if (turn) inc(turn.models, model);
          if (j.effort && ts !== undefined) { const D = day(ts); let e = D.eff.get(model); if (!e) D.eff.set(model, (e = new Map())); inc(e, san(String(j.effort), 40)); }
        }
      }
      const ot = obj(m.usage).output_tokens;
      if (typeof ot === 'number' && ot > 0) outTok.set(mid, [model, ts, Math.max(ot, outTok.get(mid)?.[2] ?? 0)]);
      const sr = m.stop_reason;
      if ((sr === 'max_tokens' || sr === 'refusal') && !stops.has(`${sr}\0${String(mid)}`)) { stops.add(`${sr}\0${String(mid)}`); add(model, sr === 'refusal' ? K.refusal : K.maxTok, ts); }
      if (Array.isArray(m.content)) for (const b of m.content) {
        if (b?.type !== 'tool_use') continue;
        const tn = typeof b.name === 'string' && b.name ? san(b.name) : '?', cmd = obj(b.input).command;
        tu.set(b.id, [model, tn, SHELLS.has(tn) && typeof cmd === 'string' && R_VERIFY.test(cmd)]);
        add(model, K.tools, ts); if (EDIT.has(tn)) add(model, K.edits, ts);
        if (ts !== undefined) { const D = day(ts); let t = D.tools.get(tn); if (!t) D.tools.set(tn, (t = new Array(8).fill(0))); t[0]++; D.s[S.tools]++; }
      }
    } else if (ty === 'user') {
      if (interrupted(j)) { add(turn?.models.size ? top(turn.models) : lastModel, K.intr, ts); sAdd(S.intr, ts); }
      const c = j.message?.content;
      if (Array.isArray(c)) for (const b of c) {
        if (b?.type !== 'tool_result') continue;
        const [model, tn, ver] = tu.get(b.tool_use_id) ?? [lastModel, '?', false], err = !!b.is_error;
        let txt: string | undefined;
        if (ver) { // `npm test | tail` exits 0 even when tests fail: also read the output
          txt = resultText(b); const vf = err || R_VFAIL.test(txt.slice(-6000)) || R_VFAIL_CS.test(txt.slice(-6000));
          add(model, K.verify, ts); if (vf) add(model, K.vfail, ts); if (ts !== undefined) day(ts).v.push(!vf);
        }
        if (!err) continue;
        txt ??= resultText(b); const cat = classify(txt);
        if (EDIT.has(tn) && cat === 0) add(model, K.editFail, ts);
        add(model, K.cat + cat, ts);
        if (ts === undefined) continue;
        const D = day(ts); let t = D.tools.get(tn); if (!t) D.tools.set(tn, (t = new Array(8).fill(0))); t[1]++; t[2 + cat]++; D.s[S.cat + cat]++;
        const k = `${cat}${errorPattern(txt)}`; let x = D.pat.get(k); if (!x) D.pat.set(k, (x = { n: 0, last: 0, models: new Map(), tools: new Map() }));
        x.n++; if (ts > x.last) x.last = ts; if (model) inc(x.models, model); inc(x.tools, tn);
      }
      if (prompt !== undefined && ts !== undefined) {
        prev = close() ?? prev;
        const counted = !prompt.startsWith('/') && !prompt.startsWith('!');
        if (counted && prev && R_CORR.test(foldCorr(prompt))) { add(prev, K.corr, ts); sAdd(S.corr, ts); }
        turn = { start: ts, last: ts, models: new Map(), counted };
      }
    } else if (ty === 'system') {
      if (j.subtype === 'compact_boundary') { add(lastModel, K.compact, ts); sAdd(S.compact, ts); }
      else if (j.subtype === 'api_error' && ts !== undefined) {
        const e = j.error || {}, o = typeof e === 'object' && !Array.isArray(e), cn = obj(o && e.connection);
        const k = san(o ? String(cn.code || (e.status ? String(e.status) : '') || String(e.message || 'unknown').slice(0, 40)) : String(e).slice(0, 40), 80);
        const r = day(ts).retry, x = r.get(k) ?? [0, 0], at = j.retryAttempt; x[0]++; if (at === 1 || at === '1' || at == null) x[1]++; r.set(k, x);
      }
    } else if (ty === 'cost-state') {
      if (sub) return;
      a.cost = num(j.totalCostUSD); a.lines = num(j.totalLinesAdded) + num(j.totalLinesRemoved); a.costModels = new Map();
      for (const [k, v] of Object.entries(obj(j.modelUsage))) inc(a.costModels, san(k), num(obj(v).costUSD));
    } else if (ty === 'ai-title') { if (typeof j.aiTitle === 'string' && j.aiTitle) ai = j.aiTitle.slice(0, 1000); }
    else if (ty === 'custom-title') { const t = j.customTitle || j.title; if (typeof t === 'string' && t) custom = t.slice(0, 1000); }
    else if (ty === 'pr-link') { if (typeof j.prUrl === 'string' && j.prUrl && prs.size < 1000) prs.add(j.prUrl.slice(0, 500)); }
  });
  close();
  for (const [m, ts, n] of outTok.values()) add(m, K.outTok, ts, n);
  a.auto = entry === 'sdk-cli'; a.main = top(a.calls); a.last = last; a.lastDay = last === undefined ? undefined : dayOf(last); a.prs = prs.size;
  if (!sub) {
    const raw = cwd ?? decodeProjectDir(dir);
    a.project = redactText(raw.slice(0, 1200), 300); a.projectName = redactText(projectLabel(raw, home).slice(0, 1200), 300);
    a.title = scrub(cut((custom || ai || '(untitled)').replace(/\s+/g, ' ').trim(), 400)).slice(0, 90);
  }
  return a;
}
const classify = (txt: string) => CATS.indexOf(classifyError(txt));

interface Cached { mtimeMs: number; size: number; a: Agg | null }
interface Acc { c: number[]; dur: number[]; eff: Map<string, number>; sessions: number; subruns: number; lines: number; prs: number; vsess: number; vgreen: number }
const tick = () => new Promise<void>((r) => setImmediate(r));
const counts = (c: number[], o = 0): ModelErrorCounts => Object.fromEntries(CATS.map((k, i) => [k, c[o + i]])) as ModelErrorCounts;
/** Model report over the transcripts under `root` (Performance tab, GET /model-report). Each file is parsed once into day-bucketed aggregates (counters, turn times,
 *  normalized error patterns, a per-session summary; never transcript text), so any window and the weekly trend come from memory. The first scan is awaited; later
 *  requests answer at once and refresh in the background when the data is ≥10 s old (refreshing:true), re-parsing only new or changed files (mtime/size); fresh
 *  waits for a scan that started after the request. One scan at a time; answers are memoized per scan. */
export class ModelReport {
  private files = new Map<string, Cached>(); private pending?: Promise<void>; private stopped = false; private gen = 0; private memo = new Map<string, Omit<ModelReportResponse, 'generatedAt' | 'refreshing'>>();
  /** epoch ms of the last completed refresh (0 before the first) */
  scannedAt = 0;
  /** last refresh: transcript files seen (main + subagent), files (re)parsed, wall time */
  stats = { files: 0, parsed: 0, ms: 0 };
  constructor(readonly root: string, private opts: { ttlMs?: number; home?: string; now?: () => number } = {}) {}
  /** Rescans now; concurrent callers share one scan. */
  refresh(): Promise<void> { return (this.pending ??= this.scan().finally(() => { this.pending = undefined; })); }
  /** Abandons a running scan at the next file (server shutdown). */
  stop() { this.stopped = true; }
  private ensure(): Promise<void> {
    if (!this.scannedAt) return this.refresh();
    if (!this.pending && Date.now() - this.scannedAt >= (this.opts.ttlMs ?? 10_000)) this.refresh().catch(() => {});
    return Promise.resolve();
  }
  private async scan() {
    const t = Date.now(), seen = new Set<string>(), home = this.opts.home ?? homedir(); let parsed = 0;
    const dirs: Dirent[] = await readdir(this.root, { withFileTypes: true }).catch(() => []);
    for (const d of dirs) {
      if (this.stopped) return;
      if (!d.isDirectory()) continue;
      const dir = join(this.root, d.name), ents: Dirent[] = await readdir(dir, { withFileTypes: true }).catch(() => []), list: Array<[string, boolean, string]> = []; // file, sub, sid
      for (const e of ents) {
        if (e.isFile() && e.name.endsWith('.jsonl') && HISTORY_SID.test(e.name.slice(0, -6))) list.push([join(dir, e.name), false, e.name.slice(0, -6)]);
        else if (e.isDirectory() && HISTORY_SID.test(e.name)) for (const f of await readdir(join(dir, e.name, 'subagents')).catch(() => [] as string[])) if (f.endsWith('.jsonl')) list.push([join(dir, e.name, 'subagents', f), true, e.name]);
      }
      const sts = await Promise.all(list.map(([f]) => stat(f).catch(() => null)));
      for (let i = 0; i < list.length; i++) {
        const st = sts[i], [file, sub, sid] = list[i]; if (!st?.isFile()) continue;
        if (this.stopped) return;
        seen.add(file);
        const c = this.files.get(file); if (c && c.mtimeMs === st.mtimeMs && c.size === st.size) continue;
        this.files.set(file, { mtimeMs: st.mtimeMs, size: st.size, a: await parseFile(file, sub, sid, d.name, home).catch(() => null) }); parsed++; await tick();
      }
    }
    for (const k of [...this.files.keys()]) if (!seen.has(k)) this.files.delete(k);
    this.scannedAt = Date.now(); this.stats = { files: seen.size, parsed, ms: this.scannedAt - t }; this.gen++; this.memo.clear();
  }
  /** GET /model-report: window = the last `days` local calendar days including today (0 = all history); auto = also count sdk-cli sessions; fresh = rescan first. */
  async report(q: { days?: number; auto?: boolean; fresh?: boolean } = {}): Promise<ModelReportResponse> {
    if (q.fresh) { const p = this.pending; if (p) await p.catch(() => {}); await this.refresh(); } // a scan already running may predate the change the user wants to see
    else await this.ensure();
    const now = this.opts.now?.() ?? Date.now(), today = dayOf(now), days = Math.max(0, Math.min(3650, Math.trunc(Number(q.days ?? 30)) || 0)), auto = q.auto === true;
    const key = `${days}|${auto}|${today}|${this.gen}`, hit = this.memo.get(key) ?? this.build(days, auto, today);
    if (!this.memo.has(key)) { this.memo.set(key, hit); if (this.memo.size > 8) this.memo.delete(this.memo.keys().next().value!); }
    return { ...hit, generatedAt: now, refreshing: this.pending !== undefined };
  }
  private build(days: number, auto: boolean, today: number): Omit<ModelReportResponse, 'generatedAt' | 'refreshing'> {
    const start = days ? today - days + 1 : -Infinity, nw = days ? Math.min(52, Math.max(12, Math.ceil(days / 7))) : 52, w0 = monday(today) - (nw - 1) * 7;
    const w52 = monday(today) - 51 * 7, M = new Map<string, Acc>(), all = new Map<string, number>(), recent = new Map<string, number>(), W = new Map<number, Map<string, number[]>>(), cost = new Map<string, number>();
    const tools = new Map<string, number[]>(), pats = new Map<string, Pat>(), api = new Map<string, number[]>(), retry = new Map<string, number[]>(), review: ModelReviewSession[] = [];
    const acc = (m: string) => { let x = M.get(m); if (!x) M.set(m, (x = { c: new Array(NK).fill(0), dur: [], eff: new Map(), sessions: 0, subruns: 0, lines: 0, prs: 0, vsess: 0, vgreen: 0 })); return x; };
    let autoSkipped = 0, sessions = 0, first = Infinity;
    for (const { a } of this.files.values()) {
      if (!a) continue;
      for (const [m, n] of a.calls) inc(all, m, n);
      for (const [d, D] of a.days) if (d >= w52) for (const [m, c] of D.m) if (c[K.calls]) inc(recent, m, c[K.calls]);
      const inWin = a.lastDay !== undefined && a.lastDay >= start;
      if (a.auto && !auto) { if (!a.sub && inWin) autoSkipped++; continue; }
      const sc = new Array(NS).fill(0); let lastV: boolean | undefined, lastVDay = -Infinity;
      for (const [d, D] of a.days) {
        if (d >= w0) {
          const wk = monday(d); let w = W.get(wk); if (!w) W.set(wk, (w = new Map()));
          for (const [m, c] of D.m) { let p = w.get(m); if (!p) w.set(m, (p = [0, 0, 0, 0, 0])); p[0] += c[K.tools]; p[1] += c[K.cat]; p[2] += c[K.turns]; p[3] += c[K.intr]; p[4] += c[K.corr]; }
        }
        if (d < start) continue;
        if (d < first) first = d;
        for (const [m, c] of D.m) { const x = acc(m).c; for (let i = 0; i < NK; i++) x[i] += c[i]; }
        for (const [m, xs] of D.dur) { const x = acc(m).dur; for (const v of xs) x.push(v); }
        for (const [m, e] of D.eff) { const x = acc(m).eff; for (const [k, n] of e) inc(x, k, n); }
        for (const [k, c] of D.tools) { let x = tools.get(k); if (!x) tools.set(k, (x = new Array(8).fill(0))); for (let i = 0; i < 8; i++) x[i] += c[i]; }
        for (const [k, p] of D.pat) {
          let x = pats.get(k); if (!x) pats.set(k, (x = { n: 0, last: 0, models: new Map(), tools: new Map() }));
          x.n += p.n; if (p.last > x.last) x.last = p.last; for (const [m, n] of p.models) inc(x.models, m, n); for (const [m, n] of p.tools) inc(x.tools, m, n);
        }
        for (const [k, [n, at]] of D.api) { const x = api.get(k); if (x) { x[0] += n; if (at > x[1]) x[1] = at; } else api.set(k, [n, at]); }
        for (const [k, [n, i]] of D.retry) { const x = retry.get(k); if (x) { x[0] += n; x[1] += i; } else retry.set(k, [n, i]); }
        for (let i = 0; i < NS; i++) sc[i] += D.s[i];
        if (D.v.length && d > lastVDay) { lastVDay = d; lastV = D.v[D.v.length - 1]; }
      }
      if (!a.main || !inWin) continue;
      const x = acc(a.main);
      if (a.sub) { x.subruns++; continue; }
      sessions++; x.sessions++; x.lines += a.lines; x.prs += a.prs;
      for (const [m, v] of a.costModels) inc(cost, m, v);
      if (lastV !== undefined) { x.vsess++; if (lastV) x.vgreen++; }
      const misuse = sc[S.cat], rejected = sc[S.cat + 4], score = misuse + 2 * sc[S.intr] + 2 * sc[S.corr] + rejected;
      if (score > 0) review.push({ sid: a.sid, title: a.title, project: a.project, projectName: a.projectName, model: a.main, lastAt: a.last!, turns: sc[S.turns], toolCalls: sc[S.tools], misuse, interrupts: sc[S.intr], corrections: sc[S.corr], rejected, costUsd: usd(a.cost), score });
    }
    const byCalls = (x: [string, number], y: [string, number]) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1); // modelOrder: last 52 weeks first, then older models
    const order = [...[...recent].sort(byCalls), ...[...all].filter(([m]) => !recent.has(m)).sort(byCalls)].map(([m]) => m), rank = new Map(order.map((m, i) => [m, i]));
    const models: ModelStats[] = [...M].filter(([, x]) => x.c[K.calls] > 0).sort((x, y) => y[1].c[K.calls] - x[1].c[K.calls] || (rank.get(x[0]) ?? 1e9) - (rank.get(y[0]) ?? 1e9)).map(([m, x]) => {
      const c = x.c, d = x.dur.sort((p, q) => p - q);
      return { model: m, label: modelLabel(m), sessions: x.sessions, subagentRuns: x.subruns, turns: c[K.turns], prompts: c[K.prompts], apiCalls: c[K.calls], toolCalls: c[K.tools], edits: c[K.edits],
        errors: counts(c, K.cat), editFails: c[K.editFail], interrupts: c[K.intr], corrections: c[K.corr], verifyRuns: c[K.verify], verifyFails: c[K.vfail], verifySessions: x.vsess, verifyGreen: x.vgreen,
        turnMedianMs: quant(d, 0.5), turnP90Ms: quant(d, 0.9), outputTokens: c[K.outTok], costUsd: usd(cost.get(m) ?? 0), compactions: c[K.compact], maxTokensStops: c[K.maxTok], refusals: c[K.refusal],
        linesChanged: x.lines, prs: x.prs, effort: Object.fromEntries([...x.eff].sort((p, q) => q[1] - p[1])), smallSample: c[K.tools] < 200 || c[K.turns] < 20 };
    });
    const tc = new Array(NK).fill(0); for (const s of models) { const c = M.get(s.model)!.c; for (let i = 0; i < NK; i++) tc[i] += c[i]; }
    const trend: ModelTrendWeek[] = [];
    for (let i = 0; i < nw; i++) {
      const wk = w0 + 7 * i, ps = [...(W.get(wk) ?? [])].filter(([, p]) => p.some((v) => v));
      trend.push({ week: isoDay(wk), models: Object.fromEntries(ps.map(([m, p]) => [m, { toolCalls: p[0], misuse: p[1], turns: p[2], interrupts: p[3], corrections: p[4] }])) });
    }
    const patterns: ModelErrorPattern[] = [];
    for (let ci = 0; ci < CATS.length; ci++) {
      const xs = [...pats].filter(([k]) => k[0] === String(ci)).sort((p, q) => q[1].n - p[1].n || q[1].last - p[1].last).slice(0, 10);
      for (const [k, p] of xs) patterns.push({ category: CATS[ci], pattern: k.slice(1), count: p.n, tool: top(p.tools) ?? '?', byModel: Object.fromEntries(p.models), lastAt: p.last });
    }
    const toolStats: ModelToolStat[] = [...tools].filter(([, c]) => c[1] > 0).sort((p, q) => q[1][1] - p[1][1] || q[1][0] - p[1][0]).slice(0, 20)
      .map(([tool, c]) => ({ tool, calls: c[0], errors: c[1], byCategory: Object.fromEntries(CATS.map((k, i) => [k, c[2 + i]]).filter(([, n]) => n)) }));
    const apiErrors: ModelApiErrorStat[] = [...api].sort((p, q) => q[1][0] - p[1][0] || q[1][1] - p[1][1]).slice(0, 20).map(([kind, [count, lastAt]]) => ({ kind, count, lastAt }));
    const retries: ModelRetryStat[] = [...retry].sort((p, q) => q[1][0] - p[1][0] || q[1][1] - p[1][1]).slice(0, 20).map(([kind, [n, i]]) => ({ kind, incidents: i, retries: n }));
    const bySid = new Map<string, ModelReviewSession>(); for (const r of review) { const o = bySid.get(r.sid); if (!o || o.score < r.score) bySid.set(r.sid, r); }
    return {
      days, since: days ? midnight(start) : midnight(first === Infinity ? today : first), scannedAt: this.scannedAt, auto, autoSkipped, sessions,
      totals: { turns: tc[K.turns], toolCalls: tc[K.tools], errors: counts(tc, K.cat), interrupts: tc[K.intr], corrections: tc[K.corr], costUsd: usd([...cost.values()].reduce((s, v) => s + v, 0)),
        apiErrors: [...api.values()].reduce((s, x) => s + x[0], 0), retryIncidents: [...retry.values()].reduce((s, x) => s + x[1], 0) },
      models, modelOrder: order, trend, patterns, tools: toolStats, apiErrors, retries,
      review: [...bySid.values()].sort((p, q) => q.score - p.score || q.lastAt - p.lastAt).slice(0, 20),
    };
  }
}
