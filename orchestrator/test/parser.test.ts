import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { StreamParser } from '../src/parser.js';
const fixture = readFileSync(new URL('../fixtures/researcher.stream.jsonl', import.meta.url), 'utf8').split('\n');
const p = () => new StreamParser('a1', () => 42);
describe('StreamParser', () => {
  it('maps system/init to init info with session id', () => {
    const r = p().parseLine(fixture[0]);
    expect(r.init?.model).toBe('claude-sonnet-4-5'); expect(r.sessionId).toMatch(/^5f0c/); expect(r.events).toEqual([]);
  });
  it('maps assistant text → agent.text', () => {
    expect(p().parseLine(fixture[1])).toMatchObject({ events: [{ t: 'agent.text', id: 'a1', text: expect.stringContaining('Mods API'), ts: 42 }], inputs: ['text'] });
  });
  it('maps tool_use → tool.call and tool_result → tool.result (ok and error)', () => {
    const r = p();
    expect(r.parseLine(fixture[2]).events[0]).toMatchObject({ t: 'tool.call', callId: 'toolu_01WS', tool: 'WebSearch' });
    expect(r.parseLine(fixture[3]).events[0]).toMatchObject({ t: 'tool.result', callId: 'toolu_01WS', ok: true });
    expect(r.parseLine(fixture[5]).events[0]).toMatchObject({ t: 'tool.result', ok: true, summary: expect.stringContaining('$.agent.spawn') });
    expect(r.parseLine(fixture[7]).events[0]).toMatchObject({ t: 'tool.result', callId: 'toolu_01RD', ok: false });
  });
  it('maps result success → agent.done with cost', () => {
    expect(p().parseLine(fixture[9]).events[0]).toMatchObject({ t: 'agent.done', costUsd: 0.0421, durationMs: 14250 });
  });
  it('maps result error → agent.error', () => {
    const r = p().parseLine(JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true }));
    expect(r.events[0]).toMatchObject({ t: 'agent.error', error: 'error_max_turns' }); expect(r.inputs).toEqual(['fail']);
  });
  it('ignores blank, non-JSON and unknown lines', () => {
    const r = p();
    for (const l of ['', '   ', 'not json {', '{"type":"stream_event"}']) expect(r.parseLine(l).events).toEqual([]);
  });
  it('redacts secrets in tool inputs and text', () => {
    const line = JSON.stringify({ type: 'assistant', message: { content: [
      { type: 'tool_use', id: 't', name: 'Bash', input: { command: 'curl -H "Authorization: Bearer abcdefghijklmnop" x', env: { A: 1 }, api_key: 'zzz' } },
      { type: 'text', text: 'my key is sk-ant-0123456789abcdef and GITHUB_TOKEN=ghp_xxx' } ] } });
    const [call, text] = p().parseLine(line).events as any[];
    const s = JSON.stringify(call) + text.text;
    expect(s).not.toContain('abcdefghijklmnop'); expect(s).not.toContain('zzz'); expect(s).not.toContain('sk-ant-0123'); expect(s).not.toContain('ghp_xxx');
    expect(s).toContain('[REDACTED]');
  });
  it('caps long text', () => {
    const r = p().parseLine(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'x'.repeat(5000) }] } }));
    expect((r.events[0] as any).text.length).toBeLessThan(2100);
  });
});
