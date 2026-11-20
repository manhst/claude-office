import { spawn, type ChildProcess } from 'node:child_process';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { redactText } from './redact.js';
import type { McpTestResult } from './types.js';

/** Dirs searched after PATH for commands (Claude Deck may run with a GUI app's short PATH). */
export const EXTRA_BIN_DIRS = () => [join(homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'];
const INIT = { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-deck', version: '1.0.0' } };
const obj = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as any) : {});
const str = (v: unknown) => (typeof v === 'string' && v ? redactText(v, 200) : undefined);
const parse = (s: string): any => { try { return JSON.parse(s); } catch { return undefined; } };
/** Claude Code-style `${VAR}` / `${VAR:-default}` expansion; unset without a default stays as written. */
export const expandVars = (s: string, env: NodeJS.ProcessEnv) => s.replace(/\$\{([A-Za-z_]\w*)(?::-([^}]*))?\}/g, (m, k, d) => env[k] ?? d ?? m);
/** What a probe would start or call: the command line (`${VAR}` expanded from `vars`, odd args quoted) or the URL. */
export function commandLine(e0: unknown, vars: NodeJS.ProcessEnv): string {
  const e = obj(e0), type = typeof e.type === 'string' ? e.type : '', x = (s: unknown) => expandVars(typeof s === 'string' ? s : JSON.stringify(s ?? ''), vars);
  if (type === '' || type === 'stdio') return [x(e.command), ...(Array.isArray(e.args) ? e.args : []).map(x)].map((a) => (!a || /[\s"'\\]/.test(a) ? JSON.stringify(a) : a)).join(' ');
  return x(e.url);
}
const MAX_ANSWER = 1 << 20;
const auth = (name: string) => `needs auth (run /mcp or \`claude mcp login ${name}\` in Claude Code)`;
const msgOf = (e: any) => redactText(String(e?.cause && (e.cause.code || e.cause.message) ? `${e.message}: ${e.cause.code ?? e.cause.message}` : e?.message ?? e), 300);
type Done = Omit<McpTestResult, 'ms'>;
/** Client side of a probe: initialize → notifications/initialized → tools/list (≤5 pages). feed() takes one server message. */
class Dialog {
  server?: { name?: string; version?: string }; tools: string[] = []; ready = false; protocol = INIT.protocolVersion; private id = 2;
  start() { return { jsonrpc: '2.0', id: 1, method: 'initialize', params: INIT }; }
  private list(cursor?: string) { return { jsonrpc: '2.0', id: this.id++, method: 'tools/list', params: cursor ? { cursor } : {} }; }
  private end(r: Done): { done: Done } { return { done: { ...r, ...(this.server ? { server: this.server } : {}), ...(this.ready ? { tools: this.tools } : {}) } }; }
  feed(m: any): { send: any[] } | { done: Done } {
    if (typeof m?.method === 'string') return { send: m.id !== undefined ? [{ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'not supported by the claude-deck test' } }] : [] };
    const e = m?.error ? redactText(String(m.error.message ?? JSON.stringify(m.error)), 300) : '';
    if (m?.id === 1) {
      if (e || !m.result) return this.end({ ok: false, error: `initialize failed: ${e || 'no result'}` });
      const si = obj(m.result.serverInfo), name = str(si.name), version = str(si.version);
      if (name || version) this.server = { ...(name ? { name } : {}), ...(version ? { version } : {}) };
      if (typeof m.result.protocolVersion === 'string') this.protocol = m.result.protocolVersion;
      this.ready = true;
      return { send: [{ jsonrpc: '2.0', method: 'notifications/initialized' }, this.list()] };
    }
    if (typeof m?.id === 'number' && m.id >= 2) {
      if (e) return m.error.code === -32601 ? this.end({ ok: true }) : this.end({ ok: false, error: `tools/list failed: ${e}` });
      for (const t of Array.isArray(m.result?.tools) ? m.result.tools : []) if (typeof t?.name === 'string' && this.tools.length < 500) this.tools.push(t.name.slice(0, 200));
      const c = m.result?.nextCursor;
      return typeof c === 'string' && c && this.id < 7 ? { send: [this.list(c)] } : this.end({ ok: true });
    }
    return { send: [] };
  }
}
/** Kills a probe's whole process group (Windows: the process tree). */
function killTree(ch: ChildProcess) {
  if (!ch.pid) return;
  if (process.platform === 'win32') { spawn('taskkill', ['/pid', String(ch.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => {}); return; }
  try { process.kill(-ch.pid, 'SIGTERM'); } catch { /* gone */ }
  setTimeout(() => { try { process.kill(-ch.pid!, 'SIGKILL'); } catch { /* gone */ } }, 1000).unref();
}
type Clean = (s: string) => string;
function stdio(cmd: string, args: string[], env: NodeJS.ProcessEnv, cwd: string, ms: number, t0: number, clean: Clean, signal?: AbortSignal): Promise<McpTestResult> {
  return new Promise((res) => {
    const d = new Dialog(); let out = '', err = '', over = false, ch: ChildProcess;
    const finish = (r: Done) => {
      if (over) return; over = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel);
      if (ch) { killTree(ch); ch.stdin?.destroy(); ch.stdout?.destroy(); ch.stderr?.destroy(); }
      const tail = err.trim() ? redactText(clean(err.slice(-4096)), Infinity).slice(-2048) : '';
      res({ ...r, ms: Date.now() - t0, ...(tail ? { stderr: tail } : {}) });
    };
    const cancel = () => finish({ ok: false, error: 'cancelled' });
    const send = (m: unknown) => { if (!over) ch.stdin?.write(`${JSON.stringify(m)}\n`); };
    const timer = setTimeout(() => finish({ ok: false, error: `no answer within ${ms / 1000} s` }), ms);
    if (signal?.aborted) { cancel(); return; }
    try { ch = spawn(cmd, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true }); } catch (e) { finish({ ok: false, error: msgOf(e) }); return; }
    signal?.addEventListener('abort', cancel, { once: true });
    ch.on('error', (e: any) => finish({ ok: false, error: e?.code === 'ENOENT' ? `command not found: ${redactText(cmd, 200)}` : msgOf(e) }));
    ch.on('exit', (code, sig) => setTimeout(() => finish({ ok: false, error: `the server exited (${sig ?? `code ${code}`}) before answering` }), 50));
    ch.stdin!.on('error', () => {});
    ch.stderr!.setEncoding('utf8').on('data', (s: string) => { if (!over) err = (err + s).slice(-8192); });
    ch.stdout!.setEncoding('utf8').on('data', (s: string) => {
      if (over) return;
      out += s; let i;
      while (!over && (i = out.indexOf('\n')) >= 0) {
        const line = out.slice(0, i).trim(); out = out.slice(i + 1);
        const m = line.startsWith('{') ? parse(line) : undefined; if (!m) continue; // servers may log to stdout
        const f = d.feed(m); if ('done' in f) finish(f.done); else f.send.forEach(send);
      }
      if (!over && out.length > 4 << 20) finish({ ok: false, error: 'the server wrote more than 4 MB without a newline' });
    });
    send(d.start());
  });
}
type SseEvent = { event: string; data: string };
/** Server-sent events of a response body (`event:` + `data:` lines, blank line ends one). Cancels the body when the consumer stops. */
async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const rd = body.getReader(), dec = new TextDecoder(); let buf = '', ev = '', data: string[] = [], size = 0;
  try {
    for (;;) {
      const { value, done } = await rd.read(); if (done) return;
      buf += dec.decode(value, { stream: true });
      for (let i; (i = buf.indexOf('\n')) >= 0;) {
        const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1);
        if (!line) { if (data.length) yield { event: ev || 'message', data: data.join('\n') }; ev = ''; data = []; size = 0; }
        else if (line.startsWith('data:')) { data.push(line.slice(5).replace(/^ /, '')); if ((size += line.length) > MAX_ANSWER) throw new Error('an sse event is larger than 1 MB'); }
        else if (line.startsWith('event:')) ev = line.slice(6).trim();
      }
      if (buf.length > MAX_ANSWER) throw new Error('an sse line is longer than 1 MB');
    }
  } finally { rd.cancel().catch(() => {}); }
}
/** 401/403 → the auth hint; a 3xx (fetch runs with redirect:'manual') → an error naming the target, so headers never follow a redirect. */
const deny = (r: Response, name: string) => {
  if (r.status === 401 || r.status === 403) { r.body?.cancel().catch(() => {}); throw new Error(auth(name)); }
  if (r.status >= 300 && r.status < 400) { r.body?.cancel().catch(() => {}); const to = r.headers.get('location'); throw new Error(`the server redirected (HTTP ${r.status}); use the final URL instead${to ? `: ${redactText(to, 200)}` : ''}`); }
};
/** Response text, at most 1 MB. */
async function textCapped(r: Response): Promise<string> {
  if (!r.body) return '';
  const rd = r.body.getReader(), dec = new TextDecoder(); let s = '', n = 0;
  try { for (;;) { const { value, done } = await rd.read(); if (done) return s + dec.decode(); if ((n += value.byteLength) > MAX_ANSWER) throw new Error('the answer is larger than 1 MB'); s += dec.decode(value, { stream: true }); } }
  finally { rd.cancel().catch(() => {}); }
}
/** Streamable HTTP: POST each JSON-RPC message, answers as JSON or SSE, `mcp-session-id` carried; the session is DELETEd afterwards (best effort). */
async function http(url: string, headers: Record<string, string>, name: string, signal: AbortSignal): Promise<Done> {
  const d = new Dialog(); let sid: string | undefined;
  const post = async (m: any): Promise<any[]> => {
    const r = await fetch(url, { method: 'POST', signal, redirect: 'manual', body: JSON.stringify(m), headers: { ...headers, 'content-type': 'application/json', accept: 'application/json, text/event-stream',
      ...(sid ? { 'mcp-session-id': sid } : {}), ...(d.ready ? { 'mcp-protocol-version': d.protocol } : {}) } });
    deny(r, name); sid = r.headers.get('mcp-session-id') ?? sid;
    if (!r.ok) { r.body?.cancel().catch(() => {}); throw new Error(`HTTP ${r.status}`); }
    if (m.id === undefined || typeof m.method !== 'string') { r.body?.cancel().catch(() => {}); return []; } // notification / our reply: 202
    if ((r.headers.get('content-type') ?? '').includes('text/event-stream')) {
      const got: any[] = [];
      for await (const ev of sseEvents(r.body!)) { const j = parse(ev.data); if (!j) continue; got.push(j); if (j.id === m.id && typeof j.method !== 'string') break; }
      return got;
    }
    const j = parse(await textCapped(r)); if (j === undefined) throw new Error('the server did not answer with JSON');
    return Array.isArray(j) ? j : [j];
  };
  try {
    const q: any[] = [d.start()];
    while (q.length) for (const reply of await post(q.shift())) { const f = d.feed(reply); if ('done' in f) return f.done; q.push(...f.send); }
    throw new Error('the server stopped answering');
  } finally { if (sid) fetch(url, { method: 'DELETE', redirect: 'manual', headers: { ...headers, 'mcp-session-id': sid }, signal: AbortSignal.timeout(2000) }).then((r) => r.body?.cancel()).catch(() => {}); }
}
/** Legacy HTTP+SSE: GET the stream, wait for the `endpoint` event (same origin only), POST messages there, read answers from the stream. */
async function sse(url: string, headers: Record<string, string>, name: string, signal: AbortSignal): Promise<Done> {
  const d = new Dialog(), r = await fetch(url, { headers: { ...headers, accept: 'text/event-stream' }, signal, redirect: 'manual' });
  deny(r, name); if (!r.ok || !r.body) { r.body?.cancel().catch(() => {}); throw new Error(`HTTP ${r.status}`); }
  const it = sseEvents(r.body), next = async () => (await it.next()).value as SseEvent | undefined;
  try {
    let ev; while ((ev = await next()) && ev.event !== 'endpoint');
    if (!ev) throw new Error('no endpoint event on the sse stream');
    const ep = new URL(ev.data.trim(), url); if (ep.origin !== new URL(url).origin) throw new Error('the sse endpoint is on another origin');
    const post = async (m: unknown) => { const p = await fetch(ep, { method: 'POST', signal, redirect: 'manual', body: JSON.stringify(m), headers: { ...headers, 'content-type': 'application/json' } }); deny(p, name); p.body?.cancel().catch(() => {}); if (!p.ok) throw new Error(`HTTP ${p.status}`); };
    await post(d.start());
    while ((ev = await next())) { if (ev.event !== 'message') continue; const j = parse(ev.data); if (!j) continue; const f = d.feed(j); if ('done' in f) return f.done; for (const s of f.send) await post(s); }
    throw new Error('the sse stream ended');
  } finally { await it.return(undefined).catch(() => {}); }
}
/** Starts / calls one MCP server entry and lists its tools: stdio (own process group, killed afterwards), http, sse. command/args/env/url/headers get
 *  `${VAR}` expansion from `vars` (default: env; pass {} for untrusted entries). The entry's own env/header values are scrubbed from errors and the
 *  stderr tail (≤2 KB), which are then redacted. `signal` cancels (the HTTP request went away). */
