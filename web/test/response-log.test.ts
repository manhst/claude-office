import { describe, it, expect, beforeEach } from 'vitest';
import { RESPONSE_DISPLAY_MAX, clipResponse, describeResponse, listResponses, pickResponseEvents } from '../src/listResponses';
import { DEFAULT_COLLAPSE, loadCollapse, setCollapse } from '../src/collapse';
import type { OfficeEvent } from '../src/types';

const nameOf = (id: string) => (id === 'a1' ? 'Alice' : id);

describe('responseLog', () => {
  it('picks text/done/error/tool.result with body; skips empty tool summaries and noise', () => {
    const log: OfficeEvent[] = [
      { t: 'agent.state', id: 'a1', state: 'thinking', ts: 1 },
      { t: 'agent.text', id: 'a1', text: 'Here is the plan…', ts: 2 },
      { t: 'tool.call', id: 'a1', callId: 'c1', tool: 'Bash', inputSummary: 'npm test', ts: 3 },
      { t: 'tool.result', id: 'a1', callId: 'c1', ok: true, summary: '', ts: 4 },
      { t: 'tool.result', id: 'a1', callId: 'c2', ok: true, summary: '3 passed', ts: 5 },
      { t: 'agent.done', id: 'a1', result: 'Add discount codes to checkout', costUsd: 0.02, durationMs: 10, ts: 6 },
      { t: 'agent.error', id: 'a1', error: 'boom', ts: 7 },
      { t: 'agent.spawned', id: 'a1', role: 'coder', name: 'Alice', desk: { x: 0, y: 0 }, tools: [], ts: 0 },
    ];
    const picked = pickResponseEvents(log);
    expect(picked.map((e) => e.t)).toEqual(['agent.text', 'tool.result', 'agent.done', 'agent.error']);
    const items = listResponses(log, nameOf);
    expect(items[0].kind).toBe('error'); // newest first
    expect(items.map((i) => i.kind)).toEqual(['error', 'done', 'tool', 'text']);
    expect(items.find((i) => i.kind === 'text')!.body).toMatch(/^Alice:/);
    expect(items.find((i) => i.kind === 'done')!.body).toMatch(/discount/);
    expect(items.find((i) => i.kind === 'tool')!.body).toMatch(/3 passed/);
    expect(describeResponse(log[1], nameOf)?.body).toMatch(/plan/);
  });

  it('clipResponse raises readable limit without dumping unbounded text', () => {
    expect(clipResponse('short')).toBe('short');
    const long = 'x'.repeat(RESPONSE_DISPLAY_MAX + 50);
    const out = clipResponse(long);
    expect(out.length).toBeLessThan(long.length);
    expect(out).toMatch(/\(\+50\)/);
    expect(RESPONSE_DISPLAY_MAX).toBeGreaterThanOrEqual(1000);
  });

  it('does not invent profile markdown as a response', () => {
    const log: OfficeEvent[] = [
      { t: 'agent.text', id: 'a1', text: 'ok', ts: 1 },
    ];
    const joined = listResponses(log, nameOf).map((i) => i.body).join('\n');
    expect(joined).not.toMatch(/# Agent/);
    expect(joined).not.toMatch(/CLAUDE\.md/);
  });
});

describe('collapse prefs include responses', () => {
  const mem = new Map<string, string>();
  beforeEach(() => {
    mem.clear();
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (k: string) => mem.get(k) ?? null,
        setItem: (k: string, v: string) => { mem.set(k, v); },
        removeItem: (k: string) => { mem.delete(k); },
      },
      configurable: true,
    });
  });
  it('defaults responses expanded; persists toggle', () => {
    expect(DEFAULT_COLLAPSE.responses).toBe(false);
    expect(loadCollapse().responses).toBe(false);
    setCollapse('responses', true);
    expect(loadCollapse().responses).toBe(true);
    expect(loadCollapse().events).toBe(false);
  });
});
