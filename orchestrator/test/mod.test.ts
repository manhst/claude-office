import { describe, it, expect } from 'vitest';
import { register, toolDetail, titleFromJsonl, transcriptPath, usagePayload, turnSteps, turnBody, TURN_CAP, takeInboxToken, canPromptSubmit, fetchBody } from '../../mod/office/hooks/register.js';
// Fake engine matching the API used by usage-esp: register(on, options); on(name, ($, e, next) => ...) returns { catch }.
function fakeEngine(env: Record<string, string> = { USERPROFILE: 'C:/Users/m' }, files: Record<string, string> = {}) {
  const h: Record<string, (...a: any[]) => any> = {}; const posts: any[] = []; const beats: Array<() => any> = []; let everyCalls = 0; let sid = '3f2a9c1e-1111-2222-3333-444455556666';
  let msgs: any[] = []; const agentMsgs: Record<string, any[]> = {}; let subStatus = 'running'; let inboxJob: any;
  const on = (n: string, fn: any) => { h[n] = fn; return { catch: () => {} }; };
  const $: any = {
    env: { get: async (k: string) => env[k] },
    session: { id: async () => sid, repo: async () => ({ root: 'C:/Users/m/proj' }), usage: async () => ({ cost: { usd: 0.42 } }),
      messages: async (a?: any) => (a?.agentId ? (agentMsgs[a.agentId] ?? { deny: 'not yours' }) : msgs) },
    agent: { list: async () => [{ id: 'sub1', type: 'coder', description: 'step 1', status: subStatus }] },
    http: { fetch: async (url: string, o: any = {}) => {
      const method = (o.method ?? 'POST').toUpperCase();
      if (method === 'GET') {
        posts.push({ url, method, auth: o.headers?.authorization });
        const job = inboxJob; inboxJob = null;
        return { ok: true, status: job ? 200 : 204, text: job ? JSON.stringify(job) : '' };
      }
      posts.push({ url, ...JSON.parse(o.body), ct: o.headers?.['content-type'], ...(o.headers?.authorization ? { auth: o.headers.authorization } : {}) });
      return { ok: true, status: 200, text: JSON.stringify({ inboxToken: 'tok_inbox_abcdefghijklmnopqrstuvwx' }) };
    } },
    fs: { exists: async (p: string) => p in files, read: async (p: string) => files[p], list: async () => [] },
    clock: { every: (_ms: number, fn: () => any) => { everyCalls++; beats.push(fn); }, after: () => {}, now: async () => 0, sleep: async () => {} },
  };
  const next: any = (e: any) => e; next.origin = { plugin: 'engine' };
  const fire = (n: string, e: any = {}, nx = next) => h[n]($, e, nx);
  return { on, posts, fire, beat: () => { for (const fn of beats) fn(); }, next, everyCalls: () => everyCalls, $ ,
    setSid: (s: string) => { sid = s; }, setSub: (s: string) => { subStatus = s; }, setMsgs: (m: any[], agentId?: string) => { if (agentId) agentMsgs[agentId] = m; else msgs = m; },
    setInboxJob: (j: any) => { inboxJob = j; } };
}
const flush = () => new Promise((r) => setTimeout(r, 20));
import { readFileSync } from 'node:fs';
/** Every `$` must be `$.` or a first param/arg: `($,` `($:` `($)`. Strings/comments are stripped first. */
export function bareDollarUses(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/`(?:\\.|[^`\\])*`|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, '""');
  const bad: string[] = [];
  code.split('\n').forEach((l, i) => {
    for (const m of l.matchAll(/(?<![\w$])\$(?![\w$])/g)) {
      const k = m.index!, after = l.slice(k + 1), before = l.slice(0, k);
      if (after.startsWith('.') && !after.startsWith('..')) continue; // $.noun.verb
      if (before.endsWith('(') && /^\s*[,:)]/.test(after)) continue; // ($, / ($: / ($)
      bad.push(`${i + 1}: ${l.trim()}`);
    }
  });
  return bad;
}
describe('mod static $ rule', () => {
  it('register.ts never stores/passes $ except as first param/arg', () => {
    expect(bareDollarUses(readFileSync(new URL('../../mod/office/hooks/register.ts', import.meta.url), 'utf8'))).toEqual([]);
  });
  it('checker catches banned shapes', () => {
    for (const bad of ['$s = $;', 'let $ = 1', 'x = $ ', 'a($?.b)', 'f({ $ })', 'f([$])', 'g(a, $)', 'return $', 'const {env} = $', 'f(...$)'])
      expect(bareDollarUses(bad), bad).not.toEqual([]);
    expect(bareDollarUses("on('x', ($: Any, e) => { $.clock.every(1, () => void send($, st)); f($) })")).toEqual([]);
  });
});
describe('office mod (usage-esp API)', () => {
  it('posts start/thinking/tool/permission/done/end with short details only, title from transcript', async () => {
    const tp = transcriptPath('C:/Users/m/.claude', 'C:/Users/m/proj', '3f2a9c1e-1111-2222-3333-444455556666');
    const f = fakeEngine(undefined, { [tp]: '{"type":"ai-title","aiTitle":"Fix login"}\n' });
    register(f.on, { endpoint: 'http://127.0.0.1:7777/event' });
    await f.fire('session.start', { cwd: 'C:/Users/m/proj' }); await flush();
    expect(f.posts[0]).toMatchObject({ type: 'start', sid: '3f2a9c1e-1111-2222-3333-444455556666', root: 'C:/Users/m/proj', project: 'proj', title: 'Fix login', transcript: tp, costUsd: 0.42, ct: 'application/json' });
    await f.fire('classic.UserPromptSubmit', { prompt: 'Fix the login bug. Then add tests.' });
    await f.fire('turn.start', {}); await flush();
    await f.fire('tool.call', { tool: 'Write', file_path: 'C:/Users/m/proj/src/secret.ts', content: 'API_KEY=abc' });
    await f.fire('tool.call', { tool: 'Bash', command: 'npm test\nrm -rf /' });
    const own: any = (e: any) => e; own.origin = { plugin: 'office' }; await f.fire('tool.call', { tool: 'Read', file_path: 'x' }, own); // mod's own call: ignored
    await f.fire('tool.call', { tool: 'Read', file_path: 'y', agentId: 'sub1' }); // subagent call: subagent refresh only
    await f.fire('classic.PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'git push' } }); await flush();
    f.setSub('completed'); await f.fire('turn.complete', { reason: 'answer' }); await flush(); // no busy subagent left: done
    await f.fire('session.end', {}); await flush();
    const s = JSON.stringify(f.posts); expect(s).not.toContain('API_KEY'); expect(s).not.toContain('rm -rf');
    const ses = () => f.posts.filter((p) => p.type !== 'turn'); // no engine turnId here: turns go out with local ids
    expect(f.posts.filter((p) => p.type === 'turn').map((p) => [p.turn.phase, /^local-[a-z0-9]+-\d+$/.test(p.turn.id)])).toEqual([['start', true], ['end', true]]);
    expect(ses().map((p) => [p.type, p.state, p.tool?.name, p.tool?.detail])).toEqual([
      ['start', 'idle', undefined, undefined], ['state', 'thinking', undefined, undefined], ['tool', 'tool', 'Write', 'secret.ts'], ['tool', 'tool', 'Bash', 'npm test'],
      ['subagents', 'tool', 'Bash', 'npm test'], ['state', 'waiting-permission', 'Bash', 'git push'], ['state', 'done', undefined, undefined], ['end', 'done', undefined, undefined]]);
    expect(ses()[1]).toMatchObject({ prompt: 'Fix the login bug.', subagents: [{ type: 'coder', status: 'running' }] });
    await f.beat(); await flush(); expect(f.posts).toHaveLength(10); // nothing after end
  });
  it('heartbeat sends session info; classic session_title wins over transcript', async () => {
    const f = fakeEngine(); register(f.on, {});
    await f.fire('session.start', { cwd: '/p' }); await f.fire('classic.SessionStart', { session_title: 'Named', transcript_path: '/t.jsonl' });
    await f.fire('session.start', { cwd: '/p' }); expect(f.everyCalls()).toBe(1); // heartbeat registered once
    await f.beat(); await flush();
    expect(f.posts.at(-1)).toMatchObject({ type: 'heartbeat', title: 'Named', transcript: '/t.jsonl', url: 'http://127.0.0.1:7777/event' });
  });
  it('follows the next session after session.end in the same process (/resume, /clear)', async () => {
    const f = fakeEngine(); register(f.on, {});
    await f.fire('session.start', { cwd: 'C:/Users/m/proj' }); await f.fire('session.end', {}); await flush();
    f.setSid('9e8d7c6b-aaaa-bbbb-cccc-ddddeeeeffff'); await f.fire('turn.start', {}); await flush();
    expect(f.posts.map((p) => [p.type, p.sid.slice(0, 4)])).toEqual([['start', '3f2a'], ['end', '3f2a'], ['start', '9e8d'], ['state', '9e8d'], ['turn', '9e8d']]);
    expect(f.posts[2]).toMatchObject({ project: 'proj', transcript: transcriptPath('C:/Users/m/.claude', 'C:/Users/m/proj', '9e8d7c6b-aaaa-bbbb-cccc-ddddeeeeffff') });
    await f.fire('session.end', {}); f.setSid('1234abcd-0000-0000-0000-000000000000'); await f.beat(); await flush(); // no turn yet: the heartbeat picks it up
    expect(f.posts.slice(-2).map((p) => [p.type, p.sid.slice(0, 4)])).toEqual([['start', '1234'], ['heartbeat', '1234']]);
  });
  it('skips headless sdk-cli sessions and non-loopback endpoints', async () => {
    const a = fakeEngine({ CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' }); register(a.on, {}); await a.fire('session.start', { cwd: '/p' }); await a.fire('turn.start', {}); await flush();
    expect(a.posts).toHaveLength(0);
    const b = fakeEngine(); register(b.on, { endpoint: 'https://evil.example/event' }); await b.fire('session.start', { cwd: '/p' }); await flush();
    expect(b.posts).toHaveLength(0);
  });
  it('helpers', () => {
    expect(toolDetail('Read', { file_path: 'C:\\a\\b\\x.md' })).toBe('x.md');
    expect(toolDetail('WebFetch', { url: 'https://docs.example.com/a?token=1' })).toBe('docs.example.com');
    expect(transcriptPath('/c', 'C:\\Users\\Manh\\proj', 's')).toBe('/c/projects/C--Users-Manh-proj/s.jsonl');
    expect(titleFromJsonl('{"type":"ai-title","aiTitle":"A"}\n{"type":"custom-title","customTitle":"B"}\n{"type":"ai-title","aiTitle":"C"}')).toBe('B');
  });
  it('usage payload matches esp-claude payload.ts', () => {
    const rl = [{ kind: 'five_hour', percentUsed: 37, resetsAt: '2026-11-05T15:00:00Z' }, { kind: 'seven_day', percentUsed: 12 }];
    expect(usagePayload(rl, { percent: 44 }, { usd: 1.234 }, 99)).toEqual({ source: 'claude-code', ts: 99, five_hour: { pct: 37, resets_at: '2026-11-05T15:00:00Z' }, seven_day: { pct: 12, resets_at: null }, context_pct: 44, cost_usd: 1.23 });
    expect(usagePayload([{ kind: 'seven_day', percentUsed: 5, resetsAt: 1 }], undefined, undefined, 1)).toMatchObject({ five_hour: null, seven_day: { pct: 5, resets_at: 1 }, context_pct: null, cost_usd: null });
    expect(usagePayload([], { percent: 3 }, { usd: 1 }, 1)).toBeNull(); expect(usagePayload(undefined, null, null, 1)).toBeNull();
  });
  it('session.measure posts usage only when there is a 5h/7d reading', async () => {
    const f = fakeEngine(); register(f.on, {}); await f.fire('session.start', { cwd: 'C:/Users/m/proj' }); await flush();
    const n = f.posts.length;
    expect(await f.fire('session.measure', { rateLimits: [], context: { percent: 9 } })).toEqual({ rateLimits: [], context: { percent: 9 } }); await flush();
    expect(f.posts.length).toBe(n);
    f.fire('session.measure', { rateLimits: [{ kind: 'five_hour', percentUsed: 61, resetsAt: 'R' }], cost: { usd: 0.5 } }); await flush();
    const u = f.posts.at(-1); expect(u.type).toBe('usage'); expect(u.usage).toMatchObject({ source: 'claude-code', five_hour: { pct: 61, resets_at: 'R' }, seven_day: null, cost_usd: 0.5 });
  });
  const convo = [
    { role: 'user', text: 'old prompt', toolUses: [] }, { role: 'assistant', text: 'old answer', toolUses: [] },
    { role: 'user', text: 'Fix the login bug.\nThen add tests.', toolUses: [] },
    { role: 'assistant', text: 'Looking at the code.', toolUses: [{ tool_use_id: 'u1', tool: 'Read', input: { file_path: 'C:/p/src/login.ts' }, text: 'SECRET FILE BODY', result: { content: 'SECRET FILE BODY' } }] },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'u1', text: 'SECRET FILE BODY' }] },
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'u2', tool: 'Bash', input: { command: 'npm test\nrm -rf /' }, text: 'boom', isError: true }] },
    { role: 'user', text: 'tool output', toolUses: [], toolResults: [{ tool_use_id: 'u2', text: 'boom' }] },
    { role: 'assistant', text: 'Fixed.', toolUses: [] },
  ];
  it('posts turns: prompt on start, live steps (throttled), CLI steps + answer on end; subagent runs; summaries only', async () => {
    const f = fakeEngine(); register(f.on, {}); await f.fire('session.start', { cwd: 'C:/Users/m/proj' });
    f.setMsgs(convo.slice(0, 3)); f.setMsgs([{ role: 'user', text: 'Explore auth', toolUses: [] }, { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'x', tool: 'Grep', input: { pattern: 'login' } }] }], 'sub1');
    await f.fire('turn.start', { text: 'Fix the login bug.\nThen add tests.', turnId: 'T1' }); await flush(); f.setMsgs(convo); // base = 3 messages at turn.start
    expect(f.posts.at(-2)).toMatchObject({ type: 'state', state: 'thinking', prompt: 'Fix the login bug.' }); // turn.start is the prompt source now
    await f.fire('tool.call', { tool: 'Bash', command: 'npm test' }); await f.fire('tool.call', { tool: 'Bash', command: 'npm test' }); await flush();
    await f.fire('turn.start', { text: 'Explore auth', turnId: 'S1', agentId: 'sub1' });
    await f.fire('turn.complete', { turnId: 'S1', agentId: 'sub1', answer: 'auth is in login.ts', reason: 'answer', durationMs: 5 });
    await f.fire('turn.start', { text: '', turnId: 'S2', agentId: 'ghost' }); await f.fire('turn.complete', { turnId: 'S2', agentId: 'ghost', answer: '', reason: 'error', durationMs: 1 });
    await f.fire('turn.complete', { turnId: 'T1', answer: 'Fixed.', reason: 'answer', durationMs: 1234 }); await flush();
    const turns = f.posts.filter((p) => p.type === 'turn');
    expect(turns.map((p) => [p.turn.id, p.turn.phase, p.turn.agentId, p.turn.agentType])).toEqual([
      ['T1', 'start', undefined, undefined], ['T1', 'start', undefined, undefined], ['S1', 'start', 'sub1', 'coder'], ['S1', 'end', 'sub1', 'coder'],
      ['S2', 'start', 'ghost', undefined], ['S2', 'end', 'ghost', undefined], ['T1', 'end', undefined, undefined]]);
    const steps = [{ kind: 'text', text: 'Looking at the code.' }, { kind: 'tool', name: 'Read', detail: 'login.ts' }, { kind: 'tool', name: 'Bash', detail: 'npm test', isError: true }];
    expect(turns[0]).toEqual({ url: 'http://127.0.0.1:7777/event', ct: 'application/json', type: 'turn', sid: '3f2a9c1e-1111-2222-3333-444455556666', turn: { id: 'T1', phase: 'start', prompt: 'Fix the login bug.\nThen add tests.' } });
    expect(turns[1].turn).toEqual({ id: 'T1', phase: 'start', steps: [...steps, { kind: 'text', text: 'Fixed.' }] });
    expect(turns[3].turn).toEqual({ id: 'S1', phase: 'end', agentId: 'sub1', agentType: 'coder', answer: 'auth is in login.ts', reason: 'answer', durationMs: 5, steps: [{ kind: 'tool', name: 'Grep', detail: 'login' }] });
    expect(turns[4].turn.prompt).toBeUndefined(); expect(turns[5].turn).toMatchObject({ steps: [], reason: 'error' }); // denied messages: no steps
    expect(turns[6].turn).toEqual({ id: 'T1', phase: 'end', answer: 'Fixed.', reason: 'answer', durationMs: 1234, steps }); // last text = answer: not repeated
    const s = JSON.stringify(f.posts); for (const bad of ['SECRET FILE BODY', 'rm -rf', 'boom', 'old answer', 'C:/p/src']) expect(s).not.toContain(bad);
  });
  it('turn helpers: steps after the last typed prompt, caps keep the body under the server limit', () => {
    expect(turnSteps(undefined)).toEqual([]); expect(turnSteps([{ role: 'assistant', text: 'hi', toolUses: [] }])).toEqual([{ kind: 'text', text: 'hi' }]);
    expect(turnSteps(convo, 'Fixed.').map((x: any) => x.name ?? x.text)).toEqual(['Looking at the code.', 'Read', 'Bash']);
    const many = Array.from({ length: 100 }, (_, i) => ({ role: 'assistant', text: `${i} ${'x'.repeat(5000)}`, toolUses: [] }));
    const st = turnSteps(many); expect(st).toHaveLength(TURN_CAP.steps); expect((st[0] as any).text.startsWith('40 ')).toBe(true); expect((st[0] as any).text).toHaveLength(TURN_CAP.text + 1);
    const body = turnBody('s', { id: 't', phase: 'end', prompt: 'p'.repeat(9000), answer: 'a'.repeat(30_000), steps: st });
    const j = JSON.parse(body); expect(body.length).toBeLessThanOrEqual(TURN_CAP.body);
    expect(j.turn.prompt).toHaveLength(TURN_CAP.prompt + 1); expect(j.turn.answer).toHaveLength(TURN_CAP.answer + 1);
    expect(j.turn.steps.length).toBeGreaterThan(0); expect(j.turn.steps.at(-1).text.startsWith('99 ')).toBe(true); // newest kept
    expect(JSON.parse(turnBody('s', { id: 't', phase: 'end', answer: 'é'.repeat(12_000) }, 5000)).turn.answer.length).toBeLessThan(5000);
  });
  it('turn steps from the message count at turn.start: no repeat on continuation, reminders do not cut them; scan when compacted or capped', () => {
    const reminder = { role: 'user', text: '<system-reminder>todo list changed</system-reminder>', toolUses: [] };
    const msgs = [...convo.slice(0, 4), reminder, ...convo.slice(4)];
    expect(turnSteps(msgs, 'Fixed.', 3).map((x: any) => x.name ?? x.text)).toEqual(['Looking at the code.', 'Read', 'Bash']); // base: reminder kept inside
    expect(turnSteps(msgs, 'Fixed.').map((x: any) => x.name ?? x.text)).toEqual(['Bash']); // old scan stops at the reminder
    expect(turnSteps(convo, undefined, convo.length)).toEqual([]); // continuation turn with nothing new: no previous steps
    expect(turnSteps([...convo, { role: 'assistant', text: 'More.', toolUses: [] }], undefined, convo.length)).toEqual([{ kind: 'text', text: 'More.' }]);
    expect(turnSteps(convo.slice(2), 'Fixed.', 7)).toHaveLength(3); // shrunk below base (compacted): scan
    const capped = Array.from({ length: TURN_CAP.msgs }, () => ({ role: 'assistant', text: 'a', toolUses: [] }));
    expect(turnSteps(capped, undefined, TURN_CAP.msgs - 1)).toHaveLength(TURN_CAP.steps); // list at the engine cap: base unreliable, scan
  });
  it('turnBody always ends and clips ids/reason', () => {
    for (const max of [0, 10, 60]) expect(JSON.parse(turnBody('s', { id: 't', phase: 'end', answer: 'ab', steps: [{ kind: 'text', text: 'x' }] }, max)).turn).toEqual({ id: 't', phase: 'end', steps: [] }); // too small: steps and answer go, no hang
    expect(JSON.parse(turnBody('s', { id: 't', phase: 'end', answer: 'ab', steps: [{ kind: 'text', text: 'x' }] }, 200)).turn).toMatchObject({ answer: 'ab', steps: [{ text: 'x' }] });
    const small = turnBody('s', { id: 't', phase: 'end', answer: 'é'.repeat(9000) }, 100); expect(small.length).toBeLessThanOrEqual(100); expect(JSON.parse(small).turn.answer).toMatch(/^é+…$/);
    const j = JSON.parse(turnBody('s', { id: 'i'.repeat(200), agentId: 'a'.repeat(200), agentType: 'T'.repeat(200), phase: 'end', reason: 'x'.repeat(50) })).turn;
    expect([j.id.length, j.agentId.length, j.agentType.length, j.reason]).toEqual([64, 64, 64, undefined]);
    expect(JSON.parse(turnBody('s', { id: 't', phase: 'end', reason: 'aborted' })).turn.reason).toBe('aborted');
  });
  it('without engine turnIds, a subagent run keeps one local id from start to end', async () => {
    const f = fakeEngine(); register(f.on, {}); await f.fire('session.start', { cwd: '/p' });
    await f.fire('turn.start', { text: 'go', agentId: 'sub1' }); await f.fire('turn.complete', { agentId: 'sub1', answer: 'ok', reason: 'answer' }); await flush();
    const t = f.posts.filter((p) => p.type === 'turn').map((p) => p.turn); expect(t.map((x) => x.phase)).toEqual(['start', 'end']);
    expect(t[0].id).toMatch(/^local-/); expect(t[1].id).toBe(t[0].id); expect(t[1]).toMatchObject({ agentId: 'sub1', agentType: 'coder', answer: 'ok' });
  });
});
describe('same-session prompt submit', () => {
  it('takeInboxToken / fetchBody / canPromptSubmit', async () => {
    expect(takeInboxToken('{"inboxToken":"tok_inbox_abcdefghijklmnopqrstuvwx"}')).toBe('tok_inbox_abcdefghijklmnopqrstuvwx');
    expect(takeInboxToken('{"inboxToken":"short"}')).toBeUndefined();
    expect(takeInboxToken('not json')).toBeUndefined();
    expect(await fetchBody({ text: '{"ok":true}' })).toBe('{"ok":true}');
    expect(await fetchBody({ text: async () => 'hi' })).toBe('hi');
    expect(canPromptSubmit({})).toBe(false);
    expect(canPromptSubmit({ prompt: { submit: async () => ({}) } })).toBe(true);
  });
  it('polls inbox and calls $.prompt.submit({text, asUser:true}); Esc drop is rejected not a finished turn; no duplicate claim', async () => {
    const f = fakeEngine();
    const calls: any[] = [];
    f.$.prompt = { submit: async (a: any) => { calls.push(a); return { drop: 'session is stopped' }; } };
    f.$.session.model = async () => 'claude-opus';
    register(f.on, {});
    await f.fire('session.start', { cwd: 'C:/Users/m/proj' }); await flush();
    expect(f.posts[0]).toMatchObject({ type: 'start', canSubmit: true, model: 'claude-opus' });
    expect(f.everyCalls()).toBe(2);
    f.setInboxJob({ id: 'job1', text: 'from office UI' });
    await f.beat(); await flush();
    expect(calls).toEqual([{ text: 'from office UI', asUser: true }]);
    const ack = f.posts.filter((p) => p.url?.includes('/inbox/ack'));
    expect(ack).toHaveLength(1);
    expect(ack[0]).toMatchObject({ id: 'job1', state: 'rejected', reason: 'session is stopped' });
    expect(ack[0].type).toBeUndefined(); // ack is not a turn event
    await f.beat(); await flush(); // job already claimed in fake; no second submit
    expect(calls).toHaveLength(1);
  });
  it('does not register inbox poll without $.prompt.submit', async () => {
    const f = fakeEngine(); register(f.on, {});
    await f.fire('session.start', { cwd: '/p' }); await flush();
    expect(f.posts[0].canSubmit).toBe(false);
    expect(f.everyCalls()).toBe(1);
    f.setInboxJob({ id: 'job1', text: 'nope' });
    await f.beat(); await flush();
    expect(f.posts.filter((p) => p.method === 'GET')).toHaveLength(0);
  });
});
