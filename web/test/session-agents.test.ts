import { describe, it, expect } from 'vitest';
import { reduce, initialState, type OfficeState } from '../src/reducer';
import { AGENT_STATE_LABEL, TASK_UNAVAILABLE, countAgents, matchesDesk, sessionAgentTree, subagentStatus } from '../src/sessionAgents';
import type { OfficeEvent, SessionView, TurnView } from '../src/types';

const sess = (sid: string, agentIds: string[] = [], extra: Partial<SessionView> = {}): SessionView => ({
  sid, project: sid, cwd: '/p', state: 'idle', subagents: [], startedAt: 0, lastSeen: 0, source: 'default', profiles: [], agentIds, ...extra,
});
const ev = (s: OfficeState | undefined, ...es: OfficeEvent[]) => es.reduce((x, e) => reduce(x, { type: 'event', e }), s ?? initialState());
const spawn = (id: string, name: string, sid: string, ts = 1): OfficeEvent => ({ t: 'agent.spawned', id, role: name, name, desk: { x: 0, y: 0 }, tools: [], sessionId: sid, ts });

describe('subagentStatus', () => {
  it('maps known payload statuses without inventing roles', () => {
    expect(subagentStatus('running')).toEqual({ key: 'working', label: 'working', working: true });
    expect(subagentStatus('pending')).toEqual({ key: 'thinking', label: 'pending', working: true });
    expect(subagentStatus('waiting')).toEqual({ key: 'talking', label: 'waiting', working: true });
    expect(subagentStatus('completed')).toEqual({ key: 'done', label: 'done', working: false });
    expect(subagentStatus('idle')).toEqual({ key: 'idle', label: 'idle', working: false });
  });
  it('keeps unknown status text and does not mark completed-like values working', () => {
    expect(subagentStatus('paused')).toMatchObject({ label: 'paused', working: false });
    expect(subagentStatus('')).toMatchObject({ label: 'unknown', working: false });
  });
});

describe('matchesDesk', () => {
  it('matches type, name, or description against the profile name', () => {
    expect(matchesDesk('coder', { type: 'coder', status: 'running' })).toBe(true);
    expect(matchesDesk('coder', { name: 'coder', status: 'running' })).toBe(true);
    expect(matchesDesk('planner', { type: 'Task', description: 'planner draft', status: 'running' })).toBe(true);
    expect(matchesDesk('coder', { type: 'Explore', description: 'search', status: 'running' })).toBe(false);
  });
});

