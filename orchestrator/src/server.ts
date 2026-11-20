import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import type { ClaudeConfigView, HistoryBookmarkResponse, HistoryDetailResponse, HistoryListResponse, HistoryOpenersResponse, ModelReportResponse, DeckEvent } from './types.js';
import { redactText } from './redact.js';
import { HISTORY_SID, type HistoryQuery } from './history.js';
export const HOST = '127.0.0.1';
export function newToken() { return randomBytes(24).toString('base64url'); }
export function tokenOk(given: string | null, expected: string) {
  if (!given) return false;
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
/** Allow no Origin (non-browser client, still needs token) or loopback http(s) origins only. */
export function originOk(origin: string | undefined) {
  if (!origin) return true;
  try { const u = new URL(origin); return (u.protocol === 'http:' || u.protocol === 'https:') && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname); } catch { return false; }
}
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
/** POST /event auth (the mod cannot know the per-run token): loopback peer only; reject browser pages, i.e. an Origin that is an
 *  http(s) URL or 'null' (sandboxed/file pages), or Sec-Fetch-Site cross-site/same-site; absent headers are fine (the engine's
 *  $.http.fetch may or may not add them). Content-Type must be application/json, which forces a CORS preflight on any
 *  cross-origin browser request, and we never answer preflights. Returns an HTTP status to reject with, or 0. */
