import type { HistoryBookmarkRequest, HistoryBookmarkResponse, HistoryHit, HistoryListResponse, HistoryOpener, HistoryOpenResponse, HistoryProject, HistorySession } from './types';
/** Pure helpers for the History tab (unit-tested in test/history.test.ts). */

const foldMemo = new Map<string, string>();
/** Case + diacritic fold, one output unit per UTF-16 unit so match indexes map 1:1 back to the original text. Keep identical to the orchestrator's history search. */
export function fold(s: string): string {
  let o = '';
  for (let i = 0; i < s.length; i++) {
    const n = s.charCodeAt(i);
    if (n < 128) { o += n >= 65 && n <= 90 ? String.fromCharCode(n + 32) : s[i]; continue; }
    const c = s[i]; let f = foldMemo.get(c);
    if (f === undefined) { f = (c.normalize('NFD')[0] ?? c).toLowerCase()[0] ?? c; if (f === 'đ') f = 'd'; foldMemo.set(c, f); }
    o += f;
  }
  return o;
}
export const MAX_TERMS = 8, MAX_TERM_LEN = 100;
/** Search terms exactly like the server's `searchTerms`: whitespace-separated, `"quoted phrase"` = one term (inner whitespace collapsed), bare tokens lose edge quotes, folded, distinct, ≤100 chars, max 8. */
export function parseTerms(q: string): string[] {
  const out: string[] = [];
  for (const m of q.slice(0, 2000).matchAll(/"([^"]*)"|(\S+)/g)) {
    const t = fold((m[1] ?? m[2].replace(/^"+|"+$/g, '')).replace(/\s+/g, ' ').trim()).slice(0, MAX_TERM_LEN);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= MAX_TERMS) break;
  }
  return out;
}
export type Seg = { t: string; m?: true };
export const MIN_HL = 2, MAX_MARKS = 200;
/** Split text into plain / marked segments for folded terms; overlapping or adjacent matches merge into one mark. Terms under 2 chars are not
 *  highlighted (the server still searches them) and at most `max` marks are made; the rest stays plain text. */
export function highlight(text: string, terms: readonly string[], max = MAX_MARKS): Seg[] {
  if (!text) return [];
  const ts = terms.filter((t) => t.length >= MIN_HL);
  if (!ts.length || max < 1) return [{ t: text }];
  const f = fold(text), r: [number, number][] = []; let cut = Infinity; // a term stops after `max` matches; past the earliest stop the ranges may be incomplete, so nothing there is marked
  for (const t of ts) { let n = 0; for (let i = f.indexOf(t); i >= 0; i = f.indexOf(t, i + 1)) { r.push([i, i + t.length]); if (++n >= max) { cut = Math.min(cut, i); break; } } }
  if (!r.length) return [{ t: text }];
  r.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: Seg[] = []; let pos = 0, marks = 0, [s, e] = r[0];
  const flush = () => { if (s > pos) out.push({ t: text.slice(pos, s) }); out.push({ t: text.slice(s, e), m: true }); pos = e; marks++; };
  for (let k = 1; k < r.length && r[k][0] <= cut; k++) { const [a, b] = r[k]; if (a <= e) e = Math.max(e, b); else { flush(); if (marks >= max) break; s = a; e = b; } }
  if (marks < max) flush();
  if (pos < text.length) out.push({ t: text.slice(pos) });
  return out;
}
/** POSIX single-quoted shell word: `it's` → `'it'\''s'`. */
export const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
/** PowerShell single-quoted string; PowerShell also treats ‘ ’ ‚ ‛ as single quotes, so those are doubled too. */
export const psq = (s: string) => `'${s.replace(/['\u2018\u2019\u201A\u201B]/g, '$&$&')}'`;
/** Drive (`C:\`, `C:/`) or UNC (`\\host\share`) path. */
export const isWinPath = (p: string) => /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\');
/** Clipboard command to reopen a past session in its project: PowerShell for Windows paths (-LiteralPath: no wildcard expansion of [ ]), POSIX sh otherwise
 *  (the path is single-quoted only when it has a space or another shell character). */
