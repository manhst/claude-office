import { createServer, type IncomingMessage, type Server } from 'node:http';
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
export class OfficeServer {
  private http: Server; private wss: WebSocketServer;
  port = 0;
  constructor(private token: string, private snapshot: () => OfficeEvent) {
    this.http = createServer((req, res) => {
      if (req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}'); return; }
      res.writeHead(404).end();
    });
    this.wss = new WebSocketServer({ noServer: true });
    this.http.on('upgrade', (req: IncomingMessage, socket, head) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/ws' || !originOk(req.headers.origin) || !tokenOk(url.searchParams.get('token'), this.token)) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => { ws.send(JSON.stringify(this.snapshot())); });
    });
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
