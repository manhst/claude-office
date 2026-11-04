import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Orchestrator } from '../src/orchestrator.js';
import { MockDriver } from '../src/driver.js';
import { OfficeServer } from '../src/server.js';
import { mapHook } from '../src/hooks.js';
import type { OfficeEvent } from '../src/types.js';
const office = (r: string, t: number) => resolve(__dirname, `../fixtures/office/${r}.${t}.jsonl`);
async function runWith(fx: (r: string, t: number) => string, opts = {}) {
  const o = new Orchestrator(new MockDriver(fx, 1), { quietMs: 5, ...opts }); const ev: OfficeEvent[] = []; o.on((e) => ev.push(e));
  const result = await o.run('plan', 'researcher'); return { result, ev };
}
const line = (o: object) => JSON.stringify(o);
const textTurn = (text: string, result = 'ok') => [line({ type: 'assistant', message: { content: [{ type: 'text', text }] } }), line({ type: 'result', subtype: 'success', is_error: false, result, duration_ms: 1 })].join('\n');
describe('orchestrator routing (mock office)', () => {
  it('delivers ask → coder → reviewer and replies flow back in order', async () => {
    const { result, ev } = await runWith(office);
    expect(result).toBe('done');
    const msgs = ev.filter((e) => e.t === 'agent.message') as any[];
    expect(msgs.map((m) => `${m.kind}:${m.from.split('-')[0]}>${m.to.split('-')[0]}:${m.hops}`)).toEqual([
      'ask:researcher>coder:1', 'ask:coder>reviewer:2', 'reply:reviewer>coder:2', 'reply:coder>researcher:1']);
    expect(ev.some((e) => e.t === 'office.notice' && /loop/.test(e.text))).toBe(true); // reviewer tried to ask researcher back
    const done = ev.filter((e) => e.t === 'agent.done').map((e: any) => e.id.split('-')[0]);
    expect(done.at(-1)).toBe('researcher');
    expect(ev.filter((e) => e.t === 'agent.spawned')).toHaveLength(3);
    // researcher is not marked done while waiting for coder
    const firstReply = ev.findIndex((e: any) => e.t === 'agent.message' && e.kind === 'reply' && e.to.startsWith('researcher'));
    expect(ev.slice(0, firstReply).some((e: any) => e.t === 'agent.done' && e.id.startsWith('researcher'))).toBe(false);
  });
  it('unknown role → notice, asker continues, no message', async () => {
    const d = mkdtempSync(join(tmpdir(), 'fx-'));
    writeFileSync(join(d, 'researcher.1.jsonl'), textTurn('hmm\n@@ASK ceo: approve?'));
    const { result, ev } = await runWith((r, t) => join(d, `${r}.${t}.jsonl`));
    expect(result).toBe('done');
    expect(ev.some((e) => e.t === 'agent.message')).toBe(false);
    expect(ev.find((e) => e.t === 'office.notice')).toMatchObject({ text: expect.stringContaining('unknown_role') });
  });
  it('hop limit stops a long chain', async () => {
    const d = mkdtempSync(join(tmpdir(), 'fx-'));
    const roles = { a: 'b', b: 'c', c: 'd', d: 'e' } as Record<string, string>;
    for (const [r, next] of Object.entries(roles)) writeFileSync(join(d, `${r}.1.jsonl`), textTurn(`@@ASK ${next}: go`, `${r} answer`));
    const mk = (r: string) => ({ role: r, name: r.toUpperCase(), tools: ['Read'], systemPrompt: '' });
    const o = new Orchestrator(new MockDriver((r, t) => join(d, `${r}.${t}.jsonl`), 1), { quietMs: 5 }, Object.fromEntries(['a', 'b', 'c', 'd', 'e'].map((r) => [r, mk(r)])));
    const ev: OfficeEvent[] = []; o.on((e) => ev.push(e));
    expect(await o.run('go', 'a')).toBe('done');
    const asks = ev.filter((e: any) => e.t === 'agent.message' && e.kind === 'ask') as any[];
    expect(asks.map((m) => m.hops)).toEqual([1, 2, 3]);
    expect(ev.some((e) => e.t === 'office.notice' && /hop_limit/.test(e.text))).toBe(true);
    expect(ev.some((e: any) => e.t === 'agent.spawned' && e.role === 'e')).toBe(false);
  });
  it('message budget caps ping-pong', async () => {
    const d = mkdtempSync(join(tmpdir(), 'fx-'));
    for (let t = 1; t <= 8; t++) writeFileSync(join(d, `researcher.${t}.jsonl`), textTurn(`@@ASK coder: q${t}`));
    const { result, ev } = await runWith((r, t) => join(d, `${r}.${t}.jsonl`), { maxMessages: 4 });
    expect(result).toBe('done');
    expect(ev.filter((e) => e.t === 'agent.message')).toHaveLength(4);
    expect(ev.some((e) => e.t === 'office.notice' && /budget/.test(e.text))).toBe(true);
  });
});
describe('hook endpoint', () => {
  it('maps hook payloads', () => {
    expect(mapHook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'echo $X', env: 'S' }, tool_use_id: 't1' }, 'x', 1).event)
      .toMatchObject({ t: 'tool.call', tool: 'Bash', callId: 't1', inputSummary: expect.stringContaining('[REDACTED]') });
    expect(mapHook({ hook_event_name: 'PostToolUse', tool_response: { error: 'nope' } }, 'x').event).toMatchObject({ t: 'tool.result', ok: false });
    expect(mapHook({ hook_event_name: 'Stop' }, 'x').input).toBe('result');
    expect(mapHook({ hook_event_name: 'Notification' }, 'x')).toEqual({});
  });
  it('requires token, JSON, loopback origin', async () => {
    const o = new Orchestrator(new MockDriver(office, 1)); const ev: OfficeEvent[] = []; o.on((e) => ev.push(e));
    const s = new OfficeServer('T0k3n-abcdefghijkl', () => o.snapshot(), { onHook: (p) => o.ingestHook(p) });
    const port = await s.listen(0); const url = `http://127.0.0.1:${port}/hook`;
    const body = JSON.stringify({ hook_event_name: 'PreToolUse', session_id: 'abc12345-x', tool_name: 'Read', tool_input: { file_path: 'a' } });
    const post = (h: Record<string, string>, b = body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: b }).then((r) => r.status);
    expect(await post({})).toBe(403);
    expect(await post({ 'x-office-token': 'wrong' })).toBe(403);
    expect(await post({ 'x-office-token': 'T0k3n-abcdefghijkl', origin: 'https://evil.example' })).toBe(403);
    expect(await post({ 'x-office-token': 'T0k3n-abcdefghijkl' }, '{bad')).toBe(400);
    expect(await post({ 'x-office-token': 'T0k3n-abcdefghijkl' })).toBe(204);
    expect(ev.map((e) => e.t)).toEqual(['agent.spawned', 'agent.state', 'agent.state', 'tool.call']);
    expect((ev[0] as any).id).toBe('session-abc12345');
    await s.close();
  });
});
