import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import WebSocket from 'ws';
import { start, parseArgs, DEMO_NOW } from '../src/cli.js';
import { originOk, tokenOk, eventRequestRejection, inboxGetRejection, promptRequestRejection, historyRequestRejection } from '../src/server.js';
import { simulate } from '../src/simulate.js';
import { turnBody } from '../../mod/deck/hooks/register.js';
describe('security helpers', () => {
  it('origin check allows loopback only', () => {
    expect(originOk(undefined)).toBe(true); expect(originOk('http://127.0.0.1:5173')).toBe(true); expect(originOk('http://localhost:3000')).toBe(true);
    expect(originOk('https://evil.com')).toBe(false); expect(originOk('http://127.0.0.1.evil.com')).toBe(false); expect(originOk('null')).toBe(false);
  });
  it('token compare', () => { expect(tokenOk('abc', 'abc')).toBe(true); expect(tokenOk('abd', 'abc')).toBe(false); expect(tokenOk(null, 'abc')).toBe(false); });
  it('event ingest auth: loopback, no browser headers, JSON only', () => {
    const r = (remoteAddress: string, headers: Record<string, string>) => eventRequestRejection({ socket: { remoteAddress }, headers } as any);
    const json = { 'content-type': 'application/json' };
    expect(r('127.0.0.1', json)).toBe(0); expect(r('::1', json)).toBe(0); expect(r('::ffff:127.0.0.1', json)).toBe(0);
    expect(r('192.168.1.5', json)).toBe(403);
    expect(r('127.0.0.1', { ...json, origin: 'http://127.0.0.1:7777' })).toBe(403);
    expect(r('127.0.0.1', { ...json, origin: 'null' })).toBe(403);
    expect(r('127.0.0.1', { ...json, 'sec-fetch-site': 'cross-site' })).toBe(403); expect(r('127.0.0.1', { ...json, 'sec-fetch-site': 'same-site' })).toBe(403);
    expect(r('127.0.0.1', { ...json, 'sec-fetch-site': 'none', 'sec-fetch-mode': 'cors' })).toBe(0);
    expect(r('127.0.0.1', { 'content-type': 'text/plain' })).toBe(415);
    expect(r('127.0.0.1', {})).toBe(415);
  });
  it('inbox GET rejects browser-like and non-loopback; /prompt requires loopback + originOk + JSON', () => {
    const g = (remoteAddress: string, headers: Record<string, string> = {}) => inboxGetRejection({ socket: { remoteAddress }, headers } as any);
    expect(g('127.0.0.1')).toBe(0); expect(g('192.168.1.5')).toBe(403);
    expect(g('127.0.0.1', { origin: 'http://127.0.0.1:7777' })).toBe(403);
    const p = (remoteAddress: string, headers: Record<string, string>) => promptRequestRejection({ socket: { remoteAddress }, headers, method: 'POST' } as any);
    expect(p('127.0.0.1', { 'content-type': 'application/json' })).toBe(0);
    expect(p('127.0.0.1', { 'content-type': 'application/json', origin: 'http://127.0.0.1:5173' })).toBe(0);
    expect(p('127.0.0.1', { 'content-type': 'application/json', origin: 'https://evil.example' })).toBe(403);
    expect(p('10.0.0.2', { 'content-type': 'application/json' })).toBe(403);
    const h = (remoteAddress: string, headers: Record<string, string> = {}) => historyRequestRejection({ socket: { remoteAddress }, headers } as any);
    expect(h('127.0.0.1')).toBe(0); expect(h('::1', { origin: 'http://localhost:5173' })).toBe(0);
    expect(h('10.0.0.2')).toBe(403); expect(h('127.0.0.1', { origin: 'https://evil.example' })).toBe(403); expect(h('127.0.0.1', { origin: 'null' })).toBe(403);
  });
});
const post = (port: number, body: string, headers: Record<string, string> = { 'content-type': 'application/json' }, method = 'POST') => new Promise<number>((res, rej) => {
  const q = request({ host: '127.0.0.1', port, path: '/event', method, headers }, (r) => { r.resume(); res(r.statusCode!); }); q.on('error', rej); q.end(body);
});
describe('server end to end (demo simulator)', () => {
  it('ingests mod events, broadcasts sessions to authed WS, rejects bad token/origin/requests', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'deck-'));
    const r = await start(parseArgs(['--port', '0', '--log-dir', dir]));
    try {
      const url = `ws://127.0.0.1:${r.port}/ws?token=${r.token}`; const got: any[] = []; const rejected: string[] = [];
      const ws = new WebSocket(url, { origin: 'http://localhost:5173' }); ws.on('message', (m) => got.push(JSON.parse(String(m))));
      new WebSocket(url.replace(r.token, 'nope')).on('error', () => rejected.push('token'));
      new WebSocket(url, { origin: 'https://evil.example' }).on('error', () => rejected.push('origin'));
      await new Promise((res) => ws.once('open', res));
      expect(await post(r.port, '{"type":"start"}', { 'content-type': 'text/plain' })).toBe(415);
      expect(await post(r.port, '{}', { 'content-type': 'application/json', origin: 'https://evil.example' })).toBe(403);
      expect(await post(r.port, '', { origin: 'https://evil.example', 'access-control-request-method': 'POST' }, 'OPTIONS')).toBe(405);
      expect(await post(r.port, 'not json')).toBe(400);
      expect(await post(r.port, '{"type":"nope","sid":"x"}')).toBe(400);
      await simulate(`http://127.0.0.1:${r.port}/event`, { stepMs: 5, loops: 1 });
      await new Promise((res) => setTimeout(res, 100));
      const types = got.map((e) => e.t);
      expect(types[0]).toBe('deck.snapshot');
      for (const t of ['agent.spawned', 'agent.state', 'tool.call', 'tool.result', 'agent.done', 'sessions.update', 'session.turn']) expect(types).toContain(t);
      const last = got.filter((e) => e.t === 'sessions.update').at(-1);
      expect(last.sessions.map((s: any) => `${s.project}:${s.source}`)).toEqual(['shop-api:agents', 'blog:claude-md', 'scratch:default']);
      expect(rejected.sort()).toEqual(['origin', 'token']);
      expect(r.tracker.snapshot()).toMatchObject({ t: 'deck.snapshot' });
      const turns = (r.tracker.snapshot() as any).turns; expect(turns.filter((x: any) => x.status === 'answer').length).toBeGreaterThanOrEqual(4);
      expect(turns.find((x: any) => x.who === 'planner')).toMatchObject({ sid: 'demo-shop-0001', deskId: expect.stringContaining('planner'), answer: expect.stringContaining('\n') });
      expect(readFileSync(r.logPath, 'utf8')).not.toContain(r.token);
      ws.close();
    } finally { await r.close(); }
  }, 15000);
});
describe('turn events end to end (live mode)', () => {
  const connect = (port: number, token: string) => new Promise<{ ws: WebSocket; got: any[] }>((res) => { const got: any[] = []; const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`, { origin: 'http://localhost:5173' }); ws.on('message', (m) => got.push(JSON.parse(String(m)))); ws.once('open', () => res({ ws, got })); });
  it('merges start/progress/end into one redacted turn, keeps newlines, and replays it in a reconnect snapshot', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'deck-'));
    const r = await start(parseArgs(['--port', '0', '--log-dir', dir]));
    try {
      const sid = 'live-turn-1'; const secret = 'sk-abcdefghijklmnop1234';
      const a = await connect(r.port, r.token);
      expect(await post(r.port, JSON.stringify({ type: 'start', sid, cwd: 'C:\proj\demo' }))).toBeLessThan(300);
      const md = ['# Result', '', '- one', '- two', '', '```ts', `  const k = '${secret}';`, '```', ''].join('\n');
      const prompt = 'line one\nline two';
      expect(await post(r.port, turnBody(sid, { id: 't1', phase: 'start', prompt }))).toBeLessThan(300);
      expect(await post(r.port, turnBody(sid, { id: 't1', phase: 'start', prompt, steps: [{ kind: 'text', text: 'Looking\nat it' }, { kind: 'tool', name: 'Read', detail: 'a.ts' }] }))).toBeLessThan(300);
      expect(await post(r.port, turnBody(sid, { id: 't1', phase: 'end', reason: 'answer', answer: md, durationMs: 1234 }))).toBeLessThan(300);
      expect(await post(r.port, turnBody(sid, { id: 't2', phase: 'end', reason: 'answer', answer: 'x'.repeat(20_000) }))).toBeLessThan(300);
      await new Promise((res) => setTimeout(res, 100));
      const turns = a.got.filter((e) => e.t === 'session.turn').map((e) => e.turn);
      expect(turns.filter((t) => t.turnId === 't1').length).toBe(3);
      const snapTurns = (r.tracker.snapshot() as any).turns.filter((t: any) => t.sid === sid);
      expect(snapTurns.map((t: any) => t.turnId)).toEqual(['t1', 't2']);
      const t1 = snapTurns[0];
      expect(t1).toMatchObject({ status: 'answer', prompt, durationMs: 1234 });
      expect(t1.steps).toEqual([{ kind: 'text', text: 'Looking\nat it' }, { kind: 'tool', name: 'Read', detail: 'a.ts' }]);
      expect(t1.answer).toContain('# Result\n\n- one\n- two\n'); expect(t1.answer).toContain('\n  const k = '); expect(t1.answer).not.toContain(secret);
      expect(snapTurns[1].answer.length).toBeLessThanOrEqual(12_020);
      const b = await connect(r.port, r.token); await new Promise((res) => setTimeout(res, 100));
      expect(b.got[0].t).toBe('deck.snapshot');
      const bt = b.got[0].turns.filter((t: any) => t.sid === sid); expect(bt.map((t: any) => t.turnId)).toEqual(['t1', 't2']);
      expect(bt[0].answer).toBe(t1.answer); expect(JSON.stringify(b.got[0])).not.toContain(secret); expect(readFileSync(r.logPath, 'utf8')).not.toContain(secret);
      a.ws.close(); b.ws.close();
    } finally { await r.close(); }
  }, 15000);
});
describe('event body decoding and turn log', () => {
  it('keeps a multibyte char split across two writes; logs a turn at start and end only', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'deck-'));
    const r = await start(parseArgs(['--port', '0', '--log-dir', dir]));
    try {
      const text = 'Xin chào 🎉 Việt Nam';
      const buf = Buffer.from(turnBody('utf8-1', { id: 'u1', phase: 'start', prompt: text }), 'utf8');
      const cut = buf.indexOf(Buffer.from('🎉', 'utf8')) + 2; // inside the 4-byte emoji
      const status = await new Promise<number>((res, rej) => {
        const q = request({ host: '127.0.0.1', port: r.port, path: '/event', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': buf.length } }, (x) => { x.resume(); res(x.statusCode!); });
        q.on('error', rej); q.setNoDelay(true); q.write(buf.subarray(0, cut)); setTimeout(() => q.end(buf.subarray(cut)), 50);
      });
      expect(status).toBe(204);
      expect((r.tracker.snapshot() as any).turns.find((t: any) => t.turnId === 'u1').prompt).toBe(text);
      for (const n of [1, 2, 3]) expect(await post(r.port, turnBody('utf8-1', { id: 'u1', phase: 'start', steps: [{ kind: 'text', text: `step ${n}` }] }))).toBe(204);
      expect(await post(r.port, turnBody('utf8-1', { id: 'u1', phase: 'end', reason: 'answer', answer: 'xong' }))).toBe(204);
      const logged = readFileSync(r.logPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.t === 'session.turn');
      expect(logged.map((e) => e.turn.status)).toEqual(['running', 'answer']); expect(logged[1].turn.steps).toEqual([{ kind: 'text', text: 'step 3' }]);
    } finally { await r.close(); }
  }, 15000);
});
const httpJson = (port: number, path: string, opts: { method?: string; headers?: Record<string, string>; body?: string } = {}) => new Promise<{ status: number; body: string; headers: Record<string, unknown> }>((res, rej) => {
  const q = request({ host: '127.0.0.1', port, path, method: opts.method ?? 'GET', headers: opts.headers ?? {} }, (r) => { let b = ''; r.setEncoding('utf8'); r.on('data', (c) => b += c); r.on('end', () => res({ status: r.statusCode!, body: b, headers: r.headers })); });
  q.on('error', rej); q.end(opts.body);
});
describe('prompt reverse channel', () => {
  it('issues inboxToken on /event, never on WS/logs; /prompt needs run token; /inbox needs inbox token; claim once', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'deck-'));
    const r = await start(parseArgs(['--port', '0', '--log-dir', dir]));
    try {
      const got: any[] = [];
      const ws = new WebSocket(`ws://127.0.0.1:${r.port}/ws?token=${r.token}`, { origin: 'http://localhost:5173' });
      ws.on('message', (m) => got.push(JSON.parse(String(m))));
      await new Promise((res) => ws.once('open', res));
      const sid = 'live-prompt-1';
      const startRes = await httpJson(r.port, '/event', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'start', sid, cwd: dir, canSubmit: true }) });
      expect(startRes.status).toBe(200);
      const inboxToken = JSON.parse(startRes.body).inboxToken;
      expect(inboxToken).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
      await new Promise((res) => setTimeout(res, 50));
      expect(JSON.stringify(got)).not.toContain(inboxToken);
      expect(JSON.stringify(got)).not.toContain('inboxToken');
      expect(readFileSync(r.logPath, 'utf8')).not.toContain(inboxToken);
      expect(readFileSync(r.logPath, 'utf8')).not.toContain(r.token);
      const secret = 'do not leak this prompt text ever';
      expect((await httpJson(r.port, '/prompt', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer nope' }, body: JSON.stringify({ sid, text: secret, nonce: 'nonce-aaaa-bbbb-cccc-01' }) })).status).toBe(401);
      expect((await httpJson(r.port, '/prompt', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example', authorization: `Bearer ${r.token}` }, body: JSON.stringify({ sid, text: secret, nonce: 'nonce-aaaa-bbbb-cccc-01' }) })).status).toBe(403);
      const queued = await httpJson(r.port, '/prompt', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${r.token}` }, body: JSON.stringify({ sid, text: secret, nonce: 'nonce-aaaa-bbbb-cccc-01' }) });
      expect(queued.status).toBe(200);
      expect(JSON.parse(queued.body)).toMatchObject({ ok: true, state: 'queued' });
      expect(queued.body).not.toContain(secret);
      const busy = await httpJson(r.port, '/prompt', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${r.token}` }, body: JSON.stringify({ sid, text: 'other', nonce: 'nonce-aaaa-bbbb-cccc-02' }) });
      expect(busy.status).toBe(409); expect(JSON.parse(busy.body).error).toBe('queued');
      expect((await httpJson(r.port, `/inbox?sid=${sid}`)).status).toBe(401);
      expect((await httpJson(r.port, `/inbox?sid=${sid}`, { headers: { authorization: `Bearer ${r.token}` } })).status).toBe(403);
      expect((await httpJson(r.port, `/inbox?sid=${sid}`, { headers: { authorization: `Bearer ${inboxToken}`, origin: 'http://127.0.0.1:7777' } })).status).toBe(403);
      const claim = await httpJson(r.port, `/inbox?sid=${sid}`, { headers: { authorization: `Bearer ${inboxToken}` } });
      expect(claim.status).toBe(200); expect(JSON.parse(claim.body)).toMatchObject({ text: secret });
      const again = await httpJson(r.port, `/inbox?sid=${sid}`, { headers: { authorization: `Bearer ${inboxToken}` } });
      expect(again.status).toBe(204); // no duplicate after poll
      const ack = await httpJson(r.port, '/inbox/ack', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${inboxToken}` }, body: JSON.stringify({ sid, id: JSON.parse(claim.body).id, state: 'delivered' }) });
      expect(ack.status).toBe(204);
      await new Promise((res) => setTimeout(res, 50));
      const st = got.filter((e) => e.t === 'prompt.status');
      expect(st.map((e) => e.state)).toEqual(expect.arrayContaining(['queued', 'claimed', 'delivered']));
      expect(JSON.stringify(st)).not.toContain(secret);
      expect(st.every((e) => e.t !== 'session.turn')).toBe(true);
      expect((await httpJson(r.port, '/prompt', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${r.token}` }, body: JSON.stringify({ sid: 'nope', text: 'x', nonce: 'nonce-aaaa-bbbb-cccc-03' }) })).status).toBe(404);
      await httpJson(r.port, '/event', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'start', sid: 's-off', cwd: dir, canSubmit: false }) });
      const un = await httpJson(r.port, '/prompt', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${r.token}` }, body: JSON.stringify({ sid: 's-off', text: 'x', nonce: 'nonce-aaaa-bbbb-cccc-04' }) });
      expect(un.status).toBe(409); expect(JSON.parse(un.body).error).toBe('unsupported');
      ws.close();
    } finally { await r.close(); }
  }, 15000);
});
describe('history endpoints', () => {
  it('parses --history-dir / DECK_HISTORY_DIR', () => {
    expect(parseArgs(['--history-dir', 'some/dir']).historyDir).toBe(join(process.cwd(), 'some/dir'));
    expect(parseArgs([]).historyDir).toBe(process.env.DECK_HISTORY_DIR);
  });
  it('GET /history and /history/session: run token (header only), loopback Origin, GET only; redacted JSON', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'deck-')), hist = mkdtempSync(join(tmpdir(), 'deck-hist-')), secret = 'sk-abcdefghijklmnop1234';
    mkdirSync(join(hist, '-w-shop'));
    const line = (type: string, message: unknown, ts: string) => JSON.stringify({ parentUuid: null, isSidechain: false, type, message, uuid: ts, timestamp: ts, entrypoint: 'cli', cwd: '/w/shop', sessionId: 'h-1', version: '2.1.0', gitBranch: 'main' });
    writeFileSync(join(hist, '-w-shop', 'h-1.jsonl'), [line('user', { role: 'user', content: `deploy Lịch sử with ${secret}` }, '2026-11-01T10:00:00.000Z'),
      line('assistant', { model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'thinking', thinking: 'hidden' }, { type: 'text', text: 'Deployed.' }, { type: 'tool_use', id: 't', name: 'Read', input: { file_path: '/w/shop/a.ts' } }] }, '2026-11-01T10:01:00.000Z')].join('\n') + '\n');
    const r = await start(parseArgs(['--port', '0', '--log-dir', dir, '--history-dir', hist]));
    try {
      const auth = { authorization: `Bearer ${r.token}` }, get = (path: string, headers: Record<string, string> = auth, method = 'GET') => httpJson(r.port, path, { headers, method });
      for (const path of ['/history', '/history/session?sid=h-1']) {
        const no = await get(path, {}); expect(no.status).toBe(401); expect(JSON.parse(no.body)).toEqual({ error: 'unauthorized' });
        expect((await get(path, { authorization: 'Bearer nope' })).status).toBe(401);
        expect((await get(`${path}${path.includes('?') ? '&' : '?'}token=${r.token}`, {})).status).toBe(401);
        expect((await get(path, { ...auth, origin: 'https://evil.example' })).status).toBe(403);
        expect((await get(path, auth, 'POST')).status).toBe(405);
      }
      const list = await get('/history?q=lich%20su&limit=5', { ...auth, origin: 'http://127.0.0.1:7777' });
      expect(list.status).toBe(200);
      expect(list.headers).toMatchObject({ 'content-type': 'application/json', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' });
      const body = JSON.parse(list.body);
      expect(body).toMatchObject({ total: 1, offset: 0, autoHidden: 0, sessions: [{ sid: 'h-1', project: '/w/shop', projectName: 'shop', prompts: 1, messages: 2, auto: false, hits: 2 }], projects: [{ project: '/w/shop', projectName: 'shop', sessions: 1 }] });
      expect(body.scannedAt).toBeGreaterThan(0); expect(body.sessions[0].snippet).toContain('Lịch sử');
      expect(JSON.parse((await get('/history?limit=abc&offset=-5')).body)).toMatchObject({ total: 1, offset: 0 });
      expect(JSON.parse((await get('/history?project=%2Fnope')).body)).toMatchObject({ total: 0, projects: [{ project: '/w/shop' }] });
      for (const bad of ['../x', '..%2Fx', '', 'a%20b', 'x'.repeat(65)]) expect((await get(`/history/session?sid=${bad}`)).status).toBe(400);
      expect((await get('/history/session')).status).toBe(400);
      expect((await get('/history/session?sid=unknown-1')).status).toBe(404);
      const d = await get('/history/session?sid=h-1');
      expect(d.status).toBe(200);
      expect(JSON.parse(d.body)).toMatchObject({ session: { sid: 'h-1' }, truncated: false, items: [{ role: 'user' }, { role: 'assistant', text: 'Deployed.' }, { role: 'tool', name: 'Read', detail: 'a.ts' }] });
      for (const b of [list.body, d.body]) { expect(b).not.toContain(secret); expect(b).not.toContain('hidden'); }
      expect(d.body).toContain('[REDACTED]');
    } finally { await r.close(); }
  }, 15000);
  it('POST /history/bookmark: /prompt gates + run token, validation, add → list/detail → re-note keeps at → remove; demo keeps bookmarks in memory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'deck-')), hist = mkdtempSync(join(tmpdir(), 'deck-hist-')), bookmarksPath = join(dir, 'bm', 'history-bookmarks.json');
    mkdirSync(join(hist, '-w-shop'));
    const line = (type: string, message: unknown, ts: string, entrypoint = 'cli') => JSON.stringify({ parentUuid: null, isSidechain: false, type, message, timestamp: ts, entrypoint, cwd: '/w/shop', gitBranch: 'main' });
    writeFileSync(join(hist, '-w-shop', 'h-1.jsonl'), line('user', { role: 'user', content: 'deploy it' }, '2026-11-01T10:00:00.000Z') + '\n');
    writeFileSync(join(hist, '-w-shop', 'h-2.jsonl'), line('user', { role: 'user', content: '/esp-sync' }, '2026-11-02T10:00:00.000Z', 'sdk-cli') + '\n');
    const r = await start({ ...parseArgs(['--port', '0', '--log-dir', dir, '--history-dir', hist]), bookmarksPath });
    try {
      const json = { 'content-type': 'application/json' }, auth = { ...json, authorization: `Bearer ${r.token}` };
      const post = (body: unknown, headers: Record<string, string> = auth, method = 'POST') => httpJson(r.port, '/history/bookmark', { method, headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
      const get = async (path: string) => JSON.parse((await httpJson(r.port, path, { headers: { authorization: `Bearer ${r.token}` } })).body);
      expect((await post({ sid: 'h-1', on: true }, json)).status).toBe(401);
      expect((await post({ sid: 'h-1', on: true }, { ...json, authorization: 'Bearer nope' })).status).toBe(401);
      expect((await post({ sid: 'h-1', on: true }, { ...auth, origin: 'https://evil.example' })).status).toBe(403);
      expect((await post({ sid: 'h-1', on: true }, { ...auth, 'content-type': 'text/plain' })).status).toBe(415);
      expect((await httpJson(r.port, '/history/bookmark', { headers: auth })).status).toBe(405);
      expect((await post('{nope')).status).toBe(400);
      for (const body of [{ sid: '../x', on: true }, { on: true }, { sid: 'h-1', on: 'yes' }, { sid: 'h-1' }, { sid: 'h-1', on: true, note: 5 }]) expect((await post(body)).status).toBe(400);
      expect((await post({ sid: 'h-1', on: true, note: 'x'.repeat(5000) })).status).toBe(413);
      expect((await post({ sid: 'unknown-1', on: true })).status).toBe(404);
      expect(JSON.stringify(await get('/history'))).not.toContain('"bookmark"');
      const add = await post({ sid: 'h-1', on: true, note: ' release\nnotes ' }, { ...auth, origin: 'http://127.0.0.1:7777' });
      expect(add.status).toBe(200); expect(add.headers['content-type']).toBe('application/json');
      const b1 = JSON.parse(add.body); expect(b1).toEqual({ sid: 'h-1', bookmark: { at: expect.any(Number), note: 'release notes' } });
      expect(JSON.parse(readFileSync(bookmarksPath, 'utf8'))).toEqual({ version: 1, bookmarks: { 'h-1': b1.bookmark } });
      if (process.platform !== 'win32') expect(statSync(bookmarksPath).mode & 0o777).toBe(0o600);
      expect(await get('/history')).toMatchObject({ total: 1, bookmarked: 1, sessions: [{ sid: 'h-1', bookmark: b1.bookmark }] });
      expect((await get('/history/session?sid=h-1')).session.bookmark).toEqual(b1.bookmark);
      expect((await post({ sid: 'h-2', on: true })).status).toBe(200); // auto session
      expect(await get('/history')).toMatchObject({ total: 1, autoHidden: 1, bookmarked: 2 });
      expect((await get('/history?bookmarked=1')).sessions.map((s: any) => s.sid)).toEqual(['h-2', 'h-1']);
      const re = JSON.parse((await post({ sid: 'h-1', on: true, note: 'renamed' })).body);
      expect(re).toEqual({ sid: 'h-1', bookmark: { at: b1.bookmark.at, note: 'renamed' } });
      expect(JSON.parse((await post({ sid: 'h-1', on: true })).body).bookmark).toEqual({ at: b1.bookmark.at });
      for (const sid of ['h-1', 'h-1', 'h-2', 'never-seen']) expect(JSON.parse((await post({ sid, on: false })).body)).toEqual({ sid, bookmark: null });
      expect(await get('/history?bookmarked=1')).toMatchObject({ total: 0, bookmarked: 0 });
      expect(JSON.parse(readFileSync(bookmarksPath, 'utf8'))).toEqual({ version: 1, bookmarks: {} });
    } finally { await r.close(); }
    const saved = process.env.DECK_HISTORY_BOOKMARKS; delete process.env.DECK_HISTORY_BOOKMARKS;
    let o; try { o = parseArgs(['--demo', '--port', '0', '--log-dir', dir]); } finally { process.env.DECK_HISTORY_BOOKMARKS = saved; }
    const d = await start(o);
    try { expect(d.bookmarks.path).toBeUndefined(); } finally { await d.close(); }
  }, 15000);
});
describe('model report endpoint', () => {
  it('GET /model-report: /history gate (run token in the header only, loopback Origin, GET only), days validation, redacted report; demo reads the fixtures', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'deck-')), hist = mkdtempSync(join(tmpdir(), 'deck-hist-')), secret = 'sk-abcdefghijklmnop1234', ts = (min: number) => new Date(Date.now() - 3_600_000 + min * 60_000).toISOString();
    mkdirSync(join(hist, '-w-shop'));
    const line = (type: string, message: unknown, t: string) => JSON.stringify({ parentUuid: null, isSidechain: false, type, message, timestamp: t, entrypoint: 'cli', cwd: '/w/shop', sessionId: 'm-1' });
    writeFileSync(join(hist, '-w-shop', 'm-1.jsonl'), [line('user', { role: 'user', content: 'fix it' }, ts(0)),
      line('assistant', { model: 'claude-opus-5-5', id: 'a1', role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: '/w/shop/a.ts' } }] }, ts(1)),
      line('user', { role: 'user', content: [{ tool_use_id: 't1', type: 'tool_result', is_error: true, content: `<tool_use_error>String to replace not found in /w/shop/private/a.ts ${secret}</tool_use_error>` }] }, ts(2))].join('\n') + '\n');
    const r = await start(parseArgs(['--port', '0', '--log-dir', dir, '--history-dir', hist]));
    try {
      const auth = { authorization: `Bearer ${r.token}` }, get = (path: string, headers: Record<string, string> = auth, method = 'GET') => httpJson(r.port, path, { headers, method });
      const no = await get('/model-report', {}); expect(no.status).toBe(401); expect(JSON.parse(no.body)).toEqual({ error: 'unauthorized' });
      expect((await get('/model-report', { authorization: 'Bearer nope' })).status).toBe(401);
      expect((await get(`/model-report?token=${r.token}`, {})).status).toBe(401);
      expect((await get('/model-report', { ...auth, origin: 'https://evil.example' })).status).toBe(403);
      expect((await get('/model-report', { ...auth, origin: 'null' })).status).toBe(403);
      expect((await get('/model-report', auth, 'POST')).status).toBe(405);
      for (const bad of ['abc', '-1', '3651', '1.5', '1e2']) { const x = await get(`/model-report?days=${bad}`); expect(x.status).toBe(400); expect(JSON.parse(x.body).error).toMatch(/days/); }
      const ok = await get('/model-report', { ...auth, origin: 'http://127.0.0.1:7777' });
      expect(ok.status).toBe(200); expect(ok.headers).toMatchObject({ 'content-type': 'application/json', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' });
      const body = JSON.parse(ok.body);
      expect(body).toMatchObject({ days: 30, auto: false, autoSkipped: 0, sessions: 1, totals: { turns: 1, toolCalls: 1, errors: { misuse: 1 } }, modelOrder: ['claude-opus-5-5'],
        models: [{ model: 'claude-opus-5-5', label: 'Opus 5.5', editFails: 1, smallSample: true }], patterns: [{ category: 'misuse', tool: 'Edit', count: 1 }], review: [{ sid: 'm-1', project: '/w/shop', score: 1 }] });
      expect(body.trend).toHaveLength(12); expect(body.patterns[0].pattern).toContain('<path>');
      for (const s of [secret, '/w/shop/private', 'fix it']) expect(ok.body).not.toContain(s);
      expect(JSON.parse((await get('/model-report?days=0&auto=1')).body)).toMatchObject({ days: 0, auto: true, sessions: 1 });
      expect(JSON.parse((await get('/model-report?days=0')).body).trend).toHaveLength(52);
      expect(JSON.parse((await get('/model-report?days=')).body).days).toBe(30);
      expect(body).toMatchObject({ refreshing: false, scannedAt: expect.any(Number) });
      writeFileSync(join(hist, '-w-shop', 'm-2.jsonl'), [line('user', { role: 'user', content: 'again' }, ts(3)), line('assistant', { model: 'claude-opus-5-5', id: 'a2', role: 'assistant', content: [] }, ts(4))].join('\n') + '\n');
      expect(JSON.parse((await get('/model-report')).body).sessions).toBe(1); // cached within the TTL
      const fresh = JSON.parse((await get('/model-report?fresh=1')).body);
      expect(fresh).toMatchObject({ sessions: 2, refreshing: false }); expect(fresh.scannedAt).toBeGreaterThanOrEqual(body.scannedAt);
    } finally { await r.close(); }
    const saved = process.env.DECK_HISTORY_DIR; delete process.env.DECK_HISTORY_DIR;
    let o; try { o = parseArgs(['--demo', '--port', '0', '--log-dir', dir]); } finally { process.env.DECK_HISTORY_DIR = saved; }
    const d = await start(o);
    try {
      const x = JSON.parse((await httpJson(d.port, '/model-report', { headers: { authorization: `Bearer ${d.token}` } })).body);
      expect(x).toMatchObject({ generatedAt: DEMO_NOW, autoSkipped: 1 }); expect(x.sessions).toBeGreaterThan(0); expect(x.models.length).toBeGreaterThan(1);
    } finally { await d.close(); }
  }, 15000);
});
describe('history open endpoints', () => {
  it('GET /history/openers (/history gate) and POST /history/open (/prompt gate, 4 KB): run token in the header only; demo lists nothing and opens nothing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'deck-')), r = await start(parseArgs(['--port', '0', '--log-dir', dir]));
    try {
      const auth = { authorization: `Bearer ${r.token}` }, json = { ...auth, 'content-type': 'application/json' };
      const call = (path: string, headers: Record<string, string>, method = 'GET', body?: string) => httpJson(r.port, path, { headers, method, body });
      expect((await call('/history/openers', {})).status).toBe(401);
      expect((await call(`/history/openers?token=${r.token}`, {})).status).toBe(401);
      expect((await call('/history/openers', { ...auth, origin: 'https://evil.example' })).status).toBe(403);
      expect((await call('/history/openers', json, 'POST', '{}')).status).toBe(405);
      const ok = await call('/history/openers', { ...auth, origin: 'http://127.0.0.1:7777' });
      expect(ok.status).toBe(200); expect(ok.headers['content-type']).toBe('application/json'); expect(Array.isArray(JSON.parse(ok.body).openers)).toBe(true);
      const body = JSON.stringify({ sid: '11111111-2222-4333-8444-555555555555', app: 'iterm' });
      expect((await call('/history/open', { 'content-type': 'application/json' }, 'POST', body)).status).toBe(401);
      expect((await call('/history/open', { ...json, authorization: 'Bearer nope' }, 'POST', body)).status).toBe(401);
      expect((await call('/history/open', { ...json, origin: 'https://evil.example' }, 'POST', body)).status).toBe(403);
      expect((await call('/history/open', { ...auth, 'content-type': 'text/plain' }, 'POST', body)).status).toBe(415);
      expect((await call('/history/open', auth)).status).toBe(405);
      expect((await call('/history/open', json, 'POST', JSON.stringify({ sid: 'x'.repeat(5000) }))).status).toBe(413);
      expect(JSON.parse((await call('/history/open', json, 'POST', '{nope')).body)).toEqual({ error: 'bad json' });
      expect(JSON.parse((await call('/history/open', json, 'POST', JSON.stringify({ sid: '../x', app: 'iterm' }))).body)).toMatchObject({ error: 'bad-sid' });
      const nf = await call('/history/open', { ...json, origin: 'http://localhost:5173' }, 'POST', body);
      if (process.platform === 'darwin' || process.platform === 'win32') { expect(nf.status).toBe(404); expect(JSON.parse(nf.body)).toMatchObject({ error: 'not-found', reason: expect.any(String) }); }
    } finally { await r.close(); }
    const d = await start(parseArgs(['--demo', '--port', '0', '--log-dir', dir]));
    try {
      const auth = { authorization: `Bearer ${d.token}` };
      expect(JSON.parse((await httpJson(d.port, '/history/openers', { headers: auth })).body)).toEqual({ openers: [], reason: expect.any(String) });
      const o = await httpJson(d.port, '/history/open', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ sid: '7f3c2a10-5b6e-4d21-9a8f-0c1d2e3f4a05', app: 'iterm' }) });
      expect(o.status).toBe(409); expect(JSON.parse(o.body)).toMatchObject({ error: 'unavailable' });
    } finally { await d.close(); }
  }, 15000);
});
describe('history delete endpoint', () => {
  it('POST /history/delete: /prompt gate + Bearer (header only), 4 KB; dry run then delete; demo refuses', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'deck-')), cfg = join(mkdtempSync(join(tmpdir(), 'deck-cfg-')), '.claude'), pd = join(cfg, 'projects', '-w-shop'), sid = '7f3c2a10-5b6e-4d21-9a8f-0c1d2e3f4a05';
    mkdirSync(join(pd, sid, 'subagents'), { recursive: true }); mkdirSync(join(cfg, 'file-history', sid), { recursive: true });
    const t = new Date(Date.now() - 3_600_000).toISOString(), f = join(pd, `${sid}.jsonl`);
    writeFileSync(f, [{ type: 'user', message: { role: 'user', content: 'hi' }, timestamp: t, cwd: '/w/shop' }, { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }, timestamp: t }].map((l) => JSON.stringify(l)).join('\n') + '\n');
    for (const p of [f, join(pd, sid, 'subagents'), join(pd, sid)]) utimesSync(p, new Date(t), new Date(t)); // not freshly written (that needs confirm)
    writeFileSync(join(cfg, 'history.jsonl'), `${JSON.stringify({ display: 'a', pastedContents: {}, timestamp: 1, project: '/w', sessionId: sid })}\n${JSON.stringify({ display: 'b', pastedContents: {}, timestamp: 2, project: '/w', sessionId: 'other' })}\n`);
    const savedCfg = process.env.DECK_CLAUDE_CONFIG_DIR; process.env.DECK_CLAUDE_CONFIG_DIR = cfg; // the config dir must be the History root's parent
    let r; try { r = await start(parseArgs(['--port', '0', '--log-dir', dir, '--history-dir', join(cfg, 'projects')])); } finally { process.env.DECK_CLAUDE_CONFIG_DIR = savedCfg; }
    try {
      const auth = { authorization: `Bearer ${r.token}` }, json = { ...auth, 'content-type': 'application/json' }, body = JSON.stringify({ sid, dryRun: true });
      const call = (headers: Record<string, string>, method = 'POST', b?: string) => httpJson(r.port, '/history/delete', { headers, method, body: b });
      expect((await call({ 'content-type': 'application/json' }, 'POST', body)).status).toBe(401);
      expect((await call({ ...json, authorization: 'Bearer nope' }, 'POST', body)).status).toBe(401);
      expect((await httpJson(r.port, `/history/delete?token=${r.token}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body })).status).toBe(401);
      expect((await call({ ...json, origin: 'https://evil.example' }, 'POST', body)).status).toBe(403);
      expect((await call({ ...json, origin: 'null' }, 'POST', body)).status).toBe(403);
      expect((await call({ ...auth, 'content-type': 'text/plain' }, 'POST', body)).status).toBe(415);
      expect((await call(auth, 'GET')).status).toBe(405);
      expect((await call(json, 'POST', JSON.stringify({ sid: 'x'.repeat(5000) }))).status).toBe(413);
      expect(JSON.parse((await call(json, 'POST', '{nope')).body)).toEqual({ error: 'bad json' });
      expect(JSON.parse((await call(json, 'POST', JSON.stringify({ sid: '../x' }))).body)).toMatchObject({ error: 'bad-sid', reason: expect.any(String) });
      const dry = await call({ ...json, origin: 'http://localhost:5173' }, 'POST', body);
      expect(dry.status).toBe(200); const d = JSON.parse(dry.body);
      expect(d).toMatchObject({ sid, dryRun: true, deleted: false, note: expect.stringMatching(/this machine only/) });
      expect(d.items.map((i: any) => i.kind)).toEqual(['transcript', 'dir', 'dir', 'history-lines', 'deck-data']);
      expect(existsSync(f)).toBe(true);
      expect(d.planId).toEqual(expect.any(String));
      const del = await call(json, 'POST', JSON.stringify({ sid, planId: d.planId }));
      expect(del.status).toBe(200); expect(JSON.parse(del.body)).toMatchObject({ deleted: true });
      expect(existsSync(f)).toBe(false); expect(existsSync(join(cfg, 'file-history', sid))).toBe(false);
      expect(readFileSync(join(cfg, 'history.jsonl'), 'utf8')).toBe(`${JSON.stringify({ display: 'b', pastedContents: {}, timestamp: 2, project: '/w', sessionId: 'other' })}\n`);
      expect(JSON.parse((await httpJson(r.port, '/history', { headers: auth })).body).total).toBe(0);
    } finally { await r.close(); }
    const d = await start(parseArgs(['--demo', '--port', '0', '--log-dir', dir]));
    try {
      const o = await httpJson(d.port, '/history/delete', { method: 'POST', headers: { authorization: `Bearer ${d.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ sid: '7f3c2a10-5b6e-4d21-9a8f-0c1d2e3f4a05', dryRun: true }) });
      expect(o.status).toBe(409); expect(JSON.parse(o.body)).toMatchObject({ error: 'unavailable' });
    } finally { await d.close(); }
  }, 15000);
});
describe('claude config endpoints', () => {
  it('GET /claude-config + POST /claude-config/mcp/*: run token (header only), Origin, JSON, size cap; secrets stay masked', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'deck-')), cj = process.env.DECK_CLAUDE_JSON!, secret = 'secret-value-1234567';
    writeFileSync(cj, JSON.stringify({ mcpServers: { a: { type: 'stdio', command: 'node', args: [], env: { API_TOKEN: secret, MODE: 'dev' } } } }));
    const r = await start(parseArgs(['--port', '0', '--log-dir', dir]));
    try {
      const auth = { authorization: `Bearer ${r.token}` }, json = { ...auth, 'content-type': 'application/json' };
      const call = (path: string, body?: string, headers: Record<string, string> = json, method = 'POST') => httpJson(r.port, path, { method, headers, body });
      expect((await call('/claude-config', undefined, {}, 'GET')).status).toBe(401);
      expect((await call(`/claude-config?token=${r.token}`, undefined, {}, 'GET')).status).toBe(401);
      expect((await call('/claude-config', undefined, { ...auth, origin: 'https://evil.example' }, 'GET')).status).toBe(403);
      expect((await call('/claude-config', '{}')).status).toBe(405);
      const v = await call('/claude-config', undefined, { ...auth, origin: 'http://127.0.0.1:7777' }, 'GET');
      expect(v.status).toBe(200); expect(v.headers['content-type']).toBe('application/json'); expect(v.body).not.toContain(secret);
      expect(JSON.parse(v.body)).toMatchObject({ writable: true, cli: { version: '9.9.9' }, servers: [{ name: 'a', scope: 'user', env: [{ key: 'API_TOKEN', masked: true }, { key: 'MODE', value: 'dev' }] }] });
      for (const op of ['save', 'delete', 'reveal', 'test']) {
        const path = `/claude-config/mcp/${op}`;
        expect((await call(path, '{}', { 'content-type': 'application/json' })).status).toBe(401);
        expect((await call(path, '{}', { ...json, authorization: 'Bearer nope' })).status).toBe(401);
        expect((await call(path, '{}', { ...json, origin: 'https://evil.example' })).status).toBe(403);
        expect((await call(path, '{}', { ...auth, 'content-type': 'text/plain' })).status).toBe(415);
        expect((await call(path, undefined, auth, 'GET')).status).toBe(405);
        expect((await call(path, `{"x":"${'y'.repeat(65 * 1024)}"}`)).status).toBe(413);
        const bad = await call(path, '{nope'); expect(bad.status).toBe(400); expect(JSON.parse(bad.body)).toEqual({ error: 'bad json' });
      }
      expect(JSON.parse((await call('/claude-config/mcp/reveal', JSON.stringify({ scope: 'user', name: 'a', field: 'env', key: 'API_TOKEN' }))).body)).toEqual({ value: secret });
      const saved = await call('/claude-config/mcp/save', JSON.stringify({ target: { scope: 'user', name: 'b' }, server: { type: 'http', url: 'https://b.example/mcp' } }));
      expect(saved.status).toBe(200); expect(JSON.parse(saved.body)).toMatchObject({ ok: true, backup: expect.any(String) });
      expect(JSON.parse(readFileSync(cj, 'utf8')).mcpServers.b).toEqual({ type: 'http', url: 'https://b.example/mcp' });
      const bad = await call('/claude-config/mcp/save', JSON.stringify({ target: { scope: 'user', name: 'a/b' }, server: { type: 'http', url: 'https://b' } }));
      expect(bad.status).toBe(400); expect(JSON.parse(bad.body).error).toContain('name');
    } finally { await r.close(); }
  }, 20000);
});
