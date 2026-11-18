/** Authenticated GET /history, /history/session and POST /history/bookmark (same Bearer run token as /settings; never in the query string). */
import { officeHttpBase } from './settingsApi';
import type { HistoryBookmarkRequest, HistoryBookmarkResponse, HistoryDetailResponse, HistoryListResponse } from './types';
import { appendPage } from './history';

export type HistoryQuery = { q?: string; project?: string; auto?: boolean; bookmarked?: boolean; limit?: number; offset?: number };
/** `?q=…&project=…&auto=1&bookmarked=1&limit=…&offset=…`: empty params omitted, flags only when on, offset only past the first page. */
export function historyQs(p: HistoryQuery): string {
  const kv: [string, string][] = [], q = p.q?.trim();
  if (q) kv.push(['q', q]);
  if (p.project) kv.push(['project', p.project]);
  if (p.auto) kv.push(['auto', '1']);
  if (p.bookmarked) kv.push(['bookmarked', '1']);
  if (p.limit && p.limit > 0) kv.push(['limit', String(Math.floor(p.limit))]);
  if (p.offset && p.offset > 0) kv.push(['offset', String(Math.floor(p.offset))]);
  return kv.length ? `?${kv.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}` : '';
}
/** HTTP failure; status 0 = network error, -1 = response was not JSON. */
export class HistoryHttpError extends Error {
  status: number;
  constructor(status: number) { super(`history ${status}`); this.name = 'HistoryHttpError'; this.status = status; }
}
async function request<T>(token: string, path: string, signal?: AbortSignal, body?: unknown): Promise<T> {
  let r: Response;
  const init: RequestInit = body === undefined ? { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, cache: 'no-store', signal }
    : { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body), signal };
  try { r = await fetch(`${officeHttpBase()}${path}`, init); }
  catch (e) { if (signal?.aborted) throw e; throw new HistoryHttpError(0); }
  if (!r.ok) throw new HistoryHttpError(r.status);
  try { return (await r.json()) as T; } catch (e) { if (signal?.aborted) throw e; throw new HistoryHttpError(-1); }
}
export const fetchHistory = (token: string, p: HistoryQuery, signal?: AbortSignal) => request<HistoryListResponse>(token, `/history${historyQs(p)}`, signal);
export const fetchHistorySession = (token: string, sid: string, signal?: AbortSignal) => request<HistoryDetailResponse>(token, `/history/session?sid=${encodeURIComponent(sid)}`, signal);
/** The server clamps `limit` to this per request. */
export const MAX_LIMIT = 200;
/** Reload rows [0, n) in ≤200-row requests (after paging drift); returns the merged list and the server offset to continue from. */
export async function fetchHistoryUpTo(token: string, p: HistoryQuery, n: number, signal?: AbortSignal): Promise<{ data: HistoryListResponse; next: number }> {
  let data: HistoryListResponse | undefined, next = 0;
  do {
    const r = await fetchHistory(token, { ...p, offset: next, limit: Math.min(MAX_LIMIT, n - next) }, signal);
    data = data ? appendPage(data, r) : r; next = r.offset + r.sessions.length;
    if (!r.sessions.length) break;
  } while (next < n && next < data.total);
  return { data, next };
}
/** POST /history/bookmark: on=true adds/updates (the note replaces the old one), on=false removes. */
export const setBookmark = (token: string, req: HistoryBookmarkRequest, signal?: AbortSignal) => request<HistoryBookmarkResponse>(token, '/history/bookmark', signal, req);
export const isAbort = (e: unknown) => (e as { name?: string } | null)?.name === 'AbortError';
