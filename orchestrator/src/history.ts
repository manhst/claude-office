import { createReadStream, type Dirent } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { redactText } from './redact.js';
import type { BookmarkStore } from './bookmarks.js';
import type { HistoryBookmarkResponse, HistoryDetailResponse, HistoryHit, HistoryItem, HistoryListResponse, HistoryProject, HistorySession } from './types.js';

/** `<CLAUDE_CONFIG_DIR or ~/.claude>/projects`: one folder per working dir, one `<sid>.jsonl` per session. */
export const historyRoot = (env: NodeJS.ProcessEnv = process.env) => join(env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects');
/** Session ids the API accepts; also the only transcript file names indexed. */
export const HISTORY_SID = /^[\w-]{1,64}$/;
export interface HistoryQuery { q?: string; project?: string; auto?: boolean; bookmarked?: boolean; limit?: number; offset?: number }
/** Caps in chars unless noted: haystack block / per session / all sessions (text + folded copy), detail item / item count / response text, title, first prompt,
 *  tool detail, metadata fields, search terms, refresh TTL, pre-filter head bytes, longest parsed line (bytes), min gap between miss-triggered rescans (ms). */
export const HISTORY_CAP = { block: 4096, hay: 64 * 1024, budget: 96 * 1024 * 1024, item: 32 * 1024, items: 3000, detail: 4 * 1024 * 1024, title: 120, first: 300, tool: 200, meta: 300,
  terms: 8, term: 100, hits: 999, ttlMs: 10_000, head: 512, line: 8 * 1024 * 1024, missMs: 5000 };
const C = HISTORY_CAP;
const FOLD = new Uint16Array(65536);
/** Search fold, one output unit per UTF-16 unit so indexes map 1:1: `(c.normalize('NFD')[0] ?? c).toLowerCase()[0]`, then 'đ' → 'd'. web/ duplicates it for highlighting; keep identical. */
export function fold(s: string): string {
  if (!/[^\x00-\x7f]/.test(s)) return s.toLowerCase();
  const out = new Uint16Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const n = s.charCodeAt(i); let x = FOLD[n];
    if (!x) { const c = s[i], f = (c.normalize('NFD')[0] ?? c).toLowerCase()[0]; x = FOLD[n] = (f === 'đ' ? 'd' : f).charCodeAt(0); }
    out[i] = x;
  }
  return Buffer.from(out.buffer, out.byteOffset, out.byteLength).toString('utf16le');
}
/** Search terms: whitespace-separated, a "quoted phrase" is one term; at most 8 distinct terms of ≤100 chars, folded. */
export function searchTerms(q: string): string[] {
  const out: string[] = [];
  for (const m of q.slice(0, 2000).matchAll(/"([^"]*)"|(\S+)/g)) {
    const t = fold((m[1] ?? m[2].replace(/^"+|"+$/g, '')).replace(/\s+/g, ' ').trim()).slice(0, C.term);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= C.terms) break;
  }
  return out;
}
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/** First ≈n chars; a cut also drops the token it splits (looking back ≤2 KB), so redaction never sees half a secret. */
const head = (s: string, n: number) => { if (s.length <= n) return s; const lo = n - Math.min(2048, n >> 2); let i = n; while (i > lo && !/\s/.test(s[i - 1])) i--; return s.slice(0, i); };
/** Fresh flat copy, so a short slice kept in the index does not pin its (large) parent string. */
const copy = (s: string) => Buffer.from(s, 'utf16le').toString('utf16le');
/** bounded head → redact → cut to n */
const red = (s: string, n: number) => copy(clip(redactText(head(s, 4 * n + 2048), Infinity), n));
/** metadata that leaves the server (project, branch, model, version, entrypoint, tool name): redacted, ~300 chars */
const meta = (s: string) => copy(redactText(head(s, 2048), C.meta));
const one = (s: string) => s.replace(/\s+/g, ' ').trim();
const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop();
const line1 = (s: string) => s.split(/\r?\n/).find((l) => l.trim())?.trim();
const ln = (s: string, n: number) => { const l = line1(head(s, 4096)); return l ? red(l, n) : undefined; };
/** One-line tool call summary, the mod's toolDetail shapes only (Grep/Glob pattern first): file basename, first command line, URL host, pattern/query/description,
 *  TodoWrite → 'todos'; anything else → undefined. Redacted, ≤200 chars, never raw inputs. */
