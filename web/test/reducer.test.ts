import { describe, it, expect } from 'vitest';
import { reduce, initialState, MAX_LOG, BUBBLE_MAX, type OfficeState } from '../src/reducer';
import { backoffMs } from '../src/connection';
import type { OfficeEvent } from '../src/types';
const ev = (s: OfficeState, ...es: OfficeEvent[]) => es.reduce((st, e) => reduce(st, { type: 'event', e }), s);
const spawned = (id: string, role = 'coder', x = 0): OfficeEvent => ({ t: 'agent.spawned', id, role, name: role, desk: { x, y: 0 }, tools: ['Read'], ts: 1 });
describe('reducer', () => {
  it('is pure (does not mutate input)', () => {
    const s0 = initialState(); const frozen = JSON.stringify(s0);
    const s1 = ev(s0, spawned('a')); expect(JSON.stringify(s0)).toBe(frozen); expect(s1).not.toBe(s0);
  });
  it('spawn → state → text bubble (truncated) → tool chip → result → done', () => {
    let s = ev(initialState(), spawned('a'), { t: 'agent.state', id: 'a', state: 'thinking', ts: 2 });
    expect(s.agents.a.state).toBe('thinking'); expect(s.order).toEqual(['a']);
    s = ev(s, { t: 'agent.text', id: 'a', text: 'x'.repeat(500), ts: 3 });
    expect(s.agents.a.text!.length).toBe(BUBBLE_MAX); expect(s.agents.a.text!.endsWith('…')).toBe(true);
    s = ev(s, { t: 'tool.call', id: 'a', callId: 'c1', tool: 'Read', inputSummary: '{}', ts: 4 });
    expect(s.agents.a.tool).toMatchObject({ name: 'Read', callId: 'c1' }); expect(s.agents.a.tool!.ok).toBeUndefined();
    s = ev(s, { t: 'tool.result', id: 'a', callId: 'stale', ok: false, summary: '', ts: 5 });
    expect(s.agents.a.tool!.ok).toBeUndefined(); // mismatched callId ignored
    s = ev(s, { t: 'tool.result', id: 'a', callId: 'c1', ok: true, summary: '', ts: 5 });
    expect(s.agents.a.tool!.ok).toBe(true);
    s = ev(s, { t: 'agent.done', id: 'a', result: 'fin', costUsd: 0.01, durationMs: 1, ts: 6 });
    expect(s.agents.a).toMatchObject({ state: 'done', result: 'fin', costUsd: 0.01 }); expect(s.agents.a.tool).toBeUndefined();
  });
  it('error state', () => {
    const s = ev(initialState(), spawned('a'), { t: 'agent.error', id: 'a', error: 'exit 1', ts: 2 });
    expect(s.agents.a).toMatchObject({ state: 'error', error: 'exit 1' });
  });
  it('records messages and notices', () => {
    const s = ev(initialState(), spawned('a'), spawned('b', 'reviewer', 1),
      { t: 'agent.message', from: 'a', to: 'b', text: 'safe?', kind: 'ask', ts: 3 }, { t: 'agent.message', from: 'b', to: 'a', text: 'yes', ts: 4 },
      { t: 'office.notice', level: 'warn', text: 'ASK ceo rejected: unknown_role', ts: 5 });
    expect(s.messages).toEqual([{ from: 'a', to: 'b', text: 'safe?', kind: 'ask', ts: 3 }, { from: 'b', to: 'a', text: 'yes', kind: 'ask', ts: 4 }]);
    expect(s.notices).toHaveLength(1);
  });
  it('snapshot replaces the roster but keeps bubbles for known agents (reconnect)', () => {
    let s = ev(initialState(), spawned('a'), spawned('gone', 'reviewer'), { t: 'agent.text', id: 'a', text: 'hi', ts: 2 });
    s = ev(s, { t: 'office.snapshot', agents: [{ id: 'a', role: 'coder', name: 'Coder', state: 'working', desk: { x: 0, y: 0 } }, { id: 'n', role: 'researcher', name: 'R', state: 'idle', desk: { x: 1, y: 0 } }], ts: 9 });
    expect(s.order).toEqual(['a', 'n']); expect(s.agents.gone).toBeUndefined();
    expect(s.agents.a).toMatchObject({ state: 'working', text: 'hi', tools: ['Read'] }); expect(s.agents.n.tools).toEqual([]);
  });
  it('ignores events for unknown agents and malformed input; caps the log', () => {
    let s = ev(initialState(), { t: 'agent.state', id: 'nope', state: 'done', ts: 1 });
    expect(s.agents).toEqual({});
    expect(reduce(s, { type: 'event', e: null as any })).toBe(s);
    s = ev(s, spawned('a'));
    for (let i = 0; i < MAX_LOG + 50; i++) s = ev(s, { t: 'agent.state', id: 'a', state: i % 2 ? 'working' : 'thinking', ts: i });
    expect(s.log).toHaveLength(MAX_LOG);
  });
  it('connection status', () => {
    let s = reduce(initialState(), { type: 'conn', status: 'reconnecting', retries: 3 });
    expect(s).toMatchObject({ conn: 'reconnecting', retries: 3 });
    s = reduce(s, { type: 'conn', status: 'open' }); expect(s.retries).toBe(0);
  });
});
describe('backoff', () => {
  it('grows exponentially with jitter, capped at 10s', () => {
    expect(backoffMs(0, () => 0.5)).toBe(500); expect(backoffMs(3, () => 0.5)).toBe(4000);
    expect(backoffMs(20, () => 0.5)).toBe(10000); expect(backoffMs(20, () => 1)).toBe(12500); expect(backoffMs(0, () => 0)).toBe(375);
  });
});