export async function probeMcp(e0: unknown, o: { name: string; cwd: string; env?: NodeJS.ProcessEnv; vars?: NodeJS.ProcessEnv; timeoutMs?: number; signal?: AbortSignal }): Promise<McpTestResult> {
  const t0 = Date.now(), e = obj(e0), base = o.env ?? process.env, vars = o.vars ?? base, ms = o.timeoutMs ?? 20_000, type = typeof e.type === 'string' ? e.type : '';
  const x = (s: unknown) => expandVars(typeof s === 'string' ? s : JSON.stringify(s ?? ''), vars);
  const own: Record<string, string> = {}; for (const f of ['env', 'headers']) for (const [k, v] of Object.entries(obj(e[f]))) own[`${f}:${k}`] = x(v);
  const secrets = Object.values(own).filter((v) => v.length >= 6).sort((a, b) => b.length - a.length);
  const clean: Clean = (s) => secrets.reduce((t, v) => t.split(v).join('[REDACTED]'), s);
  const out = (r: McpTestResult): McpTestResult => (r.error ? { ...r, error: redactText(clean(r.error), 500) } : r);
  if (type === '' || type === 'stdio') {
    if (typeof e.command !== 'string' || !e.command.trim()) return { ok: false, ms: 0, error: 'stdio server without a command' };
    const env: NodeJS.ProcessEnv = { ...base }; if (process.platform !== 'win32') env.PATH = [base.PATH ?? '', ...EXTRA_BIN_DIRS()].filter(Boolean).join(delimiter);
    for (const k of Object.keys(obj(e.env))) env[k] = own[`env:${k}`];
    return out(await stdio(x(e.command), (Array.isArray(e.args) ? e.args : []).map(x), env, o.cwd, ms, t0, clean, o.signal));
  }
  const streamable = type === 'http' || type === 'streamable-http';
  if (!streamable && type !== 'sse') return { ok: false, ms: 0, error: type === 'ws' ? "testing ws servers isn't supported" : `unknown type "${redactText(type, 40)}"` };
  const headers: Record<string, string> = {}; for (const k of Object.keys(obj(e.headers))) headers[k] = own[`headers:${k}`];
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), ms), signal = o.signal ? AbortSignal.any([ac.signal, o.signal]) : ac.signal;
  try { return out({ ...(await (streamable ? http : sse)(x(e.url), headers, o.name, signal)), ms: Date.now() - t0 }); }
  catch (err: any) { return out({ ok: false, ms: Date.now() - t0, error: o.signal?.aborted ? 'cancelled' : ac.signal.aborted ? `no answer within ${ms / 1000} s` : msgOf(err) }); }
  finally { clearTimeout(timer); ac.abort(); }
}