export function toolSummary(name: string, a: any): string | undefined {
  if (!a || typeof a !== 'object') return undefined;
  const file = a.file_path ?? a.path ?? a.notebook_path;
  let s: string | undefined;
  if ((name === 'Grep' || name === 'Glob') && typeof a.pattern === 'string') s = ln(a.pattern, 60);
  else if (typeof file === 'string') s = base(file);
  else if (typeof a.command === 'string') s = ln(a.command, 80);
  else if (typeof a.url === 'string') { try { s = new URL(a.url).host; } catch { s = undefined; } }
  else if (typeof a.pattern === 'string') s = ln(a.pattern, 60);
  else if (typeof a.query === 'string') s = ln(a.query, 60);
  else if (typeof a.description === 'string') s = ln(a.description, 80);
  else if (name === 'TodoWrite') s = 'todos';
  return s ? red(s, C.tool) : undefined;
}
/** Lossy inverse of Claude Code's folder naming (every non-alphanumeric → '-'): 'C--Users-me-x' → 'C:\Users\me\x', '-Users-me-x' → '/Users/me/x'. */
export function decodeProjectDir(d: string) { const w = /^([A-Za-z])--(.*)$/.exec(d); return w ? `${w[1]}:\\${w[2].replace(/-/g, '\\')}` : d.replace(/-/g, '/'); }
const trimSep = (p: string) => p.replace(/(?<=.)[\\/]+$/, '');
/** Basename of a project path, '~' for the home dir (case-insensitive for Windows paths). */
export function projectLabel(p: string, home = homedir()) {
  const a = trimSep(p), b = trimSep(home);
  return (/^[A-Za-z]:/.test(a) ? a.toLowerCase() === b.toLowerCase() : a === b) ? '~' : (base(a) ?? a);
}
/** A real user prompt's text (≤64K chars), or undefined for tool results, meta/hook lines, compact summaries, task notifications, local command and `!` bash output,
 *  and interrupts. Drops <system-reminder>, IDE context and prompt-hook blocks; a slash command becomes "/name args", a `!` command "! <first line>". */