export function eventRequestRejection(req: Pick<IncomingMessage, 'headers'> & { socket: { remoteAddress?: string } }): number {
  if (!LOOPBACK.has(req.socket.remoteAddress ?? '')) return 403;
  const h = req.headers, origin = String(h.origin ?? '').trim().toLowerCase(), site = String(h['sec-fetch-site'] ?? '').toLowerCase();
  if (/^https?:/.test(origin) || origin === 'null' || site === 'cross-site' || site === 'same-site') return 403;
  if (!String(h['content-type'] ?? '').toLowerCase().startsWith('application/json')) return 415;
  return 0;
}
/** GET /inbox (mod poll): loopback + same anti-browser as /event; no JSON Content-Type required. */
export function inboxGetRejection(req: Pick<IncomingMessage, 'headers'> & { socket: { remoteAddress?: string } }): number {
  if (!LOOPBACK.has(req.socket.remoteAddress ?? '')) return 403;
  const h = req.headers, origin = String(h.origin ?? '').trim().toLowerCase(), site = String(h['sec-fetch-site'] ?? '').toLowerCase();
  if (/^https?:/.test(origin) || origin === 'null' || site === 'cross-site' || site === 'same-site') return 403;
  return 0;
}
/** POST /prompt (UI send): loopback + Origin allow-list + JSON + Bearer run token (checked separately). */
export function promptRequestRejection(req: Pick<IncomingMessage, 'headers' | 'method'> & { socket: { remoteAddress?: string } }): number {
  if (!LOOPBACK.has(req.socket.remoteAddress ?? '')) return 403;
  if (!originOk(req.headers.origin)) return 403;
  if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) return 415;
  return 0;
}
/** GET /history*, /claude-config, /model-report (UI read): loopback peer + Origin allow-list; the Bearer run token is checked separately (401). */
export function historyRequestRejection(req: Pick<IncomingMessage, 'headers'> & { socket: { remoteAddress?: string } }): number {
  if (!LOOPBACK.has(req.socket.remoteAddress ?? '')) return 403;
  return originOk(req.headers.origin) ? 0 : 403;
}
export type EventResult = boolean | { ok: true; inboxToken?: string };
export type PromptResult = { ok: true; id: string; nonce: string; state: string } | { ok: false; error: string; status: number };
export type InboxClaim = { ok: 'unauthorized' } | { ok: 'empty' } | { ok: true; id: string; text: string; model?: string; effort?: string };
export class DeckServer {
  private http: Server; private wss: WebSocketServer;
  port = 0;
  constructor(private token: string, private snapshot: () => DeckEvent, private opts: {
    onEvent?: (p: unknown) => EventResult; staticDir?: string;
    getSettings?: () => unknown; setSettings?: (patch: unknown) => { ok: true; view: unknown } | { ok: false; error: string };
    onPrompt?: (p: { sid: string; text: unknown; nonce: unknown; model?: unknown; effort?: unknown }) => PromptResult;
    onInboxClaim?: (sid: string, token: string | undefined) => InboxClaim;
    onInboxAck?: (sid: string, token: string | undefined, id: string, state: string, reason?: string) => 'unauthorized' | boolean;
    history?: { list(q: HistoryQuery): Promise<HistoryListResponse>; detail(sid: string): Promise<HistoryDetailResponse | null>;
      bookmark(sid: string, on: boolean, note?: string | null): Promise<HistoryBookmarkResponse | 'unknown' | 'full' | 'unavailable'> };
    claude?: { view(): Promise<ClaudeConfigView>; post(op: string, body: unknown, signal?: AbortSignal): Promise<{ status: number; body: unknown }> };
    modelReport?: { report(q: { days: number; auto: boolean; fresh: boolean }): Promise<ModelReportResponse> };
    opener?: { openers(): Promise<HistoryOpenersResponse>; open(body: unknown): Promise<{ status: number; body: unknown }> };
  } = {}) {
    this.http = createServer((req, res) => { this.handle(req, res).catch(() => { if (!res.headersSent) res.writeHead(500).end(); }); });
    this.wss = new WebSocketServer({ noServer: true });
    this.http.on('upgrade', (req: IncomingMessage, socket, head) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/ws' || !originOk(req.headers.origin) || !tokenOk(url.searchParams.get('token'), this.token)) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => { ws.send(JSON.stringify(this.snapshot())); });
    });
  }
  private async handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const sec = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' };
    if (url.pathname === '/health') { res.writeHead(200, { ...sec, 'content-type': 'application/json' }).end('{"ok":true}'); return; }
    if (url.pathname === '/settings') {
      const auth = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1] ?? url.searchParams.get('token');
      if (!tokenOk(auth ?? null, this.token)) { res.writeHead(401, { ...sec, 'content-type': 'application/json' }).end('{"error":"unauthorized"}'); return; }
      if (req.method === 'GET') {
        if (!this.opts.getSettings) { res.writeHead(501, { ...sec, 'content-type': 'application/json' }).end('{"error":"unavailable"}'); return; }
        res.writeHead(200, { ...sec, 'content-type': 'application/json' }).end(JSON.stringify(this.opts.getSettings())); return;
      }
      if (req.method === 'PUT' || req.method === 'PATCH') {
        if (!this.opts.setSettings) { res.writeHead(501, { ...sec, 'content-type': 'application/json' }).end('{"error":"unavailable"}'); return; }
        let body = ''; let tooBig = false;
        for await (const chunk of req) { body += chunk; if (body.length > 16 * 1024) { tooBig = true; break; } }
        if (tooBig) { res.writeHead(413, sec).end(); req.destroy(); return; }
        let patch: unknown; try { patch = body ? JSON.parse(body) : {}; } catch { res.writeHead(400, { ...sec, 'content-type': 'application/json' }).end('{"error":"bad json"}'); return; }
        const r = this.opts.setSettings(patch);
        if (!r.ok) { res.writeHead(400, { ...sec, 'content-type': 'application/json' }).end(JSON.stringify({ error: r.error })); return; }
        res.writeHead(200, { ...sec, 'content-type': 'application/json' }).end(JSON.stringify(r.view)); return;
      }
      res.writeHead(405, sec).end(); return;
    }
    const cc = url.pathname === '/claude-config' ? 'view' : /^\/claude-config\/mcp\/(save|delete|reveal|test)$/.exec(url.pathname)?.[1];
    if (cc) {
      const out = (status: number, body: unknown) => { res.writeHead(status, { ...sec, 'content-type': 'application/json' }).end(JSON.stringify(body)); };
      if (req.method !== (cc === 'view' ? 'GET' : 'POST')) { req.resume(); res.writeHead(405, sec).end(); return; }
      const why = cc === 'view' ? historyRequestRejection(req) : promptRequestRejection(req);
      if (why) { req.resume(); res.writeHead(why, sec).end(); return; }
      const auth = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
      if (!tokenOk(auth ?? null, this.token)) { req.resume(); out(401, { error: 'unauthorized' }); return; }
      if (!this.opts.claude) { req.resume(); out(501, { error: 'unavailable' }); return; }
      if (cc === 'view') { try { out(200, await this.opts.claude.view()); } catch (e) { out(500, { error: redactText(String((e as Error)?.message ?? e), 300) }); } return; }
      const raw = await this.readBody(req, res, sec, 64 * 1024); if (raw == null) return;
      let p: unknown; try { p = raw ? JSON.parse(raw) : {}; } catch { out(400, { error: 'bad json' }); return; }
      const ac = new AbortController(); res.on('close', () => { if (!res.writableFinished) ac.abort(); }); // client gone: stop a running test
      const r = await this.opts.claude.post(cc, p, ac.signal); if (!res.destroyed) out(r.status, r.body); return;
    }
    if (url.pathname === '/history/openers' || url.pathname === '/history/open') { // launches local apps: GET = /history gate, POST = /prompt gate; both need the Bearer run token
      const out = (status: number, body: unknown) => { res.writeHead(status, { ...sec, 'content-type': 'application/json' }).end(JSON.stringify(body)); };
      const list = url.pathname === '/history/openers';
      if (req.method !== (list ? 'GET' : 'POST')) { req.resume(); res.writeHead(405, sec).end(); return; }
      const why = list ? historyRequestRejection(req) : promptRequestRejection(req);
      if (why) { req.resume(); res.writeHead(why, sec).end(); return; }
      const auth = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
      if (!tokenOk(auth ?? null, this.token)) { req.resume(); out(401, { error: 'unauthorized' }); return; }
      if (!this.opts.opener) { req.resume(); out(501, { error: 'unavailable' }); return; }
      try {
        if (list) { out(200, await this.opts.opener.openers()); return; }
        const raw = await this.readBody(req, res, sec, 4 * 1024); if (raw == null) return;
        let p: unknown; try { p = raw ? JSON.parse(raw) : {}; } catch { out(400, { error: 'bad json' }); return; }
        const r = await this.opts.opener.open(p); if (!res.destroyed) out(r.status, r.body);
      } catch (e) { if (!res.headersSent) out(500, { error: redactText(String((e as Error)?.message ?? e), 300) }); }
      return;
    }
    if (url.pathname === '/history/bookmark') {
      const out = (status: number, body: unknown) => { res.writeHead(status, { ...sec, 'content-type': 'application/json' }).end(JSON.stringify(body)); };
      if (req.method !== 'POST') { res.writeHead(405, sec).end(); return; }
      const why = promptRequestRejection(req);
      if (why) { req.resume(); res.writeHead(why, sec).end(); return; }
      const auth = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
      if (!tokenOk(auth ?? null, this.token)) { req.resume(); out(401, { error: 'unauthorized' }); return; }
      if (!this.opts.history) { req.resume(); out(501, { error: 'unavailable' }); return; }
      const raw = await this.readBody(req, res, sec, 4 * 1024); if (raw == null) return;
      let p: any; try { p = raw ? JSON.parse(raw) : {}; } catch { out(400, { error: 'bad json' }); return; }
      const sid = typeof p?.sid === 'string' ? p.sid : '';
      if (!HISTORY_SID.test(sid)) { out(400, { error: 'bad sid' }); return; }
      if (typeof p.on !== 'boolean') { out(400, { error: 'on must be a boolean' }); return; }
      if (p.note != null && typeof p.note !== 'string') { out(400, { error: 'note must be a string' }); return; }
      const r = await this.opts.history.bookmark(sid, p.on, p.note);
      if (r === 'unknown') { out(404, { error: 'not found' }); return; }
      if (r === 'full') { out(409, { error: 'too many bookmarks' }); return; }
      if (r === 'unavailable') { out(501, { error: 'unavailable' }); return; }
      out(200, r); return;
    }
    if (url.pathname === '/history' || url.pathname === '/history/session') {
      const out = (status: number, body: unknown) => { res.writeHead(status, { ...sec, 'content-type': 'application/json' }).end(JSON.stringify(body)); };
      if (req.method !== 'GET') { res.writeHead(405, sec).end(); return; }
      const why = historyRequestRejection(req);
      if (why) { res.writeHead(why, sec).end(); return; }
      const auth = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
      if (!tokenOk(auth ?? null, this.token)) { out(401, { error: 'unauthorized' }); return; }
      if (!this.opts.history) { out(501, { error: 'unavailable' }); return; }
      const p = url.searchParams;
      if (url.pathname === '/history') { out(200, await this.opts.history.list({ q: p.get('q') ?? '', project: p.get('project') || undefined, auto: p.get('auto') === '1', bookmarked: p.get('bookmarked') === '1', limit: Number(p.get('limit') || 50), offset: Number(p.get('offset') || 0) })); return; }
      const sid = p.get('sid') ?? '';
      if (!HISTORY_SID.test(sid)) { out(400, { error: 'bad sid' }); return; } // looked up in the index only, never used as a path
      const d = await this.opts.history.detail(sid);
      if (!d) { out(404, { error: 'not found' }); return; }
      out(200, d); return;
    }
    if (url.pathname === '/model-report') {
      const out = (status: number, body: unknown) => { res.writeHead(status, { ...sec, 'content-type': 'application/json' }).end(JSON.stringify(body)); };
      if (req.method !== 'GET') { req.resume(); res.writeHead(405, sec).end(); return; }
      const why = historyRequestRejection(req);
      if (why) { res.writeHead(why, sec).end(); return; }
      const auth = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
      if (!tokenOk(auth ?? null, this.token)) { out(401, { error: 'unauthorized' }); return; }
      if (!this.opts.modelReport) { out(501, { error: 'unavailable' }); return; }
      const d = url.searchParams.get('days'), days = d === null || d === '' ? 30 : /^\d{1,4}$/.test(d) ? Number(d) : NaN;
      if (!(days === 0 || (days >= 1 && days <= 3650))) { out(400, { error: 'days must be 0 or 1..3650' }); return; }
      try { out(200, await this.opts.modelReport.report({ days, auto: url.searchParams.get('auto') === '1', fresh: url.searchParams.get('fresh') === '1' })); } catch (e) { out(500, { error: redactText(String((e as Error)?.message ?? e), 300) }); }
      return;
    }
    if (url.pathname === '/event') {
      if (req.method !== 'POST') { res.writeHead(405, sec).end(); return; }
      const why = eventRequestRejection(req);
      if (why) { req.resume(); res.writeHead(why, sec).end(); return; }
      const raw = await this.readBody(req, res, sec, 64 * 1024); if (raw == null) return;
      let payload: unknown; try { payload = JSON.parse(raw); } catch { res.writeHead(400, sec).end(); return; }
      const ok = this.opts.onEvent ? this.opts.onEvent(payload) : false;
      if (!ok) { res.writeHead(400, sec).end(); return; }
      const inboxToken = typeof ok === 'object' ? ok.inboxToken : undefined;
      if (inboxToken) { res.writeHead(200, { ...sec, 'content-type': 'application/json' }).end(JSON.stringify({ inboxToken })); return; }
      res.writeHead(204, sec).end(); return;
    }
    if (url.pathname === '/prompt') {
      if (req.method !== 'POST') { res.writeHead(405, sec).end(); return; }
      const why = promptRequestRejection(req);
      if (why) { req.resume(); res.writeHead(why, sec).end(); return; }
      const auth = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
      if (!tokenOk(auth ?? null, this.token)) { res.writeHead(401, { ...sec, 'content-type': 'application/json' }).end('{"error":"unauthorized"}'); return; }
      if (!this.opts.onPrompt) { res.writeHead(501, { ...sec, 'content-type': 'application/json' }).end('{"error":"unavailable"}'); return; }
      const raw = await this.readBody(req, res, sec, 16 * 1024); if (raw == null) return;
      let payload: any; try { payload = raw ? JSON.parse(raw) : {}; } catch { res.writeHead(400, { ...sec, 'content-type': 'application/json' }).end('{"error":"bad json"}'); return; }
      const r = this.opts.onPrompt({ sid: payload?.sid, text: payload?.text, nonce: payload?.nonce, model: payload?.model, effort: payload?.effort });
      if (!r.ok) { res.writeHead(r.status, { ...sec, 'content-type': 'application/json' }).end(JSON.stringify({ error: r.error })); return; }
      res.writeHead(200, { ...sec, 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, id: r.id, nonce: r.nonce, state: r.state })); return;
    }
    if (url.pathname === '/inbox' || url.pathname === '/inbox/ack') {
      const json = url.pathname === '/inbox/ack';
      if (url.pathname === '/inbox' && req.method !== 'GET') { res.writeHead(405, sec).end(); return; }
      if (url.pathname === '/inbox/ack' && req.method !== 'POST') { res.writeHead(405, sec).end(); return; }
      const why = json ? eventRequestRejection(req) : inboxGetRejection(req);
      if (why) { req.resume(); res.writeHead(why, sec).end(); return; }
      const auth = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
      if (tokenOk(auth ?? null, this.token)) { res.writeHead(403, { ...sec, 'content-type': 'application/json' }).end('{"error":"forbidden"}'); return; } // run token is not an inbox token
      const sid = (url.searchParams.get('sid') ?? '').replace(/[^\w-]/g, '').slice(0, 64);
      if (url.pathname === '/inbox') {
        if (!sid || !this.opts.onInboxClaim) { res.writeHead(400, sec).end(); return; }
        const r = this.opts.onInboxClaim(sid, auth);
        if (r.ok === 'unauthorized') { res.writeHead(401, { ...sec, 'content-type': 'application/json' }).end('{"error":"unauthorized"}'); return; }
        if (r.ok === 'empty') { res.writeHead(204, sec).end(); return; }
        res.writeHead(200, { ...sec, 'content-type': 'application/json' }).end(JSON.stringify({ id: r.id, text: r.text, model: r.model, effort: r.effort })); return;
      }
      if (!this.opts.onInboxAck) { res.writeHead(501, sec).end(); return; }
      const raw = await this.readBody(req, res, sec, 8 * 1024); if (raw == null) return;
      let payload: any; try { payload = raw ? JSON.parse(raw) : {}; } catch { res.writeHead(400, sec).end(); return; }
      const ackSid = String(payload?.sid ?? sid).replace(/[^\w-]/g, '').slice(0, 64);
      const id = typeof payload?.id === 'string' ? payload.id.slice(0, 64) : '';
      const state = typeof payload?.state === 'string' ? payload.state : '';
      const reason = typeof payload?.reason === 'string' ? payload.reason : undefined;
      const r = this.opts.onInboxAck(ackSid, auth, id, state, reason);
      if (r === 'unauthorized') { res.writeHead(401, { ...sec, 'content-type': 'application/json' }).end('{"error":"unauthorized"}'); return; }
      res.writeHead(r ? 204 : 400, sec).end(); return;
    }
    if (this.opts.staticDir && req.method === 'GET') {
      const rel = normalize(decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)).replace(/^([/\\])+/, '');
      const file = join(this.opts.staticDir, rel);
      if (!file.startsWith(this.opts.staticDir + sep)) { res.writeHead(403, sec).end(); return; }
      try {
        const data = await readFile(file);
        const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.glb': 'model/gltf-binary', '.txt': 'text/plain; charset=utf-8' };
        res.writeHead(200, { ...sec, 'content-type': types[extname(file)] ?? 'application/octet-stream',
          'content-security-policy': "default-src 'self'; connect-src 'self' ws://127.0.0.1:* ws://localhost:*; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:" }).end(data);
        return;
      } catch { /* fallthrough */ }
    }
    res.writeHead(404, sec).end();
  }
  private async readBody(req: IncomingMessage, res: ServerResponse, sec: Record<string, string>, max: number) {
    let body = ''; let tooBig = false;
    req.setEncoding('utf8');
    for await (const chunk of req) { body += chunk; if (body.length > max) { tooBig = true; break; } }
    if (tooBig) { res.writeHead(413, sec).end(); req.destroy(); return; }
    return body;
  }
  listen(port: number) { return new Promise<number>((res, rej) => { this.http.once('error', rej); this.http.listen(port, HOST, () => { this.port = (this.http.address() as any).port; res(this.port); }); }); }
  broadcast(e: DeckEvent) { const s = JSON.stringify(e); for (const c of this.wss.clients) if (c.readyState === WebSocket.OPEN) c.send(s); }
  async close() {
    // graceful: let queued frames flush, then force after 1s
    await Promise.all([...this.wss.clients].map((c) => new Promise<void>((r) => { const t = setTimeout(() => { c.terminate(); r(); }, 1000); c.once('close', () => { clearTimeout(t); r(); }); c.close(1000, 'run finished'); })));
    await new Promise<void>((r) => this.http.close(() => r()));
  }
}
export function redactUrl(u: string) { return u.replace(/([?&]token=)[^&]+/, '$1[REDACTED]'); }
