import { describe, it, expect } from 'vitest';
import { reduce, initialState } from '../src/reducer';
import { pickSelected, activeSubagents, agoLabel } from '../src/sessionView';
import type { OfficeEvent, SessionView } from '../src/types';
const sess = (sid: string, agentIds: string[] = [], extra: Partial<SessionView> = {}): SessionView => ({ sid, project: sid, cwd: '/p', state: 'idle', subagents: [], startedAt: 0, lastSeen: 0, source: 'default', profiles: [], agentIds, ...extra });
const ev = (s = initialState(), ...es: OfficeEvent[]) => es.reduce((x, e) => reduce(x, { type: 'event', e }), s);
describe('reducer: sessions', () => {
  it('stores sessions from sessions.update without logging them', () => {
    const s = ev(undefined, { t: 'sessions.update', sessions: [sess('a'), sess('b')], ts: 1 });
    expect(s.sessions.map((x) => x.sid)).toEqual(['a', 'b']); expect(s.log).toHaveLength(0);
  });
  it('snapshot carries sessions and tags agents with their session', () => {
    const s = ev(undefined, { t: 'office.snapshot', agents: [{ id: 'x', role: 'coder', name: 'coder', state: 'working', desk: { x: 0, y: 0 } }], sessions: [sess('a', ['x'])], ts: 1 });
    expect(s.agents.x.sessionId).toBe('a'); expect(s.sessions).toHaveLength(1);
  });
  it('agent.left removes the desk; unknown ids ignored', () => {
    let s = ev(undefined, { t: 'agent.spawned', id: 'x', role: 'r', name: 'n', desk: { x: 0, y: 0 }, tools: [], sessionId: 'a', ts: 1 });
    expect(s.agents.x.sessionId).toBe('a');
    s = ev(s, { t: 'agent.left', id: 'x', ts: 2 });
    expect(s.order).toEqual([]); expect(s.agents.x).toBeUndefined();
    expect(ev(s, { t: 'agent.left', id: 'nope', ts: 3 }).order).toEqual([]);
  });
});
describe('session panel helpers', () => {
  it('keeps selection valid', () => {
    expect(pickSelected([sess('a'), sess('b')], 'b')).toBe('b');
    expect(pickSelected([sess('a')], 'gone')).toBe('a');
    expect(pickSelected([], 'a')).toBeUndefined();
  });
  it('filters active subagents and formats age', () => {
    expect(activeSubagents(sess('a', [], { subagents: [{ status: 'running' }, { status: 'completed' }, { status: 'waiting' }] }))).toHaveLength(2);
    expect(agoLabel(0, 5000)).toBe('5s ago'); expect(agoLabel(0, 180_000)).toBe('3m ago');
  });
});
