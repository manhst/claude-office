import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClaudeConfig, IN_SESSION, buildEntry, claudePaths, configKey, entryHash, findClaude, run, which } from '../src/claudeConfig.js';
import { probeMcp } from '../src/mcpProbe.js';
import type { ClaudeConfigView, McpServerView } from '../src/types.js';

const FAKE = fileURLToPath(new URL('./fake/mcp-stdio.mjs', import.meta.url)), NODE = process.execPath, TOKEN = 'ghp_abcdefghijklmnopqrstuvwx1234';
const json = (f: string) => JSON.parse(readFileSync(f, 'utf8'));
const save = (f: string, v: unknown) => writeFileSync(f, `${JSON.stringify(v, null, 2)}\n`);
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** temp ~/.claude.json (user + 3 projects), proj-a/.mcp.json, settings.json; the fake claude CLI writes the same temp files */
function world(extraEnv: NodeJS.ProcessEnv = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'office-ccw-'))), claudeJson = join(dir, '.claude.json'), settings = join(dir, 'settings.json'), runDir = join(dir, 'run');
  const pA = join(dir, 'proj-a'), pB = join(dir, 'proj-b'), gone = join(dir, 'gone'), log = join(dir, 'cli.log'); mkdirSync(pA); mkdirSync(pB);
  save(claudeJson, {
    numStartups: 7, mcpServers: {
      gh: { type: 'stdio', command: NODE, args: [FAKE], env: { GITHUB_TOKEN: TOKEN, PLAIN: 'shop_dev', URLISH: 'https://x.example/?token=abcdef', FAKE_TOOL: 'stored-tool',
        DB_URL: 'postgres://app:pw0rd@db.example:5432/shop', API: 'https://x.example/v1?api_key=k1', PAGE: 'https://x.example/v1?page=2', DB_NOPW: 'postgres://app@db.example/shop' } },
      web: { type: 'http', url: 'https://h.example/mcp', headers: { Authorization: 'Bearer abcdefghijklmnop', 'X-Env': 'stg' }, timeout: 5000, oauth: { clientId: 'c1' } },
      odd: { type: 'https', url: 'https://odd.example' }, nocmd: { type: 'stdio', args: [] }, missing: { command: '/definitely/not/here/bin' }, nourl: { type: 'sse' },
      'my.server': { type: 'stdio', command: 'node', args: [], env: {} },
    },
    projects: {
      [pA]: { mcpServers: { gh: { type: 'stdio', command: NODE, args: [FAKE], env: {} } }, enabledMcpjsonServers: ['pj1'], disabledMcpjsonServers: ['pj2'], hasTrustDialogAccepted: true, allowedTools: ['a', 'b'], lastSessionId: 's-1', lastCost: 2.5, other: 1 },
      [pB]: { mcpServers: {} }, [gone]: { mcpServers: { old: { command: 'node' } } },
    },
  });
  save(join(pA, '.mcp.json'), { mcpServers: { pj1: { command: NODE, args: [FAKE] }, pj2: { command: 'node' }, pj3: { command: NODE, args: [FAKE, '${HOME}'] }, gh: { command: 'node' } } });
  save(settings, { permissions: {}, mcpServers: { cursor1: { type: 'http', url: 'https://c.example/mcp', headers: { 'X-Api-Key': 'k-123' } }, 'draw.io': { command: 'node' } } });
  const env = { ...process.env, OFFICE_CLAUDE_JSON: claudeJson, FAKE_CLAUDE_LOG: log, ...extraEnv };
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
  return { dir, claudeJson, settings, runDir, pA, pB, gone, calls, cfg: new ClaudeConfig({ claudeJson, settings, runDir, env, home: dir }) };
}
const find = (v: ClaudeConfigView, scope: string, name: string, project?: string) => v.servers.find((s) => s.scope === scope && s.name === name && s.project === project)!;
const post = async (cfg: ClaudeConfig, op: string, body: unknown, signal?: AbortSignal) => { const r = await cfg.post(op, body, signal); return { status: r.status, body: r.body as any }; };
const ref = (s: McpServerView) => ({ scope: s.scope, name: s.name, ...(s.project ? { project: s.project } : {}) });
const edit = (s: McpServerView, server: unknown, extra: object = {}) => ({ target: ref(s), original: { ...ref(s), hash: s.hash }, server, ...extra });

