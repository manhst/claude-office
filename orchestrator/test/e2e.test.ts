import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { start, parseArgs } from '../src/cli.js';
import { originOk, tokenOk } from '../src/server.js';
import { buildClaudeArgs } from '../src/driver.js';
import { ROLES } from '../src/types.js';
describe('security helpers', () => {
  it('origin check allows loopback only', () => {
    expect(originOk(undefined)).toBe(true); expect(originOk('http://127.0.0.1:5173')).toBe(true); expect(originOk('http://localhost:3000')).toBe(true);
    expect(originOk('https://evil.com')).toBe(false); expect(originOk('http://127.0.0.1.evil.com')).toBe(false); expect(originOk('null')).toBe(false);
  });
  it('token compare', () => { expect(tokenOk('abc', 'abc')).toBe(true); expect(tokenOk('abd', 'abc')).toBe(false); expect(tokenOk(null, 'abc')).toBe(false); });
  it('claude args use role tools and never skip permissions', () => {
    const a = buildClaudeArgs('t', ROLES.reviewer);
    expect(a).toContain('stream-json'); expect(a).toContain('--verbose'); expect(a[a.indexOf('--allowedTools') + 1]).toBe('Read,Grep,Glob');
    expect(a.join(' ')).not.toContain('dangerously');
  });
});
describe('mock run end to end', () => {
  it('broadcasts to authed WS client, rejects bad token/origin, writes JSONL without token', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'office-'));
    const got: any[] = []; let tok = ''; const rejected: string[] = [];
    const r = await start(parseArgs(['--mock', '--port', '0', '--log-dir', dir, 'test task']), (url) => {
      tok = new URL(url).searchParams.get('token')!;
      const ws = new WebSocket(url, { origin: 'http://localhost:5173' }); ws.on('message', (m) => got.push(JSON.parse(String(m))));
      new WebSocket(url.replace(tok, 'nope')).on('error', () => rejected.push('token'));
      new WebSocket(url, { origin: 'https://evil.example' }).on('error', () => rejected.push('origin'));
    });
    expect(r.result).toBe('done');
    const types = got.map((e) => e.t);
    expect(types[0]).toBe('office.snapshot');
    for (const t of ['agent.spawned', 'agent.state', 'agent.text', 'tool.call', 'tool.result', 'agent.done']) expect(types).toContain(t);
    expect(got.at(-1).t).toBe('agent.done');
    expect(rejected.sort()).toEqual(['origin', 'token']);
    const log = readFileSync(r.logPath, 'utf8');
    expect(log.trim().split('\n').length).toBeGreaterThan(10); expect(log).not.toContain(tok);
  }, 15000);
});
