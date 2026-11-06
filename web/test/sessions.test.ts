import { describe, it, expect, beforeEach } from 'vitest';
import { reduce, initialState } from '../src/reducer';
import { pickSelected, activeSubagents, agoLabel, sessionDumpRows, formatSubagent } from '../src/sessionView';
import { DEFAULT_COLLAPSE, loadCollapse, saveCollapse, setCollapse } from '../src/collapse';
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

describe('sessionDumpRows', () => {
  const now = 1_700_000_060_000;
  it('includes sid/cwd/transcript/all subagents and skips empties', () => {
    const x = sess('demo-1', ['desk-a'], {
      project: 'shop-api',
      cwd: '/work/shop-api',
      title: 'Add discounts',
      transcript: '/tmp/demo-1.jsonl',
      prompt: 'Add discount codes to checkout. '.repeat(8).trim(),
      costUsd: 0.042,
      startedAt: now - 60_000,
      lastSeen: now - 5_000,
      source: 'agents',
      tool: { name: 'Bash', detail: 'npm test', ts: now - 10_000 },
      subagents: [
        { id: 'a1', type: 'planner', name: 'Plan', description: 'Plan discount codes', status: 'completed' },
        { id: 'a2', type: 'coder', description: 'Implement', status: 'running' },
      ],
      profiles: [{ name: 'coder', description: 'x', tools: [], body: '# secret md body that must not appear' }],
    });
    const rows = sessionDumpRows(x, now);
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by.sid.value).toBe('demo-1');
    expect(by.cwd.value).toContain('/work/shop-api');
    expect(by.transcript.value).toContain('demo-1.jsonl');
    expect(by.prompt.value!.length).toBeGreaterThan(160); // full string we have, not re-truncated
    expect(by.tool.value).toMatch(/Bash/);
    expect(by.tool.value).toMatch(/npm test/);
    expect(by.subagents.lines!.length).toBeGreaterThanOrEqual(2);
    expect(by.subagents.lines!.join('\n')).toMatch(/completed/);
    expect(by.subagents.lines!.join('\n')).toMatch(/running/);
    expect(by.subagents.lines!.join('\n')).not.toMatch(/secret md body/);
    expect(by.profiles.value).toMatch(/1 loaded/);
    expect(by.profiles.value).not.toMatch(/secret/);
    expect(by.agentIds.value).toMatch(/desk-a/);
    // empty fields omitted
    const empty = sessionDumpRows(sess('e', [], { title: undefined, transcript: undefined, prompt: undefined, costUsd: undefined, tool: undefined, subagents: [], profiles: [], agentIds: [], startedAt: 0, lastSeen: 0 }), now);
    const keys = empty.map((r) => r.key);
    expect(keys).toContain('sid');
    expect(keys).toContain('project');
    expect(keys).toContain('cwd');
    expect(keys).toContain('state');
    expect(keys).not.toContain('title');
    expect(keys).not.toContain('transcript');
    expect(keys).not.toContain('prompt');
    expect(keys).not.toContain('tool');
    expect(keys).not.toContain('subagents');
    expect(keys).not.toContain('costUsd');
  });
  it('formatSubagent lists non-empty fields', () => {
    const lines = formatSubagent({ id: 'x', type: 'Explore', description: 'find stuff', status: 'running' }, 0);
    expect(lines[0]).toMatch(/Explore/);
    expect(lines.join(' ')).toMatch(/find stuff/);
    expect(lines.join(' ')).toMatch(/running/);
  });
});

describe('collapse prefs', () => {
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
  it('defaults expanded; setCollapse persists', () => {
    expect(loadCollapse()).toEqual(DEFAULT_COLLAPSE);
    expect(DEFAULT_COLLAPSE.session).toBe(false);
    expect(DEFAULT_COLLAPSE.agents).toBe(false);
    setCollapse('agents', true);
    expect(loadCollapse().agents).toBe(true);
    expect(loadCollapse().session).toBe(false);
    saveCollapse({ session: true, responses: true, agents: true });
    expect(loadCollapse()).toEqual({ session: true, responses: true, agents: true });
  });
  it('ignores a legacy events collapse key', () => {
    localStorage.setItem('vp-collapse', JSON.stringify({ session: false, responses: false, events: true }));
    expect(loadCollapse()).toEqual(DEFAULT_COLLAPSE);
    expect(loadCollapse().agents).toBe(false);
  });
});
