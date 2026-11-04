import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import type { OfficeEvent } from './types.js';
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
/** POST /event auth (the mod cannot know the per-run token): loopback peer only, no browser markers
 *  (Origin / Sec-Fetch-Site; browsers always send them on cross-site requests. Sec-Fetch-Mode is NOT checked: Node/undici fetch sends it), and Content-Type application/json,
 *  which makes any cross-origin browser POST a CORS preflight that we never answer. Returns an HTTP status to reject with, or 0. */
export function eventRequestRejection(req: Pick<IncomingMessage, 'headers'> & { socket: { remoteAddress?: string } }): number {
  if (!LOOPBACK.has(req.socket.remoteAddress ?? '')) return 403;
  const h = req.headers;
  if (h.origin !== undefined || h['sec-fetch-site'] !== undefined) return 403;
  if (!String(h['content-type'] ?? '').toLowerCase().startsWith('application/json')) return 415;
  return 0;
}
export class OfficeServer {
  private http: Server; private wss: WebSocketServer;
  port = 0;
  constructor(private token: string, private snapshot: () => OfficeEvent, private opts: { onEvent?: (p: unknown) => boolean; staticDir?: string } = {}) {
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
    if (url.pathname === '/event') {
      if (req.method !== 'POST') { res.writeHead(405, sec).end(); return; }
      const why = eventRequestRejection(req);
      if (why) { req.resume(); res.writeHead(why, sec).end(); return; }
      let body = ''; let tooBig = false;
      for await (const chunk of req) { body += chunk; if (body.length > 64 * 1024) { tooBig = true; break; } }
      if (tooBig) { res.writeHead(413, sec).end(); req.destroy(); return; }
      let payload: unknown; try { payload = JSON.parse(body); } catch { res.writeHead(400, sec).end(); return; }
      const ok = this.opts.onEvent ? this.opts.onEvent(payload) : false;
      res.writeHead(ok ? 204 : 400, sec).end(); return;
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
  listen(port: number) { return new Promise<number>((res, rej) => { this.http.once('error', rej); this.http.listen(port, HOST, () => { this.port = (this.http.address() as any).port; res(this.port); }); }); }
  broadcast(e: OfficeEvent) { const s = JSON.stringify(e); for (const c of this.wss.clients) if (c.readyState === WebSocket.OPEN) c.send(s); }
  async close() {
    // graceful: let queued frames flush, then force after 1s
    await Promise.all([...this.wss.clients].map((c) => new Promise<void>((r) => { const t = setTimeout(() => { c.terminate(); r(); }, 1000); c.once('close', () => { clearTimeout(t); r(); }); c.close(1000, 'run finished'); })));
    await new Promise<void>((r) => this.http.close(() => r()));
  }
}
export function redactUrl(u: string) { return u.replace(/([?&]token=)[^&]+/, '$1[REDACTED]'); }
