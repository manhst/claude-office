import { describe, it, expect } from 'vitest';
import { transition, AgentStateMachine } from '../src/state.js';
describe('agent state machine', () => {
  it('follows the happy path', () => {
    const seen: string[] = [];
    const sm = new AgentStateMachine((s) => seen.push(s));
    for (const i of ['task', 'text', 'quiet', 'tool_use', 'tool_result', 'text', 'result'] as const) sm.feed(i);
    expect(seen).toEqual(['thinking', 'talking', 'thinking', 'working', 'thinking', 'talking', 'done']);
  });
  it('idle only leaves on task (or terminal)', () => {
    expect(transition('idle', 'tool_use')).toBe('idle'); expect(transition('idle', 'task')).toBe('thinking'); expect(transition('idle', 'fail')).toBe('error');
  });
  it('talking → working on tool_use; ask/reply cycle', () => {
    expect(transition('talking', 'tool_use')).toBe('working');
    expect(transition('thinking', 'ask')).toBe('talking'); expect(transition('talking', 'reply')).toBe('thinking');
  });
  it('any non-terminal → done/error; terminal states are sticky', () => {
    for (const s of ['idle', 'thinking', 'working', 'talking'] as const) { expect(transition(s, 'result')).toBe('done'); expect(transition(s, 'fail')).toBe('error'); }
    expect(transition('done', 'task')).toBe('done'); expect(transition('error', 'result')).toBe('error');
  });
  it('does not emit on no-op transitions', () => {
    let n = 0; const sm = new AgentStateMachine(() => n++);
    sm.feed('task'); sm.feed('tool_result'); sm.feed('quiet'); expect(n).toBe(1);
  });
});