export function resumeCommand(project: string, sid: string) {
  const safe = /^[\w-]+$/.test(sid);
  return isWinPath(project) ? `cd -LiteralPath ${psq(project)}; claude --resume ${safe ? sid : psq(sid)}` : `cd ${/^[\w@%+=:,./-]+$/.test(project) ? project : shq(project)} && claude --resume ${safe ? sid : shq(sid)}`;
}
const p2 = (n: number) => String(n).padStart(2, '0');
/** Local `YYYY-MM-DD HH:MM`. */
export function absTime(ts: number) { const d = new Date(ts); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`; }
/** `just now`, `5m ago`, `3h ago`, `2d ago`, then the local date after a week. */
export function relTime(ts: number, now: number) {
  const s = Math.max(0, (now - ts) / 1000);
  return s < 45 ? 'just now' : s < 3600 ? `${Math.max(1, Math.floor(s / 60))}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : s < 7 * 86400 ? `${Math.floor(s / 86400)}d ago` : absTime(ts).slice(0, 10);
}
/** `45s`, `12m`, `1h 05m`, `2d 3h`. */
export function fmtDuration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000)), m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
  return s < 60 ? `${s}s` : m < 60 ? `${m}m` : h < 24 ? `${h}h ${p2(m % 60)}m` : `${d}d ${h % 24}h`;
}
/** `2026-11-18 09:05 – 10:40` (end date shown only when it differs). */
export function fmtSpan(start: number, end: number) { const a = absTime(start), b = absTime(end); return `${a} – ${a.slice(0, 10) === b.slice(0, 10) ? b.slice(11) : b}`; }
export function fmtCost(usd: number) { return `$${usd < 1 ? usd.toFixed(3) : usd.toFixed(2)}`; }
/** User-facing text for a failed history request (status 0 = network, -1 = not JSON). */
export function historyErrorText(status: number, kind: 'list' | 'session' | 'bookmark' = 'list') {
  if (status === 401 || status === 403) return 'The run token was rejected. Reopen the URL from orchestrator/.run/ui-url.txt.';
  if (status === 0) return 'Cannot reach the orchestrator. Is it running?';
  if (status === -1) return 'Unexpected response from the orchestrator.';
  if (kind === 'bookmark') return status === 404 ? 'Session not in the history index. Refresh, then retry.' : status === 400 ? 'Bookmark rejected (bad input).' : status === 405 || status === 501 ? 'This orchestrator has no bookmarks. Restart it.' : `Bookmark failed (${status}).`;
  if (kind === 'session' && status === 404) return 'Transcript not found (moved or deleted).';
  if (status === 404 || status === 405 || status === 501) return 'This orchestrator is too old for History (no /history). Restart it.';
  return `History request failed (${status}).`;
}
/** Append a "load more" page, dropping sids already listed (offsets shift when new sessions end). */
export function appendPage(prev: HistoryListResponse, next: HistoryListResponse): HistoryListResponse {
  const have = new Set(prev.sessions.map((x) => x.sid)), add: HistoryHit[] = next.sessions.filter((x) => !have.has(x.sid));
  return { ...next, offset: prev.offset, sessions: [...prev.sessions, ...add] };
}
/** "Load more" is fetched from `next - 1` (one row of overlap). If that row is still our last row the order held and the rest is appended;
 *  null = the order drifted (a session jumped to the top, which offset paging would skip), so the caller reloads from 0 instead. */
