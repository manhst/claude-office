import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import WebSocket from 'ws';
import { start, parseArgs } from '../src/cli.js';
import { originOk, tokenOk, eventRequestRejection } from '../src/server.js';
import { simulate } from '../src/simulate.js';
import { turnBody } from '../../mod/office/hooks/register.js';
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
});
const post = (port: number, body: string, headers: Record<string, string> = { 'content-type': 'application/json' }, method = 'POST') => new Promise<number>((res, rej) => {
  const q = request({ host: '127.0.0.1', port, path: '/event', method, headers }, (r) => { r.resume(); res(r.statusCode!); }); q.on('error', rej); q.end(body);
});
describe('server end to end (demo simulator)', () => {
  it('ingests mod events, broadcasts sessions to authed WS, rejects bad token/origin/requests', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'office-'));
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
      expect(types[0]).toBe('office.snapshot');
      for (const t of ['agent.spawned', 'agent.state', 'tool.call', 'tool.result', 'agent.done', 'sessions.update', 'session.turn']) expect(types).toContain(t);
      const last = got.filter((e) => e.t === 'sessions.update').at(-1);
      expect(last.sessions.map((s: any) => `${s.project}:${s.source}`)).toEqual(['shop-api:agents', 'blog:claude-md', 'scratch:default']);
      expect(rejected.sort()).toEqual(['origin', 'token']);
      expect(r.tracker.snapshot()).toMatchObject({ t: 'office.snapshot' });
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
    const dir = mkdtempSync(join(tmpdir(), 'office-'));
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
      expect(b.got[0].t).toBe('office.snapshot');
      const bt = b.got[0].turns.filter((t: any) => t.sid === sid); expect(bt.map((t: any) => t.turnId)).toEqual(['t1', 't2']);
      expect(bt[0].answer).toBe(t1.answer); expect(JSON.stringify(b.got[0])).not.toContain(secret); expect(readFileSync(r.logPath, 'utf8')).not.toContain(secret);
      a.ws.close(); b.ws.close();
    } finally { await r.close(); }
  }, 15000);
});
describe('event body decoding and turn log', () => {
  it('keeps a multibyte char split across two writes; logs a turn at start and end only', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'office-'));
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