describe('sessionAgentTree', () => {
  it('scopes desks and nested subagents to the selected session', () => {
    const s = ev(undefined,
      spawn('a-planner', 'planner', 'shop'),
      spawn('a-coder', 'coder', 'shop'),
      spawn('b-dev', 'Dev 1', 'blog'),
      { t: 'agent.state', id: 'a-coder', state: 'working', ts: 2 },
      { t: 'tool.call', id: 'a-coder', callId: 'c1', tool: 'Edit', inputSummary: 'checkout.ts', ts: 2 },
      { t: 'sessions.update', sessions: [
        sess('shop', ['a-planner', 'a-coder'], { state: 'tool', tool: { name: 'Bash', detail: 'npm test', ts: 2 },
          subagents: [
            { id: 'a1', type: 'planner', description: 'Plan discount codes', status: 'completed' },
            { id: 'a2', type: 'coder', description: 'Implement step 1', status: 'running' },
          ] }),
        sess('blog', ['b-dev'], { state: 'idle', subagents: [{ id: 'x', type: 'Explore', description: 'Find regex', status: 'running' }] }),
      ], ts: 3 },
    );
    const shop = sessionAgentTree(s, 'shop');
    expect(shop.map((r) => r.name)).toEqual(['planner', 'coder']);
    expect(shop[0].children).toMatchObject([{ name: 'planner', statusLabel: 'done', working: false, task: 'Plan discount codes' }]);
    expect(shop[1].children).toMatchObject([{ name: 'coder', statusLabel: 'working', working: true, task: 'Implement step 1' }]);
    expect(shop[1].working).toBe(true);
    expect(shop[1].task).toBe('Edit · checkout.ts');
    expect(countAgents(shop)).toBe(4);

    const blog = sessionAgentTree(s, 'blog');
    expect(blog.map((r) => r.name)).toEqual(['Dev 1', 'Explore']);
    expect(blog[1]).toMatchObject({ kind: 'subagent', name: 'Explore', task: 'Find regex', working: true });
    expect(blog[1].key).not.toEqual(shop[1].children[0].key);
  });

  it('does not keep a completed subagent marked working after the live payload clears it', () => {
    let s = ev(undefined,
      spawn('s1-coder-0', 'coder', 's1'),
      { t: 'agent.state', id: 's1-coder-0', state: 'working', ts: 2 },
      { t: 'sessions.update', sessions: [sess('s1', ['s1-coder-0'], { state: 'tool',
        subagents: [{ id: 'a2', type: 'coder', description: 'Implement', status: 'running' }] })], ts: 3 },
    );
    expect(sessionAgentTree(s, 's1')[0]).toMatchObject({ working: true, statusLabel: AGENT_STATE_LABEL.working });
    expect(sessionAgentTree(s, 's1')[0].children[0]).toMatchObject({ working: true, statusLabel: 'working', task: 'Implement' });

    s = ev(s,
      { t: 'agent.state', id: 's1-coder-0', state: 'idle', ts: 4 },
      { t: 'sessions.update', sessions: [sess('s1', ['s1-coder-0'], { state: 'idle',
        subagents: [{ id: 'a2', type: 'coder', description: 'Implement', status: 'completed' }] })], ts: 5 },
    );
    const row = sessionAgentTree(s, 's1')[0];
    expect(row.working).toBe(false);
    expect(row.statusLabel).toBe('idle');
    expect(row.task).toBe(TASK_UNAVAILABLE);
    expect(row.children[0]).toMatchObject({ working: false, statusLabel: 'done', task: 'Implement' });
  });

  it('says unavailable when the payload has no task, and uses the live turn when it does', () => {
    const turn: TurnView = {
      sid: 's1', turnId: 't1', project: 's1', agentRunId: 'z', who: 'Explore',
      prompt: 'Find regex usages', steps: [{ kind: 'tool', name: 'Grep', detail: '\\d{3}' }],
      status: 'running', startedAt: 1,
    };
    const empty = ev(undefined,
      spawn('lead', 'planner', 's1'),
      { t: 'sessions.update', sessions: [sess('s1', ['lead'], { state: 'idle',
        subagents: [{ id: 'z', type: 'Explore', status: 'running' }] })], ts: 1 },
    );
    expect(sessionAgentTree(empty, 's1')[0].task).toBe(TASK_UNAVAILABLE);
    expect(sessionAgentTree(empty, 's1')[1].task).toBe(TASK_UNAVAILABLE);

    const withTurn = ev(empty, { t: 'session.turn', turn, ts: 2 });
    expect(sessionAgentTree(withTurn, 's1')[1].task).toBe('Grep · \\d{3}');
  });

  it('does not treat a leftover tool chip as the current task once the desk is idle', () => {
    const s = ev(undefined,
      spawn('lead', 'planner', 's1'),
      { t: 'agent.state', id: 'lead', state: 'working', ts: 2 },
      { t: 'tool.call', id: 'lead', callId: 'c1', tool: 'Read', inputSummary: 'old.ts', ts: 2 },
      { t: 'agent.state', id: 'lead', state: 'idle', ts: 3 },
      { t: 'sessions.update', sessions: [sess('s1', ['lead'], { state: 'idle' })], ts: 4 },
    );
    expect(s.agents.lead.tool?.name).toBe('Read');
    expect(sessionAgentTree(s, 's1')[0]).toMatchObject({ working: false, task: TASK_UNAVAILABLE, statusLabel: 'idle' });
  });

  it('keeps unmatched subagents as session-level rows and maps waiting-permission to waiting', () => {
    const s = ev(undefined,
      spawn('lead', 'planner', 's1', 1),
      spawn('coder', 'coder', 's1', 1),
      { t: 'agent.state', id: 'lead', state: 'talking', ts: 2 },
      { t: 'sessions.update', sessions: [sess('s1', ['lead', 'coder'], {
        state: 'waiting-permission', tool: { name: 'Bash', detail: 'npm test', ts: 2 },
        subagents: [{ id: 'b1', type: 'Explore', description: 'Find regex usages', status: 'running' }],
      })], ts: 3 },
    );
    const tree = sessionAgentTree(s, 's1');
    expect(tree[0].statusLabel).toBe('waiting');
    expect(tree[0].task).toBe('Waiting for permission: Bash · npm test');
    expect(tree[1].children).toEqual([]);
    expect(tree[2]).toMatchObject({ kind: 'subagent', name: 'Explore', type: 'Explore', working: true });
  });

  it('returns an empty tree when the selected session is gone', () => {
    const s = ev(undefined, spawn('x', 'coder', 's1'), { t: 'sessions.update', sessions: [sess('s1', ['x'])], ts: 1 });
    expect(sessionAgentTree(s, 'gone')).toEqual([]);
    expect(sessionAgentTree(s, undefined)).toEqual([]);
  });
});