export function continuePage(prev: HistoryListResponse, page: HistoryListResponse): HistoryListResponse | null {
  const last = prev.sessions[prev.sessions.length - 1];
  if (!last || page.sessions[0]?.sid !== last.sid) return null;
  return appendPage(prev, { ...page, sessions: page.sessions.slice(1) });
}
export const NOTE_MAX = 200;
/** POST /history/bookmark body: the note is trimmed and capped, and only sent when non-empty (on=true without a note clears it). */
export function bookmarkRequest(sid: string, on: boolean, note?: string): HistoryBookmarkRequest {
  const n = on ? (note ?? '').trim().slice(0, NOTE_MAX) : '';
  return { sid, on, ...(n ? { note: n } : {}) };
}
/** Session with the bookmark from a reply applied (same object when the sid differs or nothing changed). */
export function patchSession<T extends HistorySession>(x: T, r: HistoryBookmarkResponse): T {
  if (x.sid !== r.sid || (!x.bookmark && !r.bookmark) || (x.bookmark && r.bookmark && x.bookmark.at === r.bookmark.at && x.bookmark.note === r.bookmark.note)) return x;
  const { bookmark: _, ...rest } = x;
  return (r.bookmark ? { ...rest, bookmark: r.bookmark } : rest) as T;
}
/** Apply a bookmark reply to the listed rows; rows stay in place (un-starred ones too, until the next reload) and `bookmarked` moves by the change. */
export function patchList(d: HistoryListResponse, r: HistoryBookmarkResponse): HistoryListResponse {
  const i = d.sessions.findIndex((x) => x.sid === r.sid); if (i < 0) return d;
  const was = d.sessions[i], now = patchSession(was, r); if (now === was) return d;
  const sessions = d.sessions.slice(); sessions[i] = now;
  return { ...d, sessions, bookmarked: Math.max(0, (d.bookmarked ?? 0) + (now.bookmark ? 1 : 0) - (was.bookmark ? 1 : 0)) };
}
export type ProjectOption = { value: string; label: string; title?: string };
/** Project <select> options: "All projects (sum)", the facets (full path when names clash), and the current filter if it no longer matches. */
export function projectOptions(projects: readonly HistoryProject[], current = ''): ProjectOption[] {
  const n = new Map<string, number>(); for (const p of projects) n.set(p.projectName, (n.get(p.projectName) ?? 0) + 1);
  const out: ProjectOption[] = [{ value: '', label: `All projects (${projects.reduce((a, p) => a + p.sessions, 0)})` }];
  if (current && !projects.some((p) => p.project === current)) out.push({ value: current, label: `${current} (0)`, title: current });
  for (const p of projects) out.push({ value: p.project, label: `${(n.get(p.projectName) ?? 0) > 1 ? p.project : p.projectName} (${p.sessions})`, title: p.project });
  return out;
}
/** Placeholder for a session opened by sid alone (from the "Hiệu suất" tab) until /history/session answers; bytes -1 marks it. */
export const ghostSession = (sid: string): HistorySession => ({ sid, project: '', projectName: '', title: '', startedAt: 0, endedAt: 0, prompts: 0, messages: 0, auto: false, subagents: 0, bytes: -1 });
export const isGhost = (x: HistorySession) => x.bytes < 0;
/** The selection to keep once a transcript is loaded: a placeholder for that sid becomes the loaded session (same object otherwise). */
export function unGhost<T extends HistorySession>(sel: T, det: { sid: string; data?: { session: HistorySession } }): T | HistorySession {
  return isGhost(sel) && det.sid === sel.sid && det.data ? det.data.session : sel;
}
/** A placeholder's 404 is retried once after this long: the server refreshes its index on an unknown sid. */
export const GHOST_RETRY_MS = 2000;
/** Request from another tab to open a sid in History; n changes on every request so the same sid can be opened again. */
export type OpenRequest = { sid: string; n: number };
export type MainTab = 'office' | 'history' | 'claude' | 'report';
export const TAB_KEY = 'office.tab';
type Store = Pick<Storage, 'getItem' | 'setItem'>;
const local = (): Store | undefined => { try { return typeof localStorage === 'undefined' ? undefined : localStorage; } catch { return undefined; } };
/** "Mở lại": last app used (localStorage, best effort). */
export const OPENER_KEY = 'office.opener';
export function loadOpener(store: Store | undefined = local()): string | undefined { try { return store?.getItem(OPENER_KEY) ?? undefined; } catch { return undefined; } }
export function saveOpener(id: string, store: Store | undefined = local()) { try { store?.setItem(OPENER_KEY, id); } catch { /* private mode / quota */ } }
/** The main button's app: the last one used if it is still offered, else the first. */
export const pickOpener = (openers: readonly HistoryOpener[], last?: string) => openers.find((o) => o.id === last) ?? openers[0];
/** Menu hint for an editor without the Claude Code extension (it only opens the folder). */
export const openerHint = (o: HistoryOpener) => o.kind === 'editor' && !o.resumes ? '(chỉ mở thư mục)' : '';
/** Inline status after POST /history/open succeeded. */
export const openedText = (r: Pick<HistoryOpenResponse, 'resumed' | 'note'>, label: string) => `${r.resumed ? 'Đã mở trong' : 'Đã mở thư mục trong'} ${label}${r.note ? `. ${r.note}` : ''}`;
/** Inline error for a failed open: the server's reason when it gave one (status 0 = network, -1 = not JSON).
 *  409 automation-pending = macOS is showing its Automation prompt (osascript timed out); 409 busy = another launch is running (one at a time). */
export function openErrorText(status: number, error?: string, reason?: string) {
  if (reason) return reason;
  if (error === 'automation-pending') return 'macOS đang hỏi quyền cho văn phòng điều khiển ứng dụng: bấm OK trong hộp thoại đó rồi bấm Mở lại.';
  if (error === 'busy') return 'Đang mở một phiên khác. Thử lại sau giây lát.';
  if (status === 401 || status === 403) return 'Run token bị từ chối. Mở lại URL trong orchestrator/.run/ui-url.txt.';
  if (status === 0) return 'Không kết nối được orchestrator.';
  if (status === -1) return 'Orchestrator trả về dữ liệu không đọc được.';
  if (!error && (status === 404 || status === 405 || status === 501)) return 'Orchestrator này chưa hỗ trợ “Mở lại”. Khởi động lại nó.';
  return `Không mở được${error ? `: ${error}` : ` (${status})`}.`;
}
export const isOpenConfirm = (error?: string) => error === 'confirm-required';
/** A launch still running after this long may be waiting on the macOS Automation prompt: show `permissionHint`. */
export const OPEN_SLOW_MS = 3000;
export const permissionHint = (label: string) => `Nếu macOS hỏi quyền điều khiển ${label}, bấm OK.`;
/** The copyable command is quoted for sh/bash/zsh only: a POSIX path with \ ! ' or a control character (newline…) reads differently in fish & co. */
export const shOnlyPath = (project: string) => !isWinPath(project) && /[\\!'\x00-\x1f\x7f]/.test(project);
export const SH_ONLY_NOTE = 'đường dẫn có ký tự đặc biệt — chỉ dùng trong bash/zsh';
export function loadTab(store: Store | undefined = local()): MainTab { try { const t = store?.getItem(TAB_KEY); return t === 'history' || t === 'claude' || t === 'report' ? t : 'office'; } catch { return 'office'; } }
export function saveTab(t: MainTab, store: Store | undefined = local()) { try { store?.setItem(TAB_KEY, t); } catch { /* private mode / quota */ } }
