import { describe, it, expect } from 'vitest';
import { register, toolDetail, titleFromJsonl, transcriptPath } from '../../mod/office/hooks/register.js';
// Fake engine `$` with the API shape the mod assumes (see mod/README.md). Verifies the mod posts sane events and never leaks contents.
function fakeEngine() {
  const handlers: Record<string, (e: any) => void> = {}; const posts: any[] = []; let timer: (() => void) | undefined;
  const $ = {
    session: { id: () => 'sess-1234', repo: () => ({ root: '/home/m/proj' }), usage: () => ({ cost: { usd: 0.42 } }) },
    agent: { list: () => [{ id: 'x', type: 'coder', description: 'step 1', status: 'running' }] },
    http: { fetch: (url: string, o: any) => { posts.push({ url, ...JSON.parse(o.body), ct: o.headers['content-type'] }); return Promise.resolve({ ok: true }); } },
    clock: { setInterval: (fn: () => void) => { timer = fn; return () => { timer = undefined; }; } },
    on: (n: string, fn: (e: any) => void) => { handlers[n] = fn; },
  };
  return { $, handlers, posts, beat: () => timer?.() };
}
const flush = () => new Promise((r) => setTimeout(r, 20));
describe('office mod', () => {
  it('posts start/tool/state/end with short details only', async () => {
    const f = fakeEngine(); register(f.$); await flush();
    expect(f.posts[0]).toMatchObject({ url: 'http://127.0.0.1:7777/event', type: 'heartbeat', sid: 'sess-1234', root: '/home/m/proj', project: 'proj', costUsd: 0.42, ct: 'application/json' });
    f.handlers.UserPromptSubmit({ prompt: 'Fix the login bug. Then add tests.', cwd: '/home/m/proj/sub' });
    f.handlers.PreToolUse({ tool_name: 'Write', tool_input: { file_path: '/home/m/proj/src/secret.ts', content: 'API_KEY=abc' } });
    f.handlers.PreToolUse({ tool_name: 'Bash', tool_input: { command: 'npm test\nrm -rf /' } });
    f.handlers.PostToolUse({});
    f.handlers.Stop({}); await flush();
    f.handlers.SessionEnd({});
    const s = JSON.stringify(f.posts);
    expect(s).not.toContain('API_KEY'); expect(s).not.toContain('rm -rf');
    expect(f.posts.map((p) => [p.type, p.state, p.tool?.name, p.tool?.detail])).toEqual([
      ['heartbeat', 'idle', undefined, undefined], ['state', 'thinking', undefined, undefined], ['tool', 'tool', 'Write', 'secret.ts'], ['tool', 'tool', 'Bash', 'npm test'],
      ['state', 'thinking', undefined, undefined], ['state', 'done', undefined, undefined], ['end', undefined, undefined, undefined]]);
    expect(f.posts[1]).toMatchObject({ prompt: 'Fix the login bug.', subagents: [{ type: 'coder', status: 'running' }] });
    f.beat(); expect(f.posts).toHaveLength(7); // heartbeat stopped after end
  });
  it('skips non-loopback endpoints and survives a bare engine', () => {
    const f = fakeEngine(); (f.$ as any).config = { get: () => 'https://evil.example/event' }; register(f.$); expect(f.posts).toHaveLength(0);
    expect(() => register({})).not.toThrow();
  });
  it('helpers', () => {
    expect(toolDetail('Read', { file_path: 'C:\\a\\b\\x.md' })).toBe('x.md');
    expect(toolDetail('WebFetch', { url: 'https://docs.example.com/a?token=1' })).toBe('docs.example.com');
    expect(transcriptPath('/c', 'C:\\Users\\Manh\\proj', 's')).toBe('/c/projects/C--Users-Manh-proj/s.jsonl');
    expect(titleFromJsonl('{"type":"ai-title","aiTitle":"A"}\n{"type":"custom-title","customTitle":"B"}\n{"type":"ai-title","aiTitle":"C"}')).toBe('B');
    expect(titleFromJsonl('{"type":"ai-title","aiTitle":"A"}')).toBe('A');
  });
});