export function promptText(j: any): string | undefined {
  if (j?.type !== 'user' || j.isMeta || j.isCompactSummary || j.toolUseResult !== undefined || j.origin?.kind === 'task-notification') return undefined;
  const c = j.message?.content, L = 2 * C.item;
  // drop context blocks BEFORE cutting to L: a cut-off <ide_selection> loses its closing tag and would swallow the prompt after it
  const strip = (x: string) => x.replace(/<(system-reminder|ide_opened_file|ide_selection|user-prompt-submit-hook)>[\s\S]*?(?:<\/\1>|$)/g, '');
  let t: string;
  if (typeof c === 'string') t = head(strip(c), L);
  else if (Array.isArray(c) && !c.some((b) => b?.type === 'tool_result')) t = head(c.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => head(strip(b.text), L)).join('\n'), L);
  else return undefined;
  if (/^\s*(<(task-notification|local-command-stdout|local-command-stderr|bash-stdout|bash-stderr)>|\[Request interrupted by user)/.test(t)) return undefined;
  const bash = /^\s*<bash-input>([\s\S]*?)(?:<\/bash-input>|$)/.exec(t);
  if (bash) { const l = line1(bash[1]); return l ? `! ${l}` : undefined; }
  const cmd = /<command-name>([\s\S]*?)<\/command-name>/.exec(t);
  if (cmd) { const n = cmd[1].trim(), args = /<command-args>([\s\S]*?)<\/command-args>/.exec(t)?.[1].trim(); t = `${n.startsWith('/') ? n : `/${n}`}${args ? ` ${args}` : ''}`; }
  t = t.replace(/\r\n?/g, '\n').trim();
  return t || undefined;
}
const KEEP_T = /^\{"type":"(?:user|assistant|custom-title|ai-title|cost-state)"/;
const SKIP_P = /^\{"parentUuid":(?:null|"[^"]*"),(?:"logicalParentUuid":(?:null|"[^"]*"),)?"isSidechain":(?:true|false),(?:"attachment":|(?:"promptId":"[^"]*",)?"type":"(?:system"|user","message":\{"role":"user","content":\[\{"tool_use_id":))/;
/** Cheap pre-filter on a line's first bytes (latin1): drops api-request*, file-history*, queue-operation…, attachment, system and tool-result lines before decoding. Unknown shapes are kept. */
export const keepLine = (head: string) => (head.startsWith('{"type":"') ? KEEP_T.test(head) : !SKIP_P.test(head));
/** Streams a JSONL file and calls fn with each line keepLine lets through; skipped and over-long (>8 MB) lines are never decoded. fn returns false to stop. */
async function eachLine(file: string, fn: (line: string) => boolean | void) {
  const rs = createReadStream(file, { highWaterMark: 1 << 20 });
  let parts: Buffer[] = [], len = 0, mode = 0; // 0 undecided, 1 keep, 2 skip
  const whole = () => (parts.length === 1 ? parts[0] : Buffer.concat(parts, len));
  const decide = () => { const h = whole(); parts = [h]; mode = keepLine(h.toString('latin1', 0, Math.min(h.length, C.head))) ? 1 : 2; if (mode === 2) { parts = []; len = 0; } };
  try {
    for await (const c of rs as AsyncIterable<Buffer>) {
      for (let i = 0; i < c.length;) {
        const nl = c.indexOf(10, i), end = nl < 0 ? c.length : nl;
        if (mode !== 2 && end > i) { parts.push(c.subarray(i, end)); len += end - i; }
        if (!mode && len && (len >= C.head || nl >= 0)) decide();
        if (mode === 1 && len > C.line) { parts = []; len = 0; mode = 2; }
        if (nl < 0) break;
        if (mode === 1 && fn(whole().toString('utf8')) === false) return;
        parts = []; len = 0; mode = 0; i = nl + 1;
      }
    }
    if (len && !mode) decide();
    if (len && mode === 1) fn(whole().toString('utf8')); // last line without '\n' (may be a partial write; JSON.parse then fails)
  } finally { rs.destroy(); }
}
const tsOf = (j: any) => (typeof j?.timestamp === 'string' ? Date.parse(j.timestamp) : NaN);
const json = (l: string): any => { try { return JSON.parse(l); } catch { return undefined; } };
interface Entry { file: string; s: HistorySession; hay: string; fh: string; at: number }
interface Cached { mtimeMs: number; size: number; e: Entry | null }
/** Summary + search haystack of one transcript (redacted, whitespace-collapsed blocks; metadata first, text from `at`). null when it has no user/assistant line. */
async function indexFile(file: string, sid: string, dir: string, st: { size: number; mtimeMs: number }, home: string): Promise<Entry | null> {
  let n = 0, prompts = 0, messages = 0, t0 = Infinity, t1 = -Infinity, size = 0, sdk = false, other = false;
  let cwd: string | undefined, branch: string | undefined, entry: string | undefined, version: string | undefined, model: string | undefined, cost: number | undefined, custom: string | undefined, ai: string | undefined, first: string | undefined;
  const blocks: string[] = [];
  const push = (t: string) => { if (size >= C.hay) return; const b = clip(one(redactText(head(t, 2 * C.block), Infinity)), Math.min(C.block, C.hay - size)); if (b) { blocks.push(b); size += b.length + 1; } };
  await eachLine(file, (l) => {
    const j = json(l), ty = j?.type;
    if (ty === 'custom-title') { if (typeof j.customTitle === 'string' && j.customTitle.trim()) custom = j.customTitle; return; }
    if (ty === 'ai-title') { if (typeof j.aiTitle === 'string' && j.aiTitle.trim()) ai = j.aiTitle; return; }
    if (ty === 'cost-state') { if (typeof j.totalCostUSD === 'number' && Number.isFinite(j.totalCostUSD)) cost = j.totalCostUSD; return; }
    if ((ty !== 'user' && ty !== 'assistant') || j.isSidechain === true) return;
    n++;
    const ts = tsOf(j); if (ts === ts) { if (ts < t0) t0 = ts; if (ts > t1) t1 = ts; }
    if (!cwd && typeof j.cwd === 'string' && j.cwd) cwd = j.cwd;
    if (typeof j.gitBranch === 'string' && j.gitBranch) branch = j.gitBranch;
    if (typeof j.entrypoint === 'string' && j.entrypoint) { entry ??= j.entrypoint; if (j.entrypoint.startsWith('sdk-')) sdk = true; else other = true; }
    if (typeof j.version === 'string' && j.version) version = j.version;
    if (ty === 'user') { const p = promptText(j); if (p) { prompts++; messages++; first ??= p; push(p); } return; }
    if (typeof j.message?.model === 'string' && j.message.model && !j.message.model.startsWith('<')) model = j.message.model;
    const c = j.message?.content;
    for (const b of typeof c === 'string' ? [{ type: 'text', text: c }] : Array.isArray(c) ? c : []) if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim()) { messages++; push(b.text); }
  });
  if (!n) return null;
  const raw = cwd ?? decodeProjectDir(dir), project = meta(raw), named = custom ?? ai, gitBranch = branch && meta(branch);
  const title = red(one(named ?? (first && line1(first)) ?? '(no prompt)'), C.title);
  const s: HistorySession = { sid, project, projectName: meta(projectLabel(raw, home)), ...(gitBranch ? { gitBranch } : {}), title, ...(first ? { firstPrompt: red(one(first), C.first) } : {}),
    startedAt: t0 <= t1 ? t0 : st.mtimeMs, endedAt: t0 <= t1 ? t1 : st.mtimeMs, prompts, messages, ...(cost !== undefined ? { costUsd: cost } : {}), ...(model ? { model: meta(model) } : {}),
    ...(version ? { version: meta(version) } : {}), ...(entry ? { entrypoint: meta(entry) } : {}), auto: sdk && !other, subagents: 0, bytes: st.size };
  const m = [named ? title : '', project, gitBranch ?? '', sid].join('\n'), hay = `${m}\n${blocks.join('\n')}`;
  return { file, s, hay, fh: fold(hay), at: m.length + 1 };
}
const countAgents = (d: string) => readdir(d).then((xs) => xs.filter((x) => /^agent-.+\.jsonl$/.test(x)).length, () => 0);
const tick = () => new Promise<void>((r) => setImmediate(r));
function match(e: Entry, ts: string[]) {
  let hits = 0, at = -1, len = 0;
  for (const t of ts) {
    let i = e.fh.indexOf(t); if (i < 0) return null;
    for (; i >= 0 && hits < C.hits; i = e.fh.indexOf(t, i + t.length)) hits++;
    const j = e.fh.indexOf(t, e.at); if (j >= 0 && (at < 0 || j < at)) { at = j; len = t.length; }
  }
  return { hits, at, len };
}
/** ~80 chars before / ~120 after a text match, inside its block, '…' at cut ends, redacted. */
function snippet(e: Entry, at: number, len: number) {
  const bs = e.hay.lastIndexOf('\n', at) + 1, nl = e.hay.indexOf('\n', at), be = nl < 0 ? e.hay.length : nl;
  let a = Math.max(bs, at - 80), b = Math.min(be, at + len + 120);
  if (a > bs && /[\uDC00-\uDFFF]/.test(e.hay[a])) a++;
  if (b < be && /[\uD800-\uDBFF]/.test(e.hay[b - 1])) b--;
  return redactText(`${a > bs ? '…' : ''}${e.hay.slice(a, b).trim()}${b < be ? '…' : ''}`, 400);
}
const int = (v: unknown, d: number) => { const n = Math.trunc(Number(v ?? d)); return Number.isFinite(n) ? n : d; };
/** In-memory index of past Claude Code sessions under `root` (History tab). The first scan is awaited; afterwards requests get the current index and a
 *  refresh runs in the background when it is ≥10 s old, re-parsing only new or changed files (mtime/size). Keeps summaries + capped search text within a global
 *  budget (oldest sessions lose their text first, metadata stays searchable), never transcripts (detail re-reads the file). */
export class HistoryIndex {
  private files = new Map<string, Cached>(); private bySid = new Map<string, Entry>(); private sorted: Entry[] = [];
  private pending?: Promise<void>; private stopped = false; private missAt = -Infinity;
  /** epoch ms of the last completed refresh (0 before the first) */
  scannedAt = 0;
  /** last refresh: transcript files seen, files (re)parsed, wall time, search text chars held (text + folded copy) */
  stats = { files: 0, parsed: 0, ms: 0, chars: 0 };
  constructor(readonly root: string, private opts: { ttlMs?: number; home?: string; budget?: number; bookmarks?: BookmarkStore } = {}) {}
  private view(e: Entry): HistorySession { const b = this.opts.bookmarks?.get(e.s.sid); return b ? { ...e.s, bookmark: { ...b } } : { ...e.s }; }
  /** Rescans now; concurrent callers share one scan. */
  refresh(): Promise<void> { return (this.pending ??= this.scan().finally(() => { this.pending = undefined; })); }
  /** Abandons a running scan at the next file (server shutdown). */
  stop() { this.stopped = true; }
  /** Stale-while-revalidate: only the very first scan is awaited. */
  private ensure(): Promise<void> {
    if (!this.scannedAt) return this.refresh();
    if (!this.pending && Date.now() - this.scannedAt >= (this.opts.ttlMs ?? C.ttlMs)) this.refresh().catch(() => {});
    return Promise.resolve();
  }
  private async scan() {
    const t = Date.now(), seen = new Set<string>(), home = this.opts.home ?? homedir(); let parsed = 0;
    const dirs: Dirent[] = await readdir(this.root, { withFileTypes: true }).catch(() => []);
    for (const d of dirs) {
      if (this.stopped) return;
      if (!d.isDirectory()) continue;
      const dir = join(this.root, d.name), ents: Dirent[] = await readdir(dir, { withFileTypes: true }).catch(() => []);
      const subs = new Set(ents.filter((x) => x.isDirectory()).map((x) => x.name));
      const list = ents.filter((x) => x.isFile() && x.name.endsWith('.jsonl') && HISTORY_SID.test(x.name.slice(0, -6)));
      const sts = await Promise.all(list.map((x) => stat(join(dir, x.name)).catch(() => null)));
      for (let i = 0; i < list.length; i++) {
        const st = sts[i]; if (!st) continue;
        if (this.stopped) return;
        const sid = list[i].name.slice(0, -6), file = join(dir, list[i].name); seen.add(file);
        let c = this.files.get(file);
        if (!c || c.mtimeMs !== st.mtimeMs || c.size !== st.size) {
          c = { mtimeMs: st.mtimeMs, size: st.size, e: await indexFile(file, sid, d.name, st, home).catch(() => null) };
          this.files.set(file, c); parsed++; await tick();
        }
        if (c.e) c.e.s.subagents = subs.has(sid) ? await countAgents(join(dir, sid, 'subagents')) : 0;
      }
    }
    for (const k of [...this.files.keys()]) if (!seen.has(k)) this.files.delete(k);
    const by = new Map<string, Entry>();
    for (const { e } of this.files.values()) if (e) { const o = by.get(e.s.sid); if (!o || o.s.endedAt < e.s.endedAt) by.set(e.s.sid, e); }
    const sorted = [...by.values()].sort((a, b) => b.s.endedAt - a.s.endedAt || (a.s.sid < b.s.sid ? -1 : 1)), budget = this.opts.budget ?? C.budget;
    let used = 0, over = false;
    for (const e of sorted) { // newest keep their text; once over budget every older session keeps metadata only (until its file changes)
      const n = 2 * (e.hay.length - e.at); if (!n) continue;
      if (!over && used + n <= budget) { used += n; continue; }
      over = true; e.hay = copy(e.hay.slice(0, e.at)); e.fh = copy(e.fh.slice(0, e.at));
    }
    this.bySid = by; this.sorted = sorted;
    this.scannedAt = Date.now(); this.stats = { files: seen.size, parsed, ms: this.scannedAt - t, chars: used };
  }
  /** GET /history: newest first; q = AND of folded terms; auto sessions hidden unless q.auto (counted in autoHidden); q.bookmarked = bookmarked only, auto
   *  included; project facet = rows of this view ignoring q.project; `bookmarked` = bookmarked sessions matching q + project (auto included). */
  async list(q: HistoryQuery = {}): Promise<HistoryListResponse> {
    await this.ensure();
    const ts = searchTerms(String(q.q ?? '')), proj = q.project || undefined, auto = q.auto === true, only = q.bookmarked === true, marks = this.opts.bookmarks;
    const limit = Math.min(200, Math.max(1, int(q.limit, 50))), offset = Math.max(0, int(q.offset, 0));
    const rows: Array<{ e: Entry; m: ReturnType<typeof match> }> = [], projects = new Map<string, HistoryProject>(); let autoHidden = 0, bookmarked = 0;
    for (const e of this.sorted) {
      const m = ts.length ? match(e, ts) : null; if (ts.length && !m) continue;
      const b = marks?.get(e.s.sid), inProj = !proj || e.s.project === proj;
      if (b && inProj) bookmarked++;
      if (only ? !b : e.s.auto && !auto) { if (!only && inProj) autoHidden++; continue; }
      const p = projects.get(e.s.project);
      if (p) { p.sessions++; if (e.s.endedAt > p.lastAt) p.lastAt = e.s.endedAt; } else projects.set(e.s.project, { project: e.s.project, projectName: e.s.projectName, sessions: 1, lastAt: e.s.endedAt });
      if (inProj) rows.push({ e, m });
    }
    const sessions = rows.slice(offset, offset + limit).map(({ e, m }): HistoryHit => ({ ...this.view(e), ...(m ? { hits: m.hits, ...(m.at >= 0 ? { snippet: snippet(e, m.at, m.len) } : {}) } : {}) }));
    return { total: rows.length, offset, sessions, projects: [...projects.values()].sort((a, b) => b.lastAt - a.lastAt), autoHidden, scannedAt: this.scannedAt, bookmarked };
  }
  /** POST /history/bookmark: on=true needs an indexed sid ('unknown' otherwise) and sets/re-notes it; on=false removes (idempotent). 'unavailable' without a store. */
  async bookmark(sid: string, on: boolean, note?: unknown): Promise<HistoryBookmarkResponse | 'unknown' | 'full' | 'unavailable'> {
    const marks = this.opts.bookmarks; if (!marks) return 'unavailable';
    if (!HISTORY_SID.test(sid)) return 'unknown';
    if (!on) { marks.delete(sid); return { sid, bookmark: null }; }
    await this.ensure(); if (!this.bySid.has(sid)) return 'unknown';
    const b = marks.set(sid, note); return b === 'full' ? 'full' : { sid, bookmark: { ...b } };
  }
  /** Index entry of sid. An unknown sid waits for a scan already running, then for one rescan that started after the call (shared); miss-triggered rescans
   *  start at most every 5 s, so bogus sids cannot keep the disk busy. */
  private async lookup(sid: string) {
    const p = this.pending; await this.ensure();
    let e = this.bySid.get(sid); if (e) return e;
    if (p) { await p.catch(() => {}); e = this.bySid.get(sid); if (e) return e; } // that scan may predate the file
    if (Date.now() - this.missAt >= C.missMs) { this.missAt = Date.now(); await this.refresh().catch(() => {}); } else if (this.pending) await this.pending.catch(() => {});
    return this.bySid.get(sid);
  }
  /** GET /history/session: the transcript re-read as prompts, assistant text and tool summaries (no thinking, no tool results); ≤3000 items and ~4 MB of text, else
   *  truncated. An unknown sid waits for one rescan (a deep link to a session newer than the index) before null. */
  async detail(sid: string): Promise<HistoryDetailResponse | null> {
    if (!HISTORY_SID.test(sid)) return null;
    const e = await this.lookup(sid); if (!e) return null;
    const items: HistoryItem[] = []; let truncated = false, chars = 0;
    const add = (it: HistoryItem, n: number) => { if (items.length >= C.items || chars + n > C.detail) { truncated = true; return false; } items.push(it); chars += n; return true; };
    try {
      await eachLine(e.file, (l) => {
        const j = json(l);
        if ((j?.type !== 'user' && j?.type !== 'assistant') || j.isSidechain === true) return;
        const ts = tsOf(j), at = ts === ts ? { ts } : {};
        if (j.type === 'user') { const p = promptText(j); if (!p) return; const text = redactText(p, C.item); return add({ role: 'user', text, ...at }, text.length); }
        const c = j.message?.content;
        for (const b of typeof c === 'string' ? [{ type: 'text', text: c }] : Array.isArray(c) ? c : []) {
          if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim()) { const text = redactText(head(b.text, 2 * C.item).trim(), C.item); if (!add({ role: 'assistant', text, ...at }, text.length)) return false; }
          else if (b?.type === 'tool_use') { const name = meta(String(b.name ?? 'tool')), detail = toolSummary(name, b.input); if (!add({ role: 'tool', name, ...(detail ? { detail } : {}), ...at }, name.length + (detail?.length ?? 0))) return false; }
        }
      });
    } catch { return null; }
    return { session: this.view(e), items, truncated };
  }
}
