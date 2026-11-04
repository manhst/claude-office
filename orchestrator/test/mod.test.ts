import { describe, it, expect } from 'vitest';
import { register, toolDetail, titleFromJsonl, transcriptPath } from '../../mod/office/hooks/register.js';
// Fake engine matching the API used by usage-esp: register(on, options); on(name, ($, e, next) => ...) returns { catch }.
function fakeEngine(env: Record<string, string> = { USERPROFILE: 'C:/Users/m' }, files: Record<string, string> = {}) {
  const h: Record<string, (...a: any[]) => any> = {}; const posts: any[] = []; let beat: (() => any) | undefined; let everyCalls = 0;
  const on = (n: string, fn: any) => { h[n] = fn; return { catch: () => {} }; };
  const $ = {
    env: { get: async (k: string) => env[k] },
    session: { id: async () => '3f2a9c1e-1111-2222-3333-444455556666', repo: async () => ({ root: 'C:/Users/m/proj' }), usage: async () => ({ cost: { usd: 0.42 } }) },
    agent: { list: async () => [{ type: 'coder', description: 'step 1', status: 'running' }] },
    http: { fetch: async (url: string, o: any) => { posts.push({ url, ...JSON.parse(o.body), ct: o.headers['content-type'] }); return { ok: true, text: async () => '' }; } },
    fs: { exists: async (p: string) => p in files, read: async (p: string) => files[p], list: async () => [] },
    clock: { every: (_ms: number, fn: () => any) => { everyCalls++; beat = fn; }, after: () => {}, now: async () => 0, sleep: async () => {} },
  };
  const next: any = (e: any) => e; next.origin = { plugin: 'engine' };
  const fire = (n: string, e: any = {}, nx = next) => h[n]($, e, nx);
  return { on, posts, fire, beat: () => beat?.(), next, everyCalls: () => everyCalls };
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
    await f.fire('turn.complete', { reason: 'answer' }); await flush();
    await f.fire('session.end', {}); await flush();
    const s = JSON.stringify(f.posts); expect(s).not.toContain('API_KEY'); expect(s).not.toContain('rm -rf');
    expect(f.posts.map((p) => [p.type, p.state, p.tool?.name, p.tool?.detail])).toEqual([
      ['start', 'idle', undefined, undefined], ['state', 'thinking', undefined, undefined], ['tool', 'tool', 'Write', 'secret.ts'], ['tool', 'tool', 'Bash', 'npm test'],
      ['subagents', 'tool', 'Bash', 'npm test'], ['state', 'waiting-permission', 'Bash', 'git push'], ['state', 'done', undefined, undefined], ['end', 'done', undefined, undefined]]);
    expect(f.posts[1]).toMatchObject({ prompt: 'Fix the login bug.', subagents: [{ type: 'coder', status: 'running' }] });
    await f.beat(); await flush(); expect(f.posts).toHaveLength(8); // nothing after end
  });
  it('heartbeat sends session info; classic session_title wins over transcript', async () => {
    const f = fakeEngine(); register(f.on, {});
    await f.fire('session.start', { cwd: '/p' }); await f.fire('classic.SessionStart', { session_title: 'Named', transcript_path: '/t.jsonl' });
    await f.fire('session.start', { cwd: '/p' }); expect(f.everyCalls()).toBe(1); // heartbeat registered once
    await f.beat(); await flush();
    expect(f.posts.at(-1)).toMatchObject({ type: 'heartbeat', title: 'Named', transcript: '/t.jsonl', url: 'http://127.0.0.1:7777/event' });
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
});
