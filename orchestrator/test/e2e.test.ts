import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import WebSocket from 'ws';
import { start, parseArgs } from '../src/cli.js';
import { originOk, tokenOk, eventRequestRejection } from '../src/server.js';
import { simulate } from '../src/simulate.js';
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
    expect(r('127.0.0.1', { ...json, 'sec-fetch-site': 'cross-site' })).toBe(403);
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
      for (const t of ['agent.spawned', 'agent.state', 'tool.call', 'tool.result', 'agent.done', 'sessions.update']) expect(types).toContain(t);
      const last = got.filter((e) => e.t === 'sessions.update').at(-1);
      expect(last.sessions.map((s: any) => `${s.project}:${s.source}`)).toEqual(['shop-api:agents', 'blog:claude-md', 'scratch:default']);
      expect(rejected.sort()).toEqual(['origin', 'token']);
      expect(r.tracker.snapshot()).toMatchObject({ t: 'office.snapshot' });
      expect(readFileSync(r.logPath, 'utf8')).not.toContain(r.token);
      ws.close();
    } finally { await r.close(); }
  }, 15000);
});