describe('claude config: paths, CLI and helpers', () => {
  it('refuses the real files and the real CLI under vitest', () => {
    expect(() => claudePaths({ VITEST: 'true' })).toThrow(/OFFICE_CLAUDE_JSON/);
    expect(() => claudePaths({ VITEST: 'true', OFFICE_CLAUDE_JSON: '/tmp/x.json', OFFICE_CLAUDE_SETTINGS: join(process.env.HOME ?? '', '.claude', 'settings.json') })).toThrow();
    expect(claudePaths(process.env).claudeJson).toBe(process.env.OFFICE_CLAUDE_JSON);
    expect(findClaude({ VITEST: 'true', PATH: process.env.PATH })).toEqual({ error: expect.stringContaining('never run the real') });
    expect(findClaude({ OFFICE_CLAUDE_BIN: '/nope/claude' }).error).toBeDefined();
  });
  it('run() never throws, even when spawn does; which() skips relative PATH entries', async () => {
    expect(await run('bad\0bin', [])).toMatchObject({ code: null, error: expect.any(String) });
    const d = mkdtempSync(join(tmpdir(), 'office-which-')); writeFileSync(join(d, 'office-which-probe'), '');
    expect(which('office-which-probe', d)).toBe(join(d, 'office-which-probe'));
    expect(which('office-which-probe', relative(process.cwd(), d))).toBeUndefined();
  });
  it('configKey: git root of the real path, a worktree resolves to its main repo', async () => {
    const d = realpathSync(mkdtempSync(join(tmpdir(), 'office-git-'))), repo = join(d, 'repo'), sub = join(repo, 'sub'), wt = join(d, 'wt');
    mkdirSync(join(repo, '.git', 'worktrees', 'wt'), { recursive: true }); mkdirSync(sub); mkdirSync(wt);
    writeFileSync(join(repo, '.git', 'worktrees', 'wt', 'commondir'), '../..\n'); writeFileSync(join(wt, '.git'), `gitdir: ${join(repo, '.git', 'worktrees', 'wt')}\n`);
    expect([await configKey(sub), await configKey(repo), await configKey(wt), await configKey(d)]).toEqual([repo, repo, repo, d]);
  });
});
describe('claude config: view', () => {
  it('lists every scope in order with masking, extra keys, shadowing, approval, warnings, hashes and projects', async () => {
    const w = world(), v = await w.cfg.view();
    expect(v).toMatchObject({ writable: true, cli: { version: '9.9.9' }, files: { claudeJson: w.claudeJson, settings: w.settings } });
    expect(v.servers.map((s) => `${s.scope}:${s.name}${s.project === w.pA ? '@a' : s.project === w.gone ? '@gone' : ''}`)).toEqual([
      'user:gh', 'user:missing', 'user:my.server', 'user:nocmd', 'user:nourl', 'user:odd', 'user:web', 'local:gh@a', 'local:old@gone',
      'project:gh@a', 'project:pj1@a', 'project:pj2@a', 'project:pj3@a', 'settings:cursor1', 'settings:draw.io']);
    const gh = find(v, 'user', 'gh');
    expect(gh.env).toEqual([{ key: 'GITHUB_TOKEN', masked: true }, { key: 'PLAIN', value: 'shop_dev' }, { key: 'URLISH', masked: true }, { key: 'FAKE_TOOL', value: 'stored-tool' },
      { key: 'DB_URL', masked: true }, { key: 'API', masked: true }, { key: 'PAGE', value: 'https://x.example/v1?page=2' }, { key: 'DB_NOPW', value: 'postgres://app@db.example/shop' }]);
    for (const secret of [TOKEN, 'abcdefghijklmnop', 'pw0rd', 'api_key=k1']) expect(JSON.stringify(v)).not.toContain(secret);
    expect(gh).toMatchObject({ type: 'stdio', command: NODE, args: [FAKE], shadowedBy: { scope: 'local', project: w.pA }, warnings: [], readOnly: false, file: w.claudeJson, hash: entryHash(json(w.claudeJson).mcpServers.gh) });
    expect(find(v, 'user', 'web')).toMatchObject({ headers: [{ key: 'Authorization', masked: true }, { key: 'X-Env', value: 'stg' }], extraKeys: ['timeout', 'oauth'] });
    expect(find(v, 'project', 'gh', w.pA)).toMatchObject({ shadowedBy: { scope: 'local', project: w.pA }, file: join(w.pA, '.mcp.json'), approval: 'pending' });
    expect(['pj1', 'pj2', 'pj3'].map((n) => find(v, 'project', n, w.pA).approval)).toEqual(['enabled', 'disabled', 'pending']);
    expect(find(v, 'local', 'gh', w.pA).shadowedBy).toBeUndefined();
    expect(find(v, 'user', 'odd').warnings).toEqual(['unknown type "https"']);
    expect(find(v, 'user', 'nocmd').warnings).toEqual(['stdio server without a command']);
    expect(find(v, 'user', 'missing').warnings).toEqual(['command not found: /definitely/not/here/bin']);
    expect(find(v, 'user', 'nourl').warnings).toEqual(['sse server without a url']);
    expect(find(v, 'settings', 'cursor1')).toMatchObject({ readOnly: true, warnings: ['not loaded by Claude Code; clone to user/local/project to use it'], headers: [{ key: 'X-Api-Key', masked: true }] });
    expect(v.projects).toEqual([
      { path: w.gone, exists: false, localServers: 1, hasMcpJson: false, trusted: false, allowedTools: 0 },
      { path: w.pA, exists: true, localServers: 1, hasMcpJson: true, trusted: true, allowedTools: 2, lastSessionId: 's-1', lastCost: 2.5 },
      { path: w.pB, exists: true, localServers: 0, hasMcpJson: false, trusted: false, allowedTools: 0 },
    ]);
  });
  it('read-only without a CLI, with config overrides but no OFFICE_CLAUDE_BIN, and in demo mode', async () => {
    const w = world({ OFFICE_CLAUDE_BIN: join(tmpdir(), 'no-such-claude') }), v = await w.cfg.view();
    expect(v.writable).toBe(false); expect(v.cli.error).toBeDefined(); expect(v.servers.every((s) => s.readOnly)).toBe(true);
    expect(await post(w.cfg, 'save', {})).toEqual({ status: 503, body: { error: 'read-only', reason: expect.stringContaining('OFFICE_CLAUDE_BIN') } });
    const split = new ClaudeConfig({ claudeJson: w.claudeJson, settings: w.settings, runDir: w.runDir, env: { ...process.env, OFFICE_CLAUDE_JSON: w.claudeJson, OFFICE_CLAUDE_BIN: '' } });
    expect((await split.view())).toMatchObject({ writable: false, cli: { error: expect.stringContaining('different files') } });
    const demo = new ClaudeConfig({ claudeJson: w.claudeJson, settings: w.settings, runDir: w.runDir, demo: true });
    expect((await demo.view()).writable).toBe(false);
    expect(await post(demo, 'delete', {})).toMatchObject({ status: 503, body: { reason: 'demo mode' } });
    expect((await post(demo, 'test', { ref: { scope: 'user', name: 'gh' } })).body).toMatchObject({ ok: false, error: expect.stringContaining('demo') });
    expect((await post(demo, 'reveal', { scope: 'user', name: 'gh', field: 'env', key: 'PLAIN' })).body).toEqual({ value: 'shop_dev' });
  });
});
describe('claude config: save', () => {
  const stdio = (env: unknown[] = []) => ({ type: 'stdio', command: 'node', args: ['s.js'], env });
  it('creates through `claude mcp add-json`, backs up first (mode 600), 409 on a duplicate name', async () => {
    const w = world(), r = await post(w.cfg, 'save', { target: { scope: 'user', name: 'new-one' }, server: stdio([{ key: 'A', value: '1' }]) });
    expect(r.status).toBe(200); expect(r.body.ok).toBe(true);
    expect(json(w.claudeJson).mcpServers['new-one']).toEqual({ type: 'stdio', command: 'node', args: ['s.js'], env: { A: '1' } });
    expect(json(w.claudeJson).numStartups).toBe(7); // the rest of the file is untouched
    expect(find(r.body.view, 'user', 'new-one')).toBeDefined();
    expect(r.body.backup).toMatch(/claude-config-backups[\\/].+-\.claude\.json$/); expect(json(r.body.backup).mcpServers['new-one']).toBeUndefined();
    if (process.platform !== 'win32') expect(statSync(r.body.backup).mode & 0o777).toBe(0o600);
    expect(w.calls().map((c) => `${c.op} ${c.scope} ${c.name}`)).toEqual(['add-json user new-one']);
    expect((await post(w.cfg, 'save', { target: { scope: 'user', name: 'new-one' }, server: stdio() })).status).toBe(409);
    expect((await post(w.cfg, 'save', { target: { scope: 'local', project: w.pA, name: 'gh' }, server: stdio() })).body).toEqual({ error: 'exists' });
  });
  it('edits in place: proves the new JSON under a temp name, then remove + add-json; keep values and extra keys; 409 when the file changed', async () => {
    const w = world(), web = find(await w.cfg.view(), 'user', 'web');
    const server = { type: 'http', url: 'https://h2.example/mcp', headers: [{ key: 'Authorization', keep: true }, { key: 'X-Env', value: 'prd' }] };
    const r = await post(w.cfg, 'save', edit(web, server));
    expect(r.status).toBe(200);
    const want = { type: 'http', url: 'https://h2.example/mcp', headers: { Authorization: 'Bearer abcdefghijklmnop', 'X-Env': 'prd' }, timeout: 5000, oauth: { clientId: 'c1' } };
    expect(json(w.claudeJson).mcpServers.web).toEqual(want);
    const c = w.calls(); expect(c.map((x) => `${x.op}:${x.name.replace(/__office_tmp_[0-9a-f]+$/, '__tmp')}`)).toEqual(['add-json:web__tmp', 'remove:web__tmp', 'remove:web', 'add-json:web']);
    expect(JSON.parse(c[0].input)).toEqual(want); expect(Object.keys(json(w.claudeJson).mcpServers).some((n) => n.includes('office_tmp'))).toBe(false);
    expect((await post(w.cfg, 'save', edit(web, server))).body).toEqual({ error: 'changed' }); // stale hash
    const fresh = find(await w.cfg.view(), 'user', 'web'), cj = json(w.claudeJson); cj.mcpServers.web.url = 'https://changed.example'; save(w.claudeJson, cj);
    expect((await post(w.cfg, 'save', edit(fresh, server))).status).toBe(409);
  });
  it('a refusal at the proof step changes nothing (session marker the office does not check itself)', async () => {
    const w = world({ FAKE_CLAUDE_SESSION: '1' }), web = find(await w.cfg.view(), 'user', 'web'), before = json(w.claudeJson).mcpServers.web;
    const r = await post(w.cfg, 'save', edit(web, { type: 'http', url: 'https://x.example' }));
    expect(r).toEqual({ status: 500, body: { error: `claude mcp add-json failed (nothing was changed): ${IN_SESSION}`, backup: expect.any(String) } });
    expect(json(w.claudeJson).mcpServers.web).toEqual(before); expect(w.calls().map((c) => c.op)).toEqual(['add-json']);
    expect(await w.cfg.view()).toMatchObject({ writable: false, cli: { error: IN_SESSION } }); // stays read-only
    expect((await post(w.cfg, 'save', { target: { scope: 'user', name: 'n2' }, server: { type: 'http', url: 'https://n.example' } })).status).toBe(503);
  });
  it('restores the original when the final add-json fails, and reports the CLI error', async () => {
    const flag = join(tmpdir(), `office-fail-${Date.now()}`); writeFileSync(flag, '1');
    const w = world({ FAKE_CLAUDE_FAIL: `add-json|web|${flag}` }), web = find(await w.cfg.view(), 'user', 'web'), before = json(w.claudeJson).mcpServers.web;
    const r = await post(w.cfg, 'save', edit(web, { type: 'http', url: 'https://other.example' }));
    expect(r).toEqual({ status: 500, body: { error: expect.stringMatching(/injected failure for add-json web.*original entry was restored/), backup: expect.any(String) } });
    expect(json(w.claudeJson).mcpServers.web).toEqual(before);
    expect(w.calls().map((c) => c.op)).toEqual(['add-json', 'remove', 'remove', 'add-json', 'add-json']);
  });
  it('names: the CLI rule for new names; an existing odd name must be renamed (rename/move/delete still work)', async () => {
    const w = world(), v = await w.cfg.view(), odd = find(v, 'user', 'my.server'), stdio2 = { type: 'stdio', command: 'node' };
    expect(await post(w.cfg, 'save', edit(odd, stdio2))).toEqual({ status: 400, body: { error: expect.stringContaining('rename it') } });
    expect((await post(w.cfg, 'save', { target: { scope: 'user', name: 'draw.io' }, cloneFrom: ref(find(v, 'settings', 'draw.io')), server: stdio2 })).status).toBe(400);
    expect((await post(w.cfg, 'save', { target: { scope: 'user', name: 'draw-io' }, cloneFrom: ref(find(v, 'settings', 'draw.io')), server: stdio2 })).status).toBe(200);
    const r = await post(w.cfg, 'save', { target: { scope: 'user', name: 'my-server' }, original: { ...ref(odd), hash: odd.hash }, server: stdio2 });
    expect(r.status).toBe(200); expect(Object.keys(json(w.claudeJson).mcpServers)).toEqual(expect.arrayContaining(['my-server'])); expect(json(w.claudeJson).mcpServers['my.server']).toBeUndefined();
    const cj = json(w.claudeJson); cj.mcpServers['x.y'] = { command: 'node' }; save(w.claudeJson, cj);
    const xy = find(await w.cfg.view(), 'user', 'x.y'); expect((await post(w.cfg, 'delete', { ...ref(xy), hash: xy.hash })).status).toBe(200);
  });
  it('renames and moves scopes (add-json first, then remove); clone with keep values; project scope asks before writing secrets', async () => {
    const w = world(); let v = await w.cfg.view();
    const gh = find(v, 'user', 'gh'), keepAll = [{ key: 'GITHUB_TOKEN', keep: true }, { key: 'PLAIN', keep: true }];
    let r = await post(w.cfg, 'save', { target: { scope: 'user', name: 'gh2' }, original: { ...ref(gh), hash: gh.hash }, server: { type: 'stdio', command: NODE, args: [FAKE], env: keepAll } });
    expect(r.status).toBe(200); expect(w.calls().map((c) => `${c.op}:${c.name}`)).toEqual(['add-json:gh2', 'remove:gh']);
    expect(json(w.claudeJson).mcpServers.gh).toBeUndefined(); expect(json(w.claudeJson).mcpServers.gh2.env).toEqual({ GITHUB_TOKEN: TOKEN, PLAIN: 'shop_dev' });
    v = r.body.view; const web = find(v, 'user', 'web'), move = { target: { scope: 'project', project: w.pB, name: 'web' }, original: { ...ref(web), hash: web.hash }, server: { type: 'http', url: 'https://h.example/mcp', headers: [{ key: 'Authorization', keep: true }] } };
    expect(await post(w.cfg, 'save', move)).toEqual({ status: 400, body: { error: 'confirm-required', reason: `${join(w.pB, '.mcp.json')} is usually committed to git; this would write Authorization into it` } });
    r = await post(w.cfg, 'save', { ...move, confirmProjectSecrets: true });
    expect(r.status).toBe(200);
    expect(json(join(w.pB, '.mcp.json')).mcpServers.web).toEqual({ type: 'http', url: 'https://h.example/mcp', headers: { Authorization: 'Bearer abcdefghijklmnop' }, timeout: 5000, oauth: { clientId: 'c1' } });
    expect(json(w.claudeJson).mcpServers.web).toBeUndefined(); expect(find(r.body.view, 'project', 'web', w.pB).approval).toBe('pending');
    const pt = (env: unknown[]) => post(w.cfg, 'save', { target: { scope: 'project', project: w.pB, name: `p${env.length}${Math.random().toString(36).slice(2, 6)}` }, server: { type: 'stdio', command: 'node', env } });
    expect((await pt([{ key: 'MODE', value: 'dev' }])).status).toBe(200);
    expect((await pt([{ key: 'DB', value: 'postgres://u:secretpw@h/db' }])).body).toMatchObject({ error: 'confirm-required', reason: expect.stringContaining('DB') });
    const c1 = find(r.body.view, 'settings', 'cursor1');
    r = await post(w.cfg, 'save', { target: { scope: 'local', project: w.pA, name: 'cursor1' }, cloneFrom: ref(c1), server: { type: 'http', url: 'https://c.example/mcp', headers: [{ key: 'X-Api-Key', keep: true }] } });
    expect(r.status).toBe(200); expect(json(w.claudeJson).projects[w.pA].mcpServers.cursor1).toEqual({ type: 'http', url: 'https://c.example/mcp', headers: { 'X-Api-Key': 'k-123' } });
    expect(json(w.settings).mcpServers.cursor1).toBeDefined(); // settings.json is never written
    expect((await post(w.cfg, 'save', { target: { scope: 'user', name: 'c2' }, cloneFrom: ref(c1), server: { type: 'http', url: 'https://c.example', headers: [{ key: 'Other', keep: true }] } })).status).toBe(400);
    expect((await post(w.cfg, 'save', { target: { scope: 'user', name: 'c3' }, cloneFrom: { scope: 'user', name: 'nope' }, server: { type: 'http', url: 'https://c.example' } })).status).toBe(404);
  });
  it('verifies after every write: a CLI that claims success but stores something else, or removes nothing, gives 500 with the backup', async () => {
    const w = world({ FAKE_CLAUDE_MANGLE: 'mg' });
    expect(await post(w.cfg, 'save', { target: { scope: 'user', name: 'mg' }, server: stdio() })).toEqual({ status: 500, body: { error: expect.stringContaining('mg (user) was not stored as sent'), backup: expect.any(String) } });
    const k = world({ FAKE_CLAUDE_KEEP: 'web' }), web = find(await k.cfg.view(), 'user', 'web');
    expect(await post(k.cfg, 'delete', { ...ref(web), hash: web.hash })).toEqual({ status: 500, body: { error: expect.stringContaining('web (user) is still there'), backup: expect.any(String) } });
    expect((await post(k.cfg, 'save', { target: { scope: 'user', name: 'web2' }, original: { ...ref(web), hash: web.hash }, server: { type: 'http', url: 'https://w.example' } })).body.error).toContain('web (user) is still there');
  });
  it('keeps the newest 30 saves (grouped by time), copies the affected .mcp.json under a short hashed name', async () => {
    const w = world(), dir = join(w.runDir, 'claude-config-backups'); mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 35; i++) for (const f of ['.claude.json', '0123456789ab-.mcp.json']) writeFileSync(join(dir, `2000-01-01T00-00-${String(i).padStart(2, '0')}-000Z-${f}`), '{}');
    const deep = join(w.dir, 'a'.repeat(120), 'b'.repeat(120), 'c'.repeat(120)); mkdirSync(deep, { recursive: true }); save(join(deep, '.mcp.json'), { mcpServers: { dp: { command: 'node' } } });
    const cj = json(w.claudeJson); cj.projects[deep] = {}; save(w.claudeJson, cj);
    const dp = find(await w.cfg.view(), 'project', 'dp', deep), r = await post(w.cfg, 'delete', { ...ref(dp), hash: dp.hash });
    expect(r.status).toBe(200); const files = readdirSync(dir).sort(), mine = files.filter((f) => !f.startsWith('2000'));
    expect(files).toHaveLength(60); expect(mine).toHaveLength(2); expect(mine.find((f) => /-[0-9a-f]{12}-\.mcp\.json$/.test(f))!.length).toBeLessThan(60);
    expect(files.filter((f) => f.startsWith('2000-01-01T00-00-05'))).toHaveLength(0); expect(files.filter((f) => f.startsWith('2000-01-01T00-00-06'))).toHaveLength(2); // whole saves dropped
  });
  it.skipIf(process.platform === 'win32')('local writes must use the key the CLI computes (git root, real path, worktree → main repo); project scope must be a real path', async () => {
    const w = world(), link = join(w.dir, 'link-a'), repo = join(w.dir, 'repo'), sub = join(repo, 'sub'), wt = join(w.dir, 'wt'), stdio2 = { type: 'stdio', command: 'node' };
    symlinkSync(w.pA, link, 'dir'); mkdirSync(join(repo, '.git', 'worktrees', 'wt'), { recursive: true }); mkdirSync(sub); mkdirSync(wt);
    writeFileSync(join(repo, '.git', 'worktrees', 'wt', 'commondir'), '../..'); writeFileSync(join(wt, '.git'), `gitdir: ${join(repo, '.git', 'worktrees', 'wt')}`);
    const cj = json(w.claudeJson); for (const p of [link, repo, sub, wt]) cj.projects[p] = { mcpServers: { s1: { command: 'node' } } }; save(w.claudeJson, cj);
    const v = await w.cfg.view();
    for (const [p, key] of [[link, w.pA], [sub, repo], [wt, repo]]) {
      expect(await post(w.cfg, 'save', { target: { scope: 'local', project: p, name: 'x' }, server: stdio2 })).toEqual({ status: 400, body: { error: expect.stringContaining(`under ${key}`) } });
      const s1 = find(v, 'local', 's1', p); expect((await post(w.cfg, 'delete', { ...ref(s1), hash: s1.hash })).body.error).toContain(`under ${key}`);
      expect((await post(w.cfg, 'save', { target: { scope: 'user', name: 's1' }, original: { ...ref(s1), hash: s1.hash }, server: stdio2 })).status).toBe(400);
    }
    expect((await post(w.cfg, 'save', { target: { scope: 'project', project: link, name: 'x' }, server: stdio2 })).body.error).toContain(`resolves to ${w.pA}`);
    expect(w.calls()).toEqual([]);
    expect((await post(w.cfg, 'save', { target: { scope: 'local', project: repo, name: 'x' }, server: stdio2 })).status).toBe(200);
    expect((await post(w.cfg, 'save', { target: { scope: 'project', project: wt, name: 'x' }, server: stdio2 })).status).toBe(200); // .mcp.json lives in the cwd itself
  });
  it('validates the request (400s)', async () => {
    const w = world(), ok = stdio(), cases: unknown[] = [
      { target: { scope: 'user', name: 'a/b' }, server: ok }, { target: { scope: 'user', name: '' }, server: ok }, { target: { scope: 'user', name: 'x'.repeat(65) }, server: ok },
      { target: { scope: 'user', name: '-x' }, server: ok }, { target: { scope: 'user', name: 'q"t' }, server: ok }, { target: { scope: 'user', name: 'tab\there' }, server: ok },
      { target: { scope: 'user', name: 'a.b' }, server: ok }, { target: { scope: 'user', name: 'sp ace' }, server: ok }, { target: { scope: 'user', name: 'ü' }, server: ok },
      { target: { scope: 'settings', name: 'a' }, server: ok }, { target: { scope: 'local', name: 'a' }, server: ok }, { target: { scope: 'local', project: '/not/known', name: 'a' }, server: ok },
      { target: { scope: 'project', project: w.gone, name: 'a' }, server: ok }, { target: { scope: 'user', name: 'a' } }, { target: { scope: 'user', name: 'a' }, server: { command: 'x' } },
      { target: { scope: 'user', name: 'a' }, server: { type: 'stdio' } }, { target: { scope: 'user', name: 'a' }, server: { type: 'http', url: 'ftp://x' } }, { target: { scope: 'user', name: 'a' }, server: { type: 'sse' } },
      { target: { scope: 'user', name: 'a' }, server: { ...ok, env: [{ key: 'A', value: '1' }, { key: 'A', value: '2' }] } }, { target: { scope: 'user', name: 'a' }, server: { ...ok, env: [{ key: '', value: '1' }] } },
      { target: { scope: 'user', name: 'a' }, server: { type: 'http', url: 'https://x', headers: [{ key: 'Bad Header', value: '1' }] } },
      { target: { scope: 'user', name: 'a' }, server: { type: 'http', url: 'https://x', headers: [{ key: 'A', value: '1' }, { key: 'a', value: '2' }] } },
      { target: { scope: 'user', name: 'a' }, server: { type: 'http', url: 'https://x', headers: [{ key: 'A', value: 'x\r\nInjected: 1' }] } },
      { target: { scope: 'user', name: 'a' }, server: { ...ok, env: [{ key: 'A', value: 'x\0y' }] } }, { target: { scope: 'user', name: 'a' }, server: { ...ok, command: 'no\0de' } },
      { target: { scope: 'user', name: 'a' }, server: { type: 'http', url: 'https://x\0' } },
      { target: { scope: 'user', name: 'a' }, server: { ...ok, env: [{ key: 'A', keep: true }] } }, { target: { scope: 'user', name: 'a' }, server: { ...ok, env: [{ key: 'A' }] } },
      { target: { scope: 'user', name: 'a' }, server: { ...ok, args: [1] } }, { target: { scope: 'user', name: 'a' }, server: ok, original: { scope: 'user', name: 'gh' } },
      { target: { scope: 'user', name: 'a' }, server: ok, original: { scope: 'user', name: 'gh', hash: 'x' }, cloneFrom: { scope: 'user', name: 'web' } },
    ];
    for (const c of cases) expect([JSON.stringify(c), (await post(w.cfg, 'save', c)).status]).toEqual([JSON.stringify(c), 400]);
    expect(w.calls()).toEqual([]);
    expect(buildEntry({ type: 'ws', url: 'wss://x.example' })).toEqual({ type: 'ws', url: 'wss://x.example' });
  });
});
describe('claude config: delete and reveal', () => {
  it('deletes with a hash check; settings entries are read-only', async () => {
    const w = world(), v = await w.cfg.view(), loc = find(v, 'local', 'gh', w.pA);
    expect((await post(w.cfg, 'delete', { ...ref(loc), hash: 'stale' })).body).toEqual({ error: 'changed' });
    expect((await post(w.cfg, 'delete', { scope: 'settings', name: 'cursor1', hash: 'x' })).status).toBe(400);
    expect((await post(w.cfg, 'delete', { scope: 'local', name: 'gh' })).status).toBe(400);
    const r = await post(w.cfg, 'delete', { ...ref(loc), hash: loc.hash });
    expect(r.status).toBe(200); expect(json(w.claudeJson).projects[w.pA].mcpServers.gh).toBeUndefined(); expect(json(w.claudeJson).projects[w.pA].other).toBe(1);
    expect(w.calls()).toEqual([expect.objectContaining({ op: 'remove', scope: 'local', name: 'gh', cwd: w.pA })]);
    expect(find(r.body.view, 'user', 'gh').shadowedBy).toEqual({ scope: 'project', project: w.pA });
    expect((await post(w.cfg, 'delete', { ...ref(loc), hash: loc.hash })).status).toBe(409);
  });
  it('reveals stored env/header values (any scope); 404 when missing', async () => {
    const w = world();
    expect((await post(w.cfg, 'reveal', { scope: 'user', name: 'gh', field: 'env', key: 'GITHUB_TOKEN' })).body).toEqual({ value: TOKEN });
    expect((await post(w.cfg, 'reveal', { scope: 'settings', name: 'cursor1', field: 'headers', key: 'X-Api-Key' })).body).toEqual({ value: 'k-123' });
    expect((await post(w.cfg, 'reveal', { scope: 'user', name: 'gh', field: 'env', key: 'NOPE' })).status).toBe(404);
    expect((await post(w.cfg, 'reveal', { scope: 'user', name: 'nope', field: 'env', key: 'A' })).status).toBe(404);
    expect((await post(w.cfg, 'reveal', { scope: 'user', name: 'gh', field: 'args', key: 'A' })).status).toBe(400);
    expect((await post(w.cfg, 'nope', {})).status).toBe(404);
  });
});
describe('claude config: real CLI facts', () => {
  const server = { type: 'http', url: 'https://n.example/mcp' };
  it('inside a Claude Code session (CLAUDE_CODE_CHILD_SESSION / CLAUDECODE / CLAUDE_CODE_SESSION_ID) the tab is read-only, nothing is spawned', async () => {
    for (const marker of [{ CLAUDE_CODE_CHILD_SESSION: '1' }, { CLAUDECODE: '1' }, { CLAUDE_CODE_SESSION_ID: 'abc' }]) {
      const w = world(marker), v = await w.cfg.view();
      expect(v).toMatchObject({ writable: false, cli: { path: process.env.OFFICE_CLAUDE_BIN, error: IN_SESSION } }); expect(v.cli.version).toBeUndefined();
      expect(v.servers.every((x) => x.readOnly)).toBe(true);
      expect(await post(w.cfg, 'save', { target: { scope: 'user', name: 'n' }, server })).toEqual({ status: 503, body: { error: 'read-only', reason: IN_SESSION } });
      expect(w.calls()).toEqual([]);
    }
  });
  it('the fake CLI refuses stdin JSON inside a session and bad names, like the real one', async () => {
    const w = world(), go = (env: NodeJS.ProcessEnv, name = 'x') => run(process.env.OFFICE_CLAUDE_BIN!, ['mcp', 'add-json', '-s', 'user', name, '-'], { input: '{"command":"node"}', env: { ...process.env, OFFICE_CLAUDE_JSON: w.claudeJson, ...env } });
    for (const marker of [{ CLAUDECODE: '1' }, { CLAUDE_CODE_CHILD_SESSION: '1' }]) { const r = await go(marker); expect(r.code).toBe(1); expect(r.stderr).toMatch(/refused inside a Claude Code session/); }
    expect((await go({}, 'a.b')).stderr).toMatch(/Names can only contain letters, numbers, hyphens, and underscores/);
    expect(json(w.claudeJson).mcpServers.x).toBeUndefined();
  });
  it('accepts streamable-http in the view and on save; https is rejected on save', async () => {
    const w = world(), cj = json(w.claudeJson); cj.mcpServers.sh = { type: 'streamable-http', url: 'https://sh.example/mcp' }; save(w.claudeJson, cj);
    expect(find(await w.cfg.view(), 'user', 'sh').warnings).toEqual([]);
    expect((await post(w.cfg, 'save', { target: { scope: 'user', name: 'sh2' }, server: { type: 'streamable-http', url: 'https://sh2.example/mcp' } })).status).toBe(200);
    expect(json(w.claudeJson).mcpServers.sh2).toEqual({ type: 'streamable-http', url: 'https://sh2.example/mcp' });
    expect(await post(w.cfg, 'save', { target: { scope: 'user', name: 'h' }, server: { type: 'https', url: 'https://h.example' } })).toEqual({ status: 400, body: { error: 'type must be stdio | http | streamable-http | sse | ws' } });
    expect(buildEntry({ type: 'streamable-http', url: 'ws://x' })).toBe('streamable-http needs an http(s) url');
  });
});
describe('claude config: test probe', () => {
  it('stdio: initialize + tools/list over newline JSON, env and cwd applied, stderr redacted, process group killed', async () => {
    const w = world(), pidFile = join(w.dir, 'child.pid'), cj = json(w.claudeJson);
    cj.projects[w.pA].mcpServers.gh.env = { FAKE_MCP_CHILD_PID_FILE: pidFile }; save(w.claudeJson, cj);
    const r = (await post(w.cfg, 'test', { ref: { scope: 'user', name: 'gh' } })).body;
    expect(r).toMatchObject({ ok: true, server: { name: 'fake-mcp', version: '1.2.3' }, tools: ['echo', 'stored-tool', 'page2'] });
    expect(r.ms).toBeGreaterThanOrEqual(0); expect(r.stderr).toContain('[REDACTED]'); expect(r.stderr).not.toContain('sk-aaaa'); expect(r.stderr).toContain(`cwd=${w.dir}`);
    const l = (await post(w.cfg, 'test', { ref: { scope: 'local', project: w.pA, name: 'gh' } })).body;
    expect(l).toMatchObject({ ok: true, tools: ['echo', 'add', 'page2'] }); expect(l.stderr).toContain(`cwd=${w.pA}`);
    const pid = Number(readFileSync(pidFile, 'utf8')); await tick(300);
    if (process.platform !== 'win32') expect(() => process.kill(pid, 0)).toThrow();
    const draft = (await post(w.cfg, 'test', { server: { type: 'stdio', command: NODE, args: [FAKE], env: [{ key: 'FAKE_TOOL', keep: true }] }, from: { scope: 'user', name: 'gh' }, project: w.pB })).body;
    expect(draft).toMatchObject({ ok: true, tools: ['echo', 'stored-tool', 'page2'] }); expect(draft.stderr).toContain(`cwd=${w.pB}`);
    expect((await post(w.cfg, 'test', { server: { type: 'stdio', command: NODE, env: [{ key: 'X', keep: true }] } })).status).toBe(400);
    expect((await post(w.cfg, 'test', { ref: { scope: 'user', name: 'nope' } })).status).toBe(404);
    expect((await post(w.cfg, 'test', { ref: { scope: 'user', name: 'odd' } })).body).toMatchObject({ ok: false, error: 'unknown type "https"' });
  });
  it('project-scope entries need confirm unless approved in a trusted project, and get no ${VAR} expansion from the office env', async () => {
    const w = world(), cj = json(w.claudeJson); cj.projects[w.pB] = { enabledMcpjsonServers: ['pq'] }; save(w.claudeJson, cj); save(join(w.pB, '.mcp.json'), { mcpServers: { pq: { command: NODE, args: [FAKE] } } });
    expect((await post(w.cfg, 'test', { ref: { scope: 'project', project: w.pA, name: 'pj1' } })).body).toMatchObject({ ok: true }); // enabled + trusted
    const pj3 = { scope: 'project', project: w.pA, name: 'pj3' };
    expect(await post(w.cfg, 'test', { ref: pj3 })).toEqual({ status: 400, body: { error: 'confirm-required', reason: `${NODE} ${FAKE} \${HOME}` } });
    expect((await post(w.cfg, 'test', { ref: { scope: 'project', project: w.pA, name: 'pj2' } })).body.error).toBe('confirm-required'); // disabled
    expect((await post(w.cfg, 'test', { ref: { scope: 'project', project: w.pB, name: 'pq' } })).body.error).toBe('confirm-required'); // untrusted project
    expect((await post(w.cfg, 'test', { server: { type: 'stdio', command: NODE, args: [FAKE] }, from: pj3 })).body.error).toBe('confirm-required');
    const ran = (await post(w.cfg, 'test', { ref: pj3, confirm: true })).body;
    expect(ran).toMatchObject({ ok: true }); expect(ran.stderr).toContain('args=${HOME}');
  });
  it('stdio failures: missing command, crash, initialize error, silence, flood; own env values are scrubbed', async () => {
    const run2 = (env: Record<string, string>, ms = 5000, command = NODE) => probeMcp({ command, args: [FAKE], env }, { name: 'x', cwd: tmpdir(), timeoutMs: ms });
    expect(await run2({}, 5000, '/no/such/server')).toMatchObject({ ok: false, error: 'command not found: /no/such/server' });
    expect(await run2({ FAKE_MCP_MODE: 'crash' })).toMatchObject({ ok: false, error: expect.stringContaining('exited (code 3)'), stderr: expect.stringContaining('boom') });
    const e = await run2({ FAKE_MCP_MODE: 'error', FAKE_MCP_ECHO: 'plainvalue42' });
    expect(e).toMatchObject({ ok: false, error: 'initialize failed: bad init for [REDACTED]' }); expect(e.stderr).toContain('echo=[REDACTED]'); expect(JSON.stringify(e)).not.toContain('plainvalue42');
    expect(await run2({ FAKE_MCP_MODE: 'silent' }, 400)).toMatchObject({ ok: false, error: 'no answer within 0.4 s' });
    expect(await run2({ FAKE_MCP_MODE: 'flood' })).toMatchObject({ ok: false, error: 'the server wrote more than 4 MB without a newline' });
  });
  it('cancel on client abort; at most 3 probes at once (429)', async () => {
    const w = world(), cj = json(w.claudeJson); cj.mcpServers.slow = { command: NODE, args: [FAKE], env: { FAKE_MCP_MODE: 'silent' } }; save(w.claudeJson, cj);
    const acs = [0, 1, 2].map(() => new AbortController()), running = acs.map((a) => post(w.cfg, 'test', { ref: { scope: 'user', name: 'slow' } }, a.signal));
    await tick(150);
    expect(await post(w.cfg, 'test', { ref: { scope: 'user', name: 'slow' } })).toEqual({ status: 429, body: { error: 'busy' } });
    const t = Date.now(); acs.forEach((a) => a.abort());
    for (const r of await Promise.all(running)) expect(r.body).toMatchObject({ ok: false, error: 'cancelled' });
    expect(Date.now() - t).toBeLessThan(2000);
    expect((await post(w.cfg, 'test', { ref: { scope: 'user', name: 'gh' } })).body.ok).toBe(true); // slots freed
  });
  it('http (JSON + SSE answers, session id, auth error), legacy sse, redirects, size caps', async () => {
    const seen: string[] = []; let push: ((m: unknown) => void) | undefined;
    const srv: Server = createServer((req, res) => {
      let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
        if (req.url === '/sse' && req.method === 'GET') { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('event: endpoint\ndata: /messages?s=1\n\n'); push = (m) => res.write(`event: message\ndata: ${JSON.stringify(m)}\n\n`); return; }
        if (req.url === '/moved') { res.writeHead(302, { location: 'https://elsewhere.example/mcp?token=abc' }).end(); return; }
        if (req.url === '/huge') { res.writeHead(200, { 'content-type': 'application/json' }).end(`"${'x'.repeat(2 << 20)}"`); return; }
        if (req.url === '/huge-sse') { res.writeHead(200, { 'content-type': 'text/event-stream' }).end(`data: ${'x'.repeat(2 << 20)}\n\n`); return; }
        const m = body ? JSON.parse(body) : {}, answer = (x: unknown) => ({ jsonrpc: '2.0', id: m.id, result: x });
        const result = m.method === 'initialize' ? answer({ protocolVersion: '2025-06-18', serverInfo: { name: 'http-fake', version: '2.0' } }) : m.method === 'tools/list' ? answer({ tools: [{ name: 'search' }] }) : undefined;
        if (req.url === '/messages?s=1') { res.writeHead(202).end(); if (result) setTimeout(() => push?.(result), 5); return; }
        if (req.method === 'DELETE') { seen.push(`DELETE ${req.headers['mcp-session-id']}`); res.writeHead(200).end(); return; }
        if (req.headers.authorization !== 'Bearer good') { res.writeHead(401).end(); return; }
        seen.push(`${m.method} sid=${req.headers['mcp-session-id'] ?? '-'} pv=${req.headers['mcp-protocol-version'] ?? '-'}`);
        if (!result) { res.writeHead(202).end(); return; }
        if (m.method === 'tools/list') { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: {} })}\n\ndata: ${JSON.stringify(result)}\n\n`); return; }
        res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'sess-1' }).end(JSON.stringify(result));
      });
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r())); const port = (srv.address() as any).port, base = `http://127.0.0.1:${port}`, o = { name: 'web', cwd: tmpdir() };
    try {
      const ok = await probeMcp({ type: 'http', url: `${base}/mcp`, headers: { Authorization: 'Bearer ${OFFICE_TEST_TOKEN}' } }, { ...o, env: { OFFICE_TEST_TOKEN: 'good' } });
      expect(ok).toMatchObject({ ok: true, server: { name: 'http-fake', version: '2.0' }, tools: ['search'] });
      expect(seen.slice(0, 3)).toEqual(['initialize sid=- pv=-', 'notifications/initialized sid=sess-1 pv=2025-06-18', 'tools/list sid=sess-1 pv=2025-06-18']);
      expect(await probeMcp({ type: 'http', url: `${base}/mcp`, headers: { Authorization: 'Bearer ${OFFICE_TEST_TOKEN}' } }, { ...o, env: { OFFICE_TEST_TOKEN: 'good' }, vars: {} })).toMatchObject({ ok: false, error: expect.stringContaining('needs auth') });
      expect(await probeMcp({ type: 'streamable-http', url: `${base}/mcp`, headers: { Authorization: 'Bearer good' } }, o)).toMatchObject({ ok: true, tools: ['search'] });
      expect(await probeMcp({ type: 'http', url: `${base}/mcp`, headers: { Authorization: 'Bearer bad' } }, o)).toMatchObject({ ok: false, error: 'needs auth (run /mcp or `claude mcp login web` in Claude Code)' });
      expect(await probeMcp({ type: 'sse', url: `${base}/sse` }, { ...o, name: 's' })).toMatchObject({ ok: true, server: { name: 'http-fake' }, tools: ['search'] });
      const moved = await probeMcp({ type: 'http', url: `${base}/moved`, headers: { Authorization: 'Bearer good' } }, o);
      expect(moved).toMatchObject({ ok: false, error: 'the server redirected (HTTP 302); use the final URL instead: https://elsewhere.example/mcp?token=[REDACTED]' });
      expect(await probeMcp({ type: 'http', url: `${base}/huge`, headers: { Authorization: 'Bearer good' } }, o)).toMatchObject({ ok: false, error: 'the answer is larger than 1 MB' });
      expect(await probeMcp({ type: 'http', url: `${base}/huge-sse` }, o)).toMatchObject({ ok: false, error: expect.stringMatching(/larger than 1 MB|longer than 1 MB/) });
      const closed = createServer(); await new Promise<void>((r) => closed.listen(0, '127.0.0.1', () => r())); const dead = (closed.address() as any).port; await new Promise((r) => closed.close(r));
      expect(await probeMcp({ type: 'http', url: `http://127.0.0.1:${dead}/mcp` }, o)).toMatchObject({ ok: false, error: expect.stringContaining('ECONNREFUSED') });
      expect(await probeMcp({ type: 'ws', url: 'ws://x' }, o)).toMatchObject({ ok: false, error: "testing ws servers isn't supported" });
      await tick(50); expect(seen).toContain('DELETE sess-1');
    } finally { srv.closeAllConnections(); srv.close(); }
  });
});
