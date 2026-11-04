import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionTracker, parseModEvent } from '../src/sessions.js';
import { loadProfiles, parseFrontmatter } from '../src/profiles.js';
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
    // unknown subagent type goes to the main agent
    t.ingest({ type: 'subagents', sid: 's1', state: 'idle', subagents: [{ type: 'Explore', description: 'look', status: 'running' }] });
    expect((t.snapshot() as any).agents.map((a: any) => a.state)).toEqual(['working', 'idle']);
    expect(ev.filter((e) => e.t === 'agent.text').at(-1)).toMatchObject({ id: s.agentIds[0], text: expect.stringContaining('Explore: look') });
    t.ingest({ type: 'state', sid: 's1', state: 'done', subagents: [] });
    expect(ev.filter((e) => e.t === 'agent.done')).toMatchObject([{ id: s.agentIds[0], result: 'Fix bug' }]);
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
});
