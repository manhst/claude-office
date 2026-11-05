import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionTracker, parseModEvent } from '../src/sessions.js';
import { loadProfiles, parseFrontmatter } from '../src/profiles.js';
import { turnLogGate } from '../src/log.js';
import type { OfficeEvent } from '../src/types.js';
const tmp = () => mkdtempSync(join(tmpdir(), 'office-prof-'));
const agent = (dir: string, file: string, md: string) => { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, file), md); };
describe('frontmatter', () => {
  it('parses scalars, inline lists, comma lists and dash lists', () => {
    const { meta, body } = parseFrontmatter('---\nname: "coder"\ntools: Read, Edit\nmodel: sonnet\nx: [a, b]\ny:\n  - one\n  - two\n---\nBody here\n');
    expect(meta).toEqual({ name: 'coder', tools: 'Read, Edit', model: 'sonnet', x: ['a', 'b'], y: ['one', 'two'] });
    expect(body.trim()).toBe('Body here');
    expect(parseFrontmatter('no frontmatter').body).toBe('no frontmatter');
  });
});
describe('profile priority A > B > C', () => {
  it('A: project .claude/agents plus user agents (project wins on name clash), even when CLAUDE.md exists', () => {
    const root = tmp(), user = tmp();
    agent(join(root, '.claude/agents'), 'coder.md', '---\nname: coder\ndescription: writes code\ntools: Read, Edit\nmodel: opus\n---\nDo it.');
    agent(user, 'coder.md', '---\nname: coder\ndescription: user coder\n---\n'); agent(user, 'helper.md', '---\ndescription: helps\n---\nHelp.');
    writeFileSync(join(root, 'CLAUDE.md'), '# Proj');
    const r = loadProfiles(root, user);
    expect(r.source).toBe('agents');
    expect(r.profiles.map((p) => [p.name, p.scope])).toEqual([['coder', 'project'], ['helper', 'user']]);
    expect(r.profiles[0]).toMatchObject({ description: 'writes code', tools: ['Read', 'Edit'], model: 'opus', body: 'Do it.' });
    expect(loadProfiles(tmp(), user).source).toBe('agents'); // user-level agents alone also count as A
  });
  it('B: CLAUDE.md when no agent files', () => {
    const root = tmp(); writeFileSync(join(root, 'CLAUDE.md'), '# My project\n\nRules.');
    const r = loadProfiles(root, join(root, 'missing'));
    expect(r.source).toBe('claude-md'); expect(r.profiles).toHaveLength(1);
    expect(r.profiles[0]).toMatchObject({ name: 'My project', body: '# My project\n\nRules.' });
  });
  it('C: default dev placeholders when nothing found (and for an empty root)', () => {
    expect(loadProfiles(tmp()).source).toBe('default');
    expect(loadProfiles('').profiles.map((p) => p.name)).toEqual(['Dev 1', 'Dev 2']);
  });
});
describe('session tracking', () => {
  const setup = (o = {}) => {
    let now = 1000; const ev: OfficeEvent[] = [];
    const root = tmp(); agent(join(root, '.claude/agents'), 'a-planner.md', '---\nname: planner\n---\n'); agent(join(root, '.claude/agents'), 'b-coder.md', '---\nname: coder\n---\n');
    const t = new SessionTracker({ now: () => now, ...o }); t.on((e) => ev.push(e));
    return { t, ev, root, tick: (ms: number) => { now += ms; } };
  };
  it('creates a session with one desk per profile and maps state/tool/subagents onto agents', () => {
    const { t, ev, root } = setup();
    expect(t.ingest({ type: 'start', sid: 's1', cwd: root, title: 'Fix bug' })).toBe(true);
    const [s] = t.list(); expect(s).toMatchObject({ sid: 's1', source: 'agents', project: root.split(/[\\/]/).pop() });
    expect(s.agentIds).toHaveLength(2);
    t.ingest({ type: 'tool', sid: 's1', state: 'tool', tool: { name: 'Bash', detail: 'npm test' } });
    expect(ev.filter((e) => e.t === 'tool.call')).toMatchObject([{ id: s.agentIds[0], tool: 'Bash', inputSummary: 'npm test' }]);
    t.ingest({ type: 'subagents', sid: 's1', state: 'thinking', subagents: [{ type: 'coder', description: 'step 1', status: 'running' }] });
    const st = Object.fromEntries((t.snapshot() as any).agents.map((a: any) => [a.name, a.state]));
    expect(st).toEqual({ planner: 'thinking', coder: 'working' });
    expect(ev.some((e) => e.t === 'tool.result' && e.id === s.agentIds[0])).toBe(true);
    // unmatched subagent type claims the next free desk (lead first); not collapsed into a Subagents: text line
    t.ingest({ type: 'subagents', sid: 's1', state: 'idle', subagents: [{ type: 'Explore', description: 'look', status: 'running' }] });
    expect((t.snapshot() as any).agents.map((a: any) => a.state)).toEqual(['working', 'idle']);
    expect(ev.filter((e) => e.t === 'agent.text').at(-1)).toMatchObject({ id: s.agentIds[0], text: 'look' });
    t.ingest({ type: 'state', sid: 's1', state: 'done', subagents: [] });
    expect(ev.filter((e) => e.t === 'agent.done')).toMatchObject([{ id: s.agentIds[0], result: 'Fix bug' }]);
  });

  it('maps 4 parallel busy subagents onto 4 distinct desks', () => {
    const root = tmp();
    for (const n of ['alpha', 'beta', 'gamma', 'delta']) agent(join(root, '.claude/agents'), `${n}.md`, `---\nname: ${n}\n---\n`);
    let now = 1000; const ev: OfficeEvent[] = [];
    const t = new SessionTracker({ now: () => now, desks: 6 }); t.on((e) => ev.push(e));
    t.ingest({ type: 'start', sid: 's4', cwd: root, title: 'parallel' });
    const [s] = t.list(); expect(s.agentIds).toHaveLength(4);
    t.ingest({
      type: 'subagents', sid: 's4', state: 'tool',
      tool: { name: 'Task', detail: 'fan out' },
      subagents: [
        { id: '1', type: 'Explore', description: 'scan A', status: 'running' },
        { id: '2', type: 'general-purpose', description: 'scan B', status: 'running' },
        { id: '3', type: 'Explore', description: 'scan C', status: 'pending' },
        { id: '4', type: 'Bash', description: 'scan D', status: 'waiting' },
      ],
    });
    const states = (t.snapshot() as any).agents.map((a: any) => a.state);
    expect(states.filter((x: string) => x === 'working')).toHaveLength(4);
    expect(states).toEqual(['working', 'working', 'working', 'working']);
  });

  it('matches subagent by profile name ≈ type, name, or description', () => {
    const { t, root } = setup();
    t.ingest({ type: 'start', sid: 's1', cwd: root });
    const [s] = t.list();
    t.ingest({ type: 'subagents', sid: 's1', state: 'thinking', subagents: [
      { type: 'other', name: 'coder', description: 'impl', status: 'running' },
    ]});
    expect(Object.fromEntries((t.snapshot() as any).agents.map((a: any) => [a.name, a.state]))).toEqual({ planner: 'thinking', coder: 'working' });
    t.ingest({ type: 'subagents', sid: 's1', state: 'thinking', subagents: [
      { type: 'Task', description: 'planner draft', status: 'running' },
    ]});
    expect(Object.fromEntries((t.snapshot() as any).agents.map((a: any) => [a.name, a.state]))).toEqual({ planner: 'working', coder: 'idle' });
  });

  it('puts leftover subagent text on the lead only when desks are exhausted', () => {
    const root = tmp();
    agent(join(root, '.claude/agents'), 'only.md', '---\nname: only\n---\n');
    const t = new SessionTracker({ now: () => 1000, desks: 1, perSession: 1 });
    const ev: OfficeEvent[] = []; t.on((e) => ev.push(e));
    t.ingest({ type: 'start', sid: 's1', cwd: root });
    const [s] = t.list(); expect(s.agentIds).toHaveLength(1);
    t.ingest({ type: 'subagents', sid: 's1', state: 'idle', subagents: [
      { type: 'Explore', description: 'one', status: 'running' },
      { type: 'Explore', description: 'two', status: 'running' },
    ]});
    const a = (t.snapshot() as any).agents[0];
    expect(a.state).toBe('working');
    expect(ev.filter((e) => e.t === 'agent.text').at(-1)).toMatchObject({
      id: s.agentIds[0],
      text: expect.stringContaining('Subagents: Explore: two'),
    });
  });

  it('keeps desks working when main is done but subagents are still busy', () => {
    const { t, root } = setup();
    t.ingest({ type: 'start', sid: 's1', cwd: root, title: 'still going' });
    const [s] = t.list();
    t.ingest({ type: 'state', sid: 's1', state: 'done', subagents: [
      { type: 'coder', description: 'finish patch', status: 'running' },
      { type: 'Explore', description: 'extra', status: 'running' },
    ]});
    const st = Object.fromEntries((t.snapshot() as any).agents.map((a: any) => [a.name, a.state]));
    expect(st).toEqual({ planner: 'working', coder: 'working' });
    // finished subagent clears that desk; remaining busy keeps the other working
    t.ingest({ type: 'subagents', sid: 's1', state: 'done', subagents: [
      { type: 'coder', description: 'finish patch', status: 'completed' },
      { type: 'Explore', description: 'extra', status: 'running' },
    ]});
    expect(Object.fromEntries((t.snapshot() as any).agents.map((a: any) => [a.name, a.state]))).toEqual({ planner: 'working', coder: 'idle' });
  });
  it('drops sessions on end and after 60s without heartbeat; frees desks', () => {
    const { t, ev, tick } = setup();
    t.ingest({ type: 'start', sid: 'a', cwd: '' }); t.ingest({ type: 'start', sid: 'b', cwd: '' });
    expect(t.list().map((s) => s.sid)).toEqual(['a', 'b']);
    t.ingest({ type: 'end', sid: 'a' });
    expect(t.list().map((s) => s.sid)).toEqual(['b']); expect(ev.filter((e) => e.t === 'agent.left')).toHaveLength(2);
    tick(30_000); t.ingest({ type: 'heartbeat', sid: 'b' }); tick(45_000); t.sweep();
    expect(t.list()).toHaveLength(1);
    tick(20_000); t.sweep(); expect(t.list()).toHaveLength(0);
    t.ingest({ type: 'start', sid: 'c', cwd: '' });
    expect((t.snapshot() as any).agents.map((a: any) => a.desk)).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }]);
  });
  it('limits desks and warns when full', () => {
    const { t, ev } = setup({ desks: 3 });
    t.ingest({ type: 'start', sid: 'a', cwd: '' }); t.ingest({ type: 'start', sid: 'b', cwd: '' });
    expect(t.list()[1].agentIds).toHaveLength(1);
    expect(ev.some((e) => e.t === 'office.notice' && /No free desk/.test(e.text))).toBe(true);
  });
  it('sanitizes payloads: bad type/sid rejected, strings capped and secrets redacted', () => {
    expect(parseModEvent({ type: 'start' })).toBeNull(); expect(parseModEvent({ type: 'x', sid: 'a' })).toBeNull(); expect(parseModEvent(null)).toBeNull();
    const e = parseModEvent({ type: 'tool', sid: 'a/../b', tool: { name: 'Bash', detail: 'export GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz ' + 'x'.repeat(500) } })!;
    expect(e.sid).toBe('ab'); expect(e.tool!.detail).not.toContain('ghp_'); expect(e.tool!.detail!.length).toBeLessThan(140);
  });
  it('sanitizes turn events: newlines kept, secrets redacted, ids cleaned, steps capped', () => {
    expect(parseModEvent({ type: 'turn', sid: 'a' })).toBeNull(); expect(parseModEvent({ type: 'turn', sid: 'a', turn: { id: 't', phase: 'run' } })).toBeNull();
    expect(parseModEvent({ type: 'turn', sid: 'a', turn: { id: '../', phase: 'start' } })).toBeNull();
    const steps = [...Array.from({ length: 70 }, (_, i) => (i % 2 ? { kind: 'tool', name: 'Bash', detail: 'y'.repeat(500), isError: 'yes', input: { content: 'FILE' } } : { kind: 'text', text: `step ${i}\r\n  indented` })), { kind: 'evil', text: 'x' }, { kind: 'text', text: '  \n ' }];
    const e = parseModEvent({ type: 'turn', sid: 'a', turn: { id: 't1/../x'.repeat(30), phase: 'end', agentId: 'ag<1>', agentType: 'coder\nx', prompt: '\n\nline 1\r\n  line 2\0\x1b', reason: 'bogus', durationMs: 12.6,
      answer: 'Done.\nkey: sk-abcdefghijklmnopqrstuvwxyz\nexport GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz\n' + 'z'.repeat(20_000), steps } })!;
    const t = e.turn!;
    expect(t.id).toHaveLength(64); expect(t.id).toMatch(/^[\w-]+$/); expect(t.agentId).toBe('ag1'); expect(t.agentType).toBe('coder x');
    expect(t.prompt).toBe('line 1\n  line 2'); expect(t.reason).toBeUndefined(); expect(t.durationMs).toBe(13);
    expect(t.answer).toContain('Done.\nkey: [REDACTED]\n'); expect(t.answer).not.toContain('sk-abc'); expect(t.answer).not.toContain('ghp_'); expect(t.answer!.length).toBeLessThan(12_100);
    expect(t.steps).toHaveLength(58); expect(t.steps![0]).toEqual({ kind: 'text', text: 'step 12\n  indented' });
    expect(t.steps![1]).toEqual({ kind: 'tool', name: 'Bash', detail: expect.stringMatching(/^y+…/) }); expect(JSON.stringify(t)).not.toContain('FILE');
  });
  it('upserts turns (end keeps start prompt/startedAt), sets deskId, keeps a ring and snapshot.turns after the session leaves', () => {
    const { t, ev, root, tick } = setup({ turns: 3 });
    t.ingest({ type: 'start', sid: 's1', cwd: root, project: 'proj' }); const [s] = t.list();
    const turn = (x: any) => expect(t.ingest({ type: 'turn', sid: 's1', turn: x })).toBe(true);
    turn({ id: 'T1', phase: 'start', prompt: 'Do it\n  now' }); tick(200);
    turn({ id: 'T1', phase: 'start', steps: [{ kind: 'tool', name: 'Read', detail: 'a.ts' }] });
    turn({ id: 'S1', phase: 'start', agentId: 'ag1', agentType: 'Coder', prompt: 'sub' }); turn({ id: 'S1', phase: 'end', agentId: 'ag1', answer: 'sub done' });
    turn({ id: 'S2', phase: 'start', agentId: 'ag2', agentType: 'Explore' }); tick(300);
    turn({ id: 'T1', phase: 'end', answer: 'All done, token ghp_abcdefghijklmnopqrstuvwxyz', reason: 'answer', durationMs: 900, steps: [] });
    turn({ id: 'T1', phase: 'start', steps: [{ kind: 'text', text: 'late' }] }); // progress after the end: ignored
    const turns = ev.flatMap((e) => (e.t === 'session.turn' ? [e.turn] : []));
    expect(turns).toHaveLength(6);
    expect(turns.at(-1)).toEqual({ sid: 's1', turnId: 'T1', project: 'proj', deskId: s.agentIds[0], prompt: 'Do it\n  now', steps: [{ kind: 'tool', name: 'Read', detail: 'a.ts' }],
      answer: 'All done, token [REDACTED]', status: 'answer', startedAt: 1000, endedAt: 1500, durationMs: 900 });
    expect(turns[3]).toMatchObject({ turnId: 'S1', agentRunId: 'ag1', who: 'Coder', deskId: s.agentIds[1], prompt: 'sub', answer: 'sub done', status: 'answer' });
    expect(turns[4]).toMatchObject({ turnId: 'S2', who: 'Explore', status: 'running' }); expect(turns[4].deskId).toBeUndefined();
    t.ingest({ type: 'turn', sid: 's1', turn: { id: 'T2', phase: 'start', prompt: 'next' } }); // ring of 3: T1 (oldest) goes
    t.ingest({ type: 'end', sid: 's1' });
    t.ingest({ type: 'turn', sid: 'gone', turn: { id: 'X', phase: 'end', reason: 'aborted', durationMs: 100 } }); // unknown session: no desk
    const snap = t.snapshot() as any;
    expect(snap.sessions).toEqual([]); expect(snap.turns.map((x: any) => x.turnId)).toEqual(['S2', 'T2', 'X']);
    expect(snap.turns[2]).toMatchObject({ project: 'gone', status: 'aborted', startedAt: 1400, endedAt: 1500 }); expect(snap.turns[2].deskId).toBeUndefined();
    snap.turns[0].steps.push({ kind: 'text', text: 'mutated' }); expect((t.snapshot() as any).turns[0].steps).toEqual([]); // copies
  });
  it('aborts stale running turns: a new main turn supersedes the old one, session end/timeout aborts the rest', () => {
    const { t, ev, root, tick } = setup();
    t.ingest({ type: 'start', sid: 's1', cwd: root });
    const turn = (x: any) => t.ingest({ type: 'turn', sid: 's1', turn: x });
    const last = (id: string) => ev.flatMap((e) => (e.t === 'session.turn' && e.turn.turnId === id ? [e.turn] : [])).at(-1)!;
    turn({ id: 'T1', phase: 'start', prompt: 'one' }); turn({ id: 'S1', phase: 'start', agentId: 'ag1' }); tick(100);
    turn({ id: 'T2', phase: 'start', prompt: 'two' }); // T1 never ended (interrupted without turn.complete)
    expect(last('T1')).toMatchObject({ status: 'aborted', endedAt: 1100 }); expect(last('S1').status).toBe('running'); // subagent runs are not superseded
    turn({ id: 'T2', phase: 'start', steps: [{ kind: 'text', text: 'x' }] }); expect(last('T2').status).toBe('running'); // same turn: no abort
    tick(70_000); t.sweep(); // killed terminal: no heartbeat
    expect([last('S1'), last('T2')].map((x) => [x.status, x.endedAt])).toEqual([['aborted', 71_100], ['aborted', 71_100]]);
    expect((t.snapshot() as any).turns.every((x: any) => x.status !== 'running')).toBe(true);
  });
  it('ring evicts the oldest ended turn first, a running one only as a last resort', () => {
    const { t, root } = setup({ turns: 3 });
    t.ingest({ type: 'start', sid: 's1', cwd: root });
    const turn = (x: any) => t.ingest({ type: 'turn', sid: 's1', turn: x });
    turn({ id: 'T1', phase: 'start', prompt: 'main' });
    for (const n of [1, 2, 3, 4]) { turn({ id: `S${n}`, phase: 'start', agentId: `a${n}` }); turn({ id: `S${n}`, phase: 'end', agentId: `a${n}` }); }
    const ids = () => (t.snapshot() as any).turns.map((x: any) => x.turnId);
    expect(ids()).toEqual(['T1', 'S3', 'S4']); expect((t.snapshot() as any).turns[0]).toMatchObject({ prompt: 'main', startedAt: 1000 });
    for (const n of [5, 6, 7]) turn({ id: `S${n}`, phase: 'start', agentId: `a${n}` }); // all running: the oldest running goes
    expect(ids()).toEqual(['S5', 'S6', 'S7']);
  });
  it('turn log gate: first start and the end only', () => {
    const gate = turnLogGate(); const ev = (turnId: string, status: string, agentRunId?: string) => ({ t: 'session.turn', turn: { sid: 's', turnId, agentRunId, status }, ts: 0 }) as any;
    expect([ev('a', 'running'), ev('a', 'running'), ev('a', 'running', 'x'), ev('a', 'answer'), ev('a', 'running'), ev('b', 'aborted')].map(gate)).toEqual([true, false, true, true, true, true]);
    expect(gate({ t: 'agent.state', id: 'x', state: 'idle', ts: 0 })).toBe(true);
  });
});
