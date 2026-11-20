import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  shellSplit, parseMcpAddCommand, parseMcpJson, draftFromView, draftFromImport, draftToInput, saveRequest, testRequest, validateDraft, emptyDraft, draftKey, argsFromText,
  uniqueName, namesIn, revealRow, rebaseDraft, readOnlyReason, KNOWN_TYPES, NAME_RE, sanitizeName, renameNote, hasBareBackslash, hasLiteralVars, BACKSLASH_NOTE, VAR_NOTE,
  maskUrl, maskArgs, maskedView, keptHeadersMoved, isNewerView, projectSecretsText, MASK, filterServers, scopeCounts, groupServers, describeLocation, serverLine, configErrorText, CHANGED_MSG, type ImportItem, type McpDraft,
} from '../src/claudeConfig';
import { fetchClaudeConfig, mcpSave, mcpDelete, mcpReveal, mcpTest, ConfigHttpError, errInfo, isConfirmRequired } from '../src/claudeConfigApi';
import { loadTab } from '../src/history';
import type { ClaudeProjectView, McpServerView } from '../src/types';

const srv = (p: Partial<McpServerView> & { name: string }): McpServerView => ({ scope: 'user', file: '/h/.claude.json', type: 'stdio', command: 'npx', args: [], env: [], headers: [], extraKeys: [], warnings: [], hash: 'h1', readOnly: false, ...p });
const proj = (path: string, exists = true): ClaudeProjectView => ({ path, exists, localServers: 0, hasMcpJson: false, trusted: true, allowedTools: 0 });
const one = (r: ReturnType<typeof parseMcpJson>): ImportItem => { if (!r.ok) throw new Error(r.error); expect(r.items).toHaveLength(1); return r.items[0]; };
const err = (r: ReturnType<typeof parseMcpJson>) => (r.ok ? '' : r.error);

describe('shellSplit', () => {
  it('handles single, double and backslash quoting', () => {
    expect(shellSplit(`a  b\tc`)).toEqual(['a', 'b', 'c']);
    expect(shellSplit(`'it is' "two words" three\\ words`)).toEqual(['it is', 'two words', 'three words']);
    expect(shellSplit(`"say \\"hi\\" \\\\ \\$HOME \\n" 'no \\escape'`)).toEqual(['say "hi" \\ $HOME \\n', 'no \\escape']);
    expect(shellSplit(`a"b c"d 'e'"f" '' ""`)).toEqual(['ab cd', 'ef', '', '']);
    expect(shellSplit(`-H "Authorization: Bearer x" --env=K='v w'`)).toEqual(['-H', 'Authorization: Bearer x', '--env=K=v w']);
    expect(shellSplit('claude mcp add \\\n  x \\\r\n  y')).toEqual(['claude', 'mcp', 'add', 'x', 'y']);
  });
  it('throws on unclosed quotes', () => {
    expect(() => shellSplit(`"open`)).toThrow(/double/);
    expect(() => shellSplit(`'open`)).toThrow(/single/);
  });
});

describe('parseMcpAddCommand', () => {
  it('stdio: scope, repeated -e, -- separator, args with spaces', () => {
    const it0 = one(parseMcpAddCommand(`claude mcp add -s user -e A=1 -e B="x y" postgresql-dev -- npx -y @pkg/server --flag "two words"`));
    expect(it0).toMatchObject({ name: 'postgresql-dev', scope: 'user', server: { type: 'stdio', command: 'npx', args: ['-y', '@pkg/server', '--flag', 'two words'], env: [{ key: 'A', value: '1' }, { key: 'B', value: 'x y' }] } });
  });
  it('http: --transport= / --scope= forms, headers before or after the URL', () => {
    expect(one(parseMcpAddCommand(`claude mcp add --transport=http --scope=project -H "Authorization: Bearer abc" -H 'X-Key:1' sentry https://mcp.sentry.dev/mcp`))).toMatchObject({
      name: 'sentry', scope: 'project', server: { type: 'http', url: 'https://mcp.sentry.dev/mcp', headers: [{ key: 'Authorization', value: 'Bearer abc' }, { key: 'X-Key', value: '1' }] } });
    expect(one(parseMcpAddCommand(`claude mcp add --transport http github https://api.githubcopilot.com/mcp -H "Authorization: Bearer X"`)).server)
      .toEqual({ type: 'http', url: 'https://api.githubcopilot.com/mcp', headers: [{ key: 'Authorization', value: 'Bearer X' }] });
    expect(one(parseMcpAddCommand(`claude mcp add -t sse -H "A: 1" "B: 2" ev https://x.dev/sse`)).server.headers).toEqual([{ key: 'A', value: '1' }, { key: 'B', value: '2' }]);
  });
  it('variadic -e, names with spaces/dots, global scope, leniency after the command', () => {
    expect(one(parseMcpAddCommand(`claude mcp add -e A=1 B=2 srv node s.js`))).toMatchObject({ name: 'srv', server: { command: 'node', args: ['s.js'], env: [{ key: 'A', value: '1' }, { key: 'B', value: '2' }] } });
    expect(one(parseMcpAddCommand(`claude mcp add -s global "MAPI Docs MCP" uvx mapi-docs`))).toMatchObject({ name: 'MAPI Docs MCP', scope: 'user' });
    expect(one(parseMcpAddCommand(`claude mcp add draw.io npx @drawio/mcp --headless`)).server.args).toEqual(['@drawio/mcp', '--headless']);
    expect(one(parseMcpAddCommand(`npx @anthropic-ai/claude-code mcp add x -- python -e 'print(1)'`)).server).toMatchObject({ command: 'python', args: ['-e', 'print(1)'] });
  });
  it('a URL without --transport becomes http (noted); OAuth flags are noted, not imported', () => {
    const r = one(parseMcpAddCommand(`claude mcp add --client-id abc notion https://mcp.notion.com/mcp`));
    expect(r.server).toEqual({ type: 'http', url: 'https://mcp.notion.com/mcp', headers: [] });
    expect(r.notes.join(' ')).toMatch(/taken as http/); expect(r.notes.join(' ')).toMatch(/--client-id/);
  });
  it('add-json with scope and a quoted name', () => {
    const r = one(parseMcpAddCommand(`claude mcp add-json -s local "MAPI Docs MCP" '{"type":"http","url":"https://x.dev/mcp","headers":{"A":"b"},"oauth":{"x":1}}'`));
    expect(r).toMatchObject({ name: 'MAPI Docs MCP', scope: 'local', server: { type: 'http', url: 'https://x.dev/mcp', headers: [{ key: 'A', value: 'b' }] } });
    expect(r.notes.join(' ')).toMatch(/Not imported: oauth/);
  });
  it('reports errors', () => {
    expect(err(parseMcpAddCommand('npx something'))).toMatch(/claude mcp add/);
    expect(one(parseMcpAddCommand('claude mcp add -t streamable-http s https://x/mcp -H "A: 1"')).server).toEqual({ type: 'streamable-http', url: 'https://x/mcp', headers: [{ key: 'A', value: '1' }] });
    expect(one(parseMcpAddCommand('claude mcp add live wss://x/ws')).server).toEqual({ type: 'ws', url: 'wss://x/ws', headers: [] });
    expect(err(parseMcpAddCommand('claude mcp add'))).toMatch(/name/);
    expect(err(parseMcpAddCommand('claude mcp add x'))).toMatch(/command or URL/);
    expect(err(parseMcpAddCommand('claude mcp add -s team x npx'))).toMatch(/scope "team"/);
    expect(err(parseMcpAddCommand('claude mcp add --bogus x npx'))).toMatch(/Unknown option "--bogus"/);
    expect(err(parseMcpAddCommand('claude mcp add -e NOEQUALS x npx'))).toMatch(/KEY=VALUE/);
    expect(err(parseMcpAddCommand(`claude mcp add x "npx`))).toMatch(/unclosed/);
    expect(err(parseMcpAddCommand(`claude mcp add-json x '{bad'`))).toMatch(/Not valid JSON/);
  });
});

describe('parseMcpJson', () => {
  it('mcpServers map (many), name map, VS Code servers', () => {
    const r = parseMcpJson(JSON.stringify({ mcpServers: { a: { command: 'npx', args: ['-y', 'a'], env: { K: 'v', N: 3 } }, 'draw.io': { type: 'sse', url: 'https://d/sse', headers: { H: 'x' } } } }));
    expect(r.ok && r.items.map((x) => x.name)).toEqual(['a', 'draw.io']);
    expect(r.ok && r.items[0].server).toEqual({ type: 'stdio', command: 'npx', args: ['-y', 'a'], env: [{ key: 'K', value: 'v' }, { key: 'N', value: '3' }] });
    expect(r.ok && r.items[1].server).toEqual({ type: 'sse', url: 'https://d/sse', headers: [{ key: 'H', value: 'x' }] });
    expect(one(parseMcpJson(`{"pg": {"command": "uvx", "args": ["pg-mcp"]}}`)).name).toBe('pg');
    expect(one(parseMcpJson(`{"servers": {"gh": {"type": "http", "url": "https://g/mcp"}}, "inputs": []}`)).name).toBe('gh');
  });
  it('bare server (name asked), fragment, inferred http, notes', () => {
    expect(one(parseMcpJson(`{"command": "node", "args": ["s.js"]}`))).toMatchObject({ name: '', server: { type: 'stdio', command: 'node' } });
    expect(one(parseMcpJson(`"frag": {"command": "x"},`)).name).toBe('frag');
    const h = one(parseMcpJson(`{"url": "https://h/mcp", "timeout": 5, "env": {"A": "1"}}`));
    expect(h.server).toEqual({ type: 'http', url: 'https://h/mcp', headers: [] });
    expect(h.notes.join(' ')).toMatch(/taken as http/); expect(h.notes.join(' ')).toMatch(/Not imported: timeout/); expect(h.notes.join(' ')).toMatch(/left out/);
    expect(one(parseMcpJson(`{"command": "npx", "args": "-y 'a b'"}`)).server.args).toEqual(['-y', 'a b']);
    expect(one(parseMcpJson(`{"url": "ws://localhost:9000"}`)).server).toEqual({ type: 'ws', url: 'ws://localhost:9000', headers: [] });
  });
  it('errors', () => {
    expect(err(parseMcpJson(''))).toMatch(/Paste/);
    expect(err(parseMcpJson('{nope'))).toMatch(/Not valid JSON/);
    expect(err(parseMcpJson('[1]'))).toMatch(/object/);
    expect(err(parseMcpJson('{"mcpServers": {}}'))).toMatch(/No MCP servers/);
  });
});

describe('drafts and keep markers', () => {
  const pg = srv({ name: 'postgresql-dev', args: ['-y', 'pg mcp'], env: [{ key: 'PGHOST', value: 'db' }, { key: 'PGPASSWORD', masked: true }], extraKeys: ['timeout'], hash: 'abc' });
  it('edit: masked values stay out of the browser and go back as {key, keep:true}', () => {
    const d = draftFromView(pg, 'edit');
    expect(d).toMatchObject({ mode: 'edit', scope: 'user', name: 'postgresql-dev', args: '-y\npg mcp', original: { scope: 'user', name: 'postgresql-dev', hash: 'abc' } });
    expect(d.env[1]).toEqual({ key: 'PGPASSWORD', value: '', masked: true, orig: 'PGPASSWORD' });
    expect(saveRequest(d)).toEqual({ target: { scope: 'user', name: 'postgresql-dev' }, original: { scope: 'user', name: 'postgresql-dev', hash: 'abc' },
      server: { type: 'stdio', command: 'npx', args: ['-y', 'pg mcp'], env: [{ key: 'PGHOST', value: 'db' }, { key: 'PGPASSWORD', keep: true }] } });
    const typed: McpDraft = { ...d, env: [d.env[0], { ...d.env[1], value: 'new' }] };
    expect(draftToInput(typed).env?.[1]).toEqual({ key: 'PGPASSWORD', value: 'new' });
  });
  it('a revealed secret still goes back as keep:true until it is edited', () => {
    const d = draftFromView(pg, 'edit'), r = revealRow(d.env[1], 'pw');
    expect(r).toMatchObject({ value: 'pw', masked: true, orig: 'PGPASSWORD' });
    expect(draftToInput({ ...d, env: [d.env[0], r] }).env?.[1]).toEqual({ key: 'PGPASSWORD', keep: true });
    expect(draftToInput({ ...d, env: [d.env[0], { ...r, value: 'pw2' }] }).env?.[1]).toEqual({ key: 'PGPASSWORD', value: 'pw2' });
    expect(draftToInput({ ...d, env: [d.env[0], { ...r, key: 'PGPASS' }] }).env?.[1]).toEqual({ key: 'PGPASS', value: 'pw' }); // renamed after reveal: real value
  });
  it('rebaseDraft keeps edited fields and takes the rest (and the hash) from the fresh entry', () => {
    const init = draftFromView(pg, 'edit'), mine = { ...init, command: 'pnpx' };
    const fresh = draftFromView({ ...pg, args: ['-y', 'pg mcp', '--new'], hash: 'zzz' }, 'edit'), r = rebaseDraft(mine, init, fresh);
    expect(r).toMatchObject({ command: 'pnpx', args: '-y\npg mcp\n--new', original: { hash: 'zzz' } });
  });
  it('clone: unique -copy name, cloneFrom, settings.json → user scope', () => {
    const c = draftFromView(pg, 'clone', new Set(['postgresql-dev', 'postgresql-dev-copy']));
    expect(c).toMatchObject({ mode: 'clone', name: 'postgresql-dev-copy-2', cloneFrom: { scope: 'user', name: 'postgresql-dev' } }); expect(c.original).toBeUndefined();
    expect(saveRequest(c).cloneFrom).toEqual({ scope: 'user', name: 'postgresql-dev' }); expect(saveRequest(c).server.env?.[1]).toEqual({ key: 'PGPASSWORD', keep: true });
    const s = draftFromView(srv({ name: 'x', scope: 'settings', readOnly: true }), 'clone');
    expect(s).toMatchObject({ scope: 'user', project: '', cloneFrom: { scope: 'settings', name: 'x' } });
    const l = draftFromView(srv({ name: 'x', scope: 'local', project: '/p' }), 'clone');
    expect(saveRequest(l).target).toEqual({ scope: 'local', project: '/p', name: 'x-copy' });
    expect(uniqueName('a', new Set())).toBe('a');
  });
  it('test: unchanged stored entry by ref, else the draft with from + project', () => {
    const d = draftFromView(srv({ name: 'l', scope: 'local', project: '/p' }), 'edit');
    expect(testRequest(d, false)).toEqual({ ref: { scope: 'local', project: '/p', name: 'l' } });
    expect(testRequest({ ...d, command: 'node' }, true)).toMatchObject({ server: { command: 'node' }, from: { scope: 'local', project: '/p', name: 'l' }, project: '/p' });
    expect(testRequest(emptyDraft(), true)).toEqual({ server: { type: 'stdio', command: '', args: [], env: [] } });
  });
  it('type decides what is sent; args keep order and inner spaces; lossy args flagged', () => {
    const h = { ...emptyDraft(), type: 'http', url: ' https://x/mcp ', command: 'stale', env: [{ key: 'A', value: '1' }], headers: [{ key: 'H', value: 'v' }, { key: '', value: '' }] };
    expect(draftToInput(h)).toEqual({ type: 'http', url: 'https://x/mcp', headers: [{ key: 'H', value: 'v' }] });
    expect(draftToInput({ ...h, type: 'https' })).toMatchObject({ type: 'https', command: 'stale', url: 'https://x/mcp' }); // unknown stored type: both sides kept
    for (const t of ['ws', 'streamable-http', 'sse']) expect(Object.keys(draftToInput({ ...h, type: t })).sort()).toEqual(['headers', 'type', 'url']);
    expect(KNOWN_TYPES).toEqual(['stdio', 'http', 'streamable-http', 'sse', 'ws']);
    expect(argsFromText('b\n\n a b \r\nc\n')).toEqual(['b', ' a b ', 'c']);
    expect(draftFromView(srv({ name: 'x', args: ['a', ''] }), 'edit').lossyArgs).toBe(true);
    expect(draftFromView(srv({ name: 'x', type: '' }), 'edit').type).toBe('stdio');
  });
  it('imports become new drafts (scope from -s, else the default)', () => {
    const it0 = one(parseMcpAddCommand('claude mcp add -s local -e K=v x npx a'));
    expect(draftFromImport(it0, { scope: 'project', project: '/p' })).toMatchObject({ mode: 'new', scope: 'local', project: '/p', name: 'x', command: 'npx', args: 'a', env: [{ key: 'K', value: 'v' }] });
    expect(draftFromImport({ ...it0, scope: undefined }, { scope: 'user', project: '/p' })).toMatchObject({ scope: 'user', project: '' });
  });
  it('dirty fingerprint ignores mode/refs', () => {
    const d = draftFromView(pg, 'edit');
    expect(draftKey(d)).toBe(draftKey({ ...d, original: undefined })); expect(draftKey(d)).not.toBe(draftKey({ ...d, name: 'z' }));
  });
});

describe('names the claude CLI accepts', () => {
  it('sanitizeName: spaces/dots/accents → -, valid names unchanged', () => {
    expect(sanitizeName('MAPI Docs MCP')).toBe('MAPI-Docs-MCP'); expect(sanitizeName('draw.io')).toBe('draw-io');
    expect(sanitizeName('  bản đồ (v2) ')).toBe('ban-do-v2'); expect(sanitizeName('-rf')).toBe('rf'); expect(sanitizeName('...')).toBe('server');
    expect(sanitizeName('ok_name-1')).toBe('ok_name-1'); expect(sanitizeName('x'.repeat(70) + '.y')).toHaveLength(64);
    expect(renameNote('draw.io', 'draw-io')).toMatch(/letters, digits, _ and -/);
  });
  it('clone and import suggest a sanitized name', () => {
    expect(draftFromView(srv({ name: 'MAPI Docs MCP', scope: 'settings', readOnly: true }), 'clone').name).toBe('MAPI-Docs-MCP-copy');
    expect(draftFromView(srv({ name: 'draw.io' }), 'clone', new Set(['draw-io-copy'])).name).toBe('draw-io-copy-2');
    expect(draftFromImport({ name: 'MAPI Docs MCP', server: { type: 'http', url: 'https://x' }, notes: [] }, { scope: 'user', project: '' }).name).toBe('MAPI-Docs-MCP');
    expect(draftFromImport({ name: '', server: { type: 'stdio', command: 'x' }, notes: [] }, { scope: 'user', project: '' }).name).toBe('');
    expect(draftFromView(srv({ name: 'draw.io' }), 'edit').name).toBe('draw.io'); // edit keeps the stored name (validation asks to rename)
  });
});

describe('import notes', () => {
  it('bare backslashes (Windows paths) and literal $VAR / $(…)', () => {
    expect(hasBareBackslash('claude mcp add x C:\\tools\\a.exe')).toBe(true);
    expect(hasBareBackslash(`claude mcp add x 'C:\\tools\\a.exe' "C:\\b"`)).toBe(false);
    expect(hasBareBackslash('claude mcp add x \\\n  npx')).toBe(false); // line continuation
    expect(hasBareBackslash('a\\ b')).toBe(true);
    const w = one(parseMcpAddCommand('claude mcp add x C:\\tools\\a.exe'));
    expect(w.server.command).toBe('C:toolsa.exe'); expect(w.notes).toContain(BACKSLASH_NOTE);
    expect(one(parseMcpAddCommand(`claude mcp add x 'C:\\tools\\a.exe'`)).notes).not.toContain(BACKSLASH_NOTE);
    expect(one(parseMcpAddCommand(`claude mcp add -e T='$GH_TOKEN' x npx`)).notes).toContain(VAR_NOTE);
    expect(one(parseMcpAddCommand(`claude mcp add x node '$(pwd)/s.js'`)).notes).toContain(VAR_NOTE);
    expect(one(parseMcpAddCommand(`claude mcp add -e T='\${GH_TOKEN}' x npx`)).notes).not.toContain(VAR_NOTE);
    expect(one(parseMcpJson(`{"x": {"url": "https://h/$TENANT/mcp"}}`)).notes).toContain(VAR_NOTE);
    expect(hasLiteralVars({ type: 'stdio', command: 'a', env: [{ key: 'K', value: '\${V}' }] })).toBe(false);
  });
});

describe('masking args / url for display', () => {
  it('url: userinfo password and secret query values', () => {
    expect(maskUrl('https://user:p4ss@host/mcp?token=abc&x=1&api_key=k&signature=s')).toBe(`https://user:${MASK}@host/mcp?token=${MASK}&x=1&api_key=${MASK}&signature=${MASK}`);
    expect(maskUrl('https://host/mcp?keyboard=1&monkey=2')).toBe('https://host/mcp?keyboard=1&monkey=2');
    expect(maskUrl('https://user@host/x')).toBe('https://user@host/x');
  });
  it('args: --flag=secret, --flag secret, TOKEN=…, Authorization header, URLs; leaves the rest', () => {
    expect(maskArgs(['-y', '@sentry/mcp-server', '--access-token=sntrys_abc', '--host=sentry.io'])).toEqual(['-y', '@sentry/mcp-server', `--access-token=${MASK}`, '--host=sentry.io']);
    expect(maskArgs(['--api-key', 'k123', '--token', 't', '--verbose'])).toEqual(['--api-key', MASK, '--token', MASK, '--verbose']);
    expect(maskArgs(['--token', '--next'])).toEqual(['--token', '--next']);
    expect(maskArgs(['GITHUB_TOKEN=ghp_x', 'DEBUG=1', '--header', 'Authorization: Bearer abc.def', 'Bearer xyz'])).toEqual([`GITHUB_TOKEN=${MASK}`, 'DEBUG=1', '--header', `Authorization: Bearer ${MASK}`, `Bearer ${MASK}`]);
    expect(maskArgs(['--design=x', '--signal=1', '--author=me', '--keyboard'])).toEqual(['--design=x', '--signal=1', '--author=me', '--keyboard']);
    expect(maskArgs(['https://u:pw@db/x'])).toEqual([`https://u:${MASK}@db/x`]);
  });
  it('maskedView / serverLine hide by default, show on request', () => {
    const v = srv({ name: 'sentry', command: 'npx', args: ['@sentry/mcp-server', '--access-token=sntrys_abc'] });
    expect(maskedView(v).masked).toBe(true); expect(maskedView(srv({ name: 'x', args: ['-y'] })).masked).toBe(false);
    expect(serverLine(v)).toBe(`npx @sentry/mcp-server --access-token=${MASK}`); expect(serverLine(v, true)).toContain('sntrys_abc');
    expect(serverLine(srv({ name: 'h', type: 'http', command: undefined, url: 'https://h/mcp?token=t' }))).toBe(`https://h/mcp?token=${MASK}`);
  });
});

describe('confirm cases', () => {
  const web = (url: string, headers = [{ key: 'Authorization', value: '', masked: true, orig: 'Authorization' }]): McpDraft => ({ ...emptyDraft(), type: 'http', url, headers });
  it('kept headers moving to another origin', () => {
    expect(keptHeadersMoved(web('https://evil.example/mcp'), 'https://api.github.com/mcp')).toEqual({ keys: ['Authorization'], from: 'https://api.github.com', to: 'https://evil.example' });
    expect(keptHeadersMoved(web('https://api.github.com/other'), 'https://api.github.com/mcp')).toBeUndefined(); // same origin
    expect(keptHeadersMoved(web('https://evil.example', [{ key: 'Authorization', value: 'new', masked: true, orig: 'Authorization' }]), 'https://api.github.com')).toBeUndefined(); // re-entered
    expect(keptHeadersMoved(web('https://evil.example', []), 'https://api.github.com')).toBeUndefined();
    expect(keptHeadersMoved(web('https://x'), undefined)).toBeUndefined();
  });
  it('stale views, confirm-required, project secrets text', () => {
    expect(isNewerView(0, 5)).toBe(true); expect(isNewerView(10, 5)).toBe(false); expect(isNewerView(5, 5)).toBe(true);
    expect(isConfirmRequired({ status: 400, error: 'confirm-required', reason: 'npx x' })).toBe(true); expect(isConfirmRequired({ status: 400, error: 'bad' })).toBe(false);
    expect(projectSecretsText('/p')).toBe('Secrets will be written in plain text to /p/.mcp.json, which is usually committed. Prefer ${VAR} references.');
  });
});

describe('validateDraft', () => {
  const list = [srv({ name: 'pg' }), srv({ name: 'loc', scope: 'local', project: '/p' })], projects = [proj('/p'), proj('/gone', false)];
  const ok = (p: Partial<McpDraft>) => validateDraft({ ...emptyDraft(), name: 'n', command: 'npx', ...p }, list, projects);
  it('names', () => {
    expect(ok({})).toEqual({});
    expect(ok({ name: ' ' }).name).toMatch(/required/);
    expect(ok({ name: 'x'.repeat(65) }).name).toMatch(/64/);
    for (const n of ['a/b', 'a\\b', 'a"b', "a'b", 'a\u0001b', 'MAPI Docs MCP', 'draw.io', 'bản-đồ']) expect(ok({ name: n }).name).toMatch(/Only letters, digits, _ and -/);
    expect(ok({ name: 'MAPI_Docs-MCP2' })).toEqual({}); expect(NAME_RE.test('x'.repeat(64))).toBe(true);
    expect(validateDraft(draftFromView(srv({ name: 'draw.io' }), 'edit'), [srv({ name: 'draw.io' })]).name).toMatch(/Only letters/); // stored bad name: rename to save
    expect(ok({ name: '-rf' }).name).toMatch(/start with "-"/); expect(ok({ name: 'a-' })).toEqual({});
    expect(ok({ name: 'pg' }).name).toMatch(/already exists in User/);
    expect(ok({ name: 'pg', scope: 'local', project: '/p' })).toEqual({}); // other scope is fine
    expect(ok({ name: 'loc', scope: 'local', project: '/p' }).name).toMatch(/already exists in Local scope of \/p/);
    expect(validateDraft(draftFromView(list[0], 'edit'), list, projects)).toEqual({}); // editing itself is not a duplicate
  });
  it('location, type, command, url', () => {
    expect(ok({ scope: 'local' }).project).toMatch(/Pick/);
    expect(ok({ scope: 'project', project: '/nope' }).project).toMatch(/knows/);
    expect(ok({ scope: 'project', project: '/gone' }).project).toBeUndefined();
    expect(ok({ command: '  ' }).command).toMatch(/required/);
    expect(ok({ type: 'http', url: 'ftp://x' }).url).toMatch(/http/);
    expect(ok({ type: 'sse', url: 'https://x/sse' })).toEqual({});
    expect(ok({ type: '' }).type).toMatch(/required/);
    expect(ok({ type: 'https', url: 'https://x' }).type).toMatch(/Unknown type "https"/);
    expect(ok({ type: 'ws', url: 'https://x' }).url).toMatch(/ws:\/\//); expect(ok({ type: 'ws', url: 'wss://x/ws' })).toEqual({});
    expect(ok({ type: 'streamable-http', url: 'https://x/mcp' })).toEqual({}); expect(ok({ type: 'streamable-http', url: 'ws://x' }).url).toMatch(/http/);
  });
  it('env/header keys', () => {
    expect(ok({ env: [{ key: 'A', value: '1' }, { key: 'A', value: '2' }] }).env).toMatch(/Duplicate/);
    expect(ok({ env: [{ key: 'A', value: '1' }, { key: 'a', value: '2' }] })).toEqual({}); // env names are case-sensitive
    expect(ok({ type: 'http', url: 'https://x', headers: [{ key: 'Auth', value: '1' }, { key: 'auth', value: '2' }] }).headers).toMatch(/Duplicate/);
    expect(ok({ env: [{ key: '', value: 'v' }] }).env).toMatch(/needs a name/);
    expect(ok({ env: [{ key: 'A=B', value: 'v' }] }).env).toMatch(/can't contain "="/); expect(ok({ env: [{ key: 'A B', value: 'v' }] }).env).toMatch(/spaces/);
    expect(ok({ env: [{ key: 'my.var-1', value: 'v' }] })).toEqual({});
    expect(ok({ type: 'http', url: 'https://x', headers: [{ key: 'X Key', value: '1' }] }).headers).toMatch(/Header name "X Key"/);
    expect(ok({ type: 'http', url: 'https://x', headers: [{ key: 'X-Api-Key', value: '1' }] })).toEqual({});
    expect(ok({ env: [{ key: '', value: '' }] })).toEqual({});
    expect(ok({ env: [{ key: 'NEW', value: '', masked: true, orig: 'OLD' }] }).env).toMatch(/Enter a value for "NEW"/);
    expect(ok({ type: 'http', url: 'https://x', env: [{ key: 'A', value: '1' }, { key: 'A', value: '1' }] })).toEqual({}); // env not sent for http
  });
});

describe('list helpers', () => {
  const list = [
    srv({ name: 'postgresql-prd', command: 'uvx', args: ['postgres-mcp'] }), srv({ name: 'Bản đồ', type: 'http', command: undefined, url: 'https://map.dev/mcp' }),
    srv({ name: 'loc', scope: 'local', project: '/b' }), srv({ name: 'loc', scope: 'local', project: '/a' }), srv({ name: 'shared', scope: 'project', project: '/a', file: '/a/.mcp.json', approval: 'pending' }),
    srv({ name: 'old', scope: 'settings', file: '/h/.claude/settings.json', readOnly: true }),
  ];
  it('search, scope and project filters; chip counts ignore the scope chip', () => {
    expect(filterServers(list, { q: 'POSTGRES' }).map((v) => v.name)).toEqual(['postgresql-prd']);
    expect(filterServers(list, { q: 'ban do' }).map((v) => v.name)).toEqual(['Bản đồ']);
    expect(filterServers(list, { q: 'map.dev' })).toHaveLength(1);
    expect(filterServers(list, { scope: 'local' })).toHaveLength(2);
    expect(filterServers(list, { project: '/a' }).map((v) => `${v.scope}:${v.name}`)).toEqual(['user:postgresql-prd', 'user:Bản đồ', 'local:loc', 'project:shared', 'settings:old']);
    expect(scopeCounts(list, { project: '/a' })).toEqual({ all: 5, user: 2, local: 1, project: 1, settings: 1 });
  });
  it('groups by scope then project, names sorted', () => {
    expect(groupServers(list).map((g) => `${g.scope}${g.project ? `:${g.project}` : ''}:${g.servers.map((v) => v.name).join(',')}`)).toEqual(['user:Bản đồ,postgresql-prd', 'local:/a:loc', 'local:/b:loc', 'project:/a:shared', 'settings:old']);
    expect(namesIn(list, 'local', '/a')).toEqual(new Set(['loc']));
  });
  it('location text and row line', () => {
    expect(describeLocation(list[2])).toBe('Local scope of /b (/h/.claude.json)');
    expect(describeLocation(list[4])).toBe('Project scope (/a/.mcp.json)');
    expect(describeLocation(list[5])).toMatch(/not loaded by Claude Code/);
    expect(serverLine(srv({ name: 'x', command: 'npx', args: ['-y', 'a b'] }))).toBe('npx -y "a b"');
    expect(serverLine(list[1])).toBe('https://map.dev/mcp');
  });
});

describe('errors and API', () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = (res: unknown) => { const f = vi.fn(async () => res); vi.stubGlobal('fetch', f); vi.stubGlobal('sessionStorage', { getItem: () => '127.0.0.1:7777' }); vi.stubGlobal('location', { port: '7777', host: '127.0.0.1:7777' }); return f; };
  it('error copy', () => {
    expect(configErrorText(409, 'changed', 'save')).toBe(CHANGED_MSG);
    expect(configErrorText(409, 'a server named "x" already exists', 'save')).toMatch(/already exists/);
    expect(configErrorText(503, 'claude CLI not found', 'save')).toBe('Read-only: claude CLI not found');
    expect(configErrorText(503, 'read-only', 'delete')).toMatch(/^Read-only: .*demo/);
    expect(configErrorText(404, undefined, 'load')).toMatch(/too old.*Restart/);
    expect(configErrorText(501, undefined, 'load')).toMatch(/too old/);
    expect(configErrorText(404, undefined, 'save')).toMatch(/no longer exists/);
    expect(configErrorText(400, 'name: bad', 'save')).toBe('Invalid: name: bad');
    expect(configErrorText(500, 'exit 1: boom', 'save')).toBe('Claude CLI failed: exit 1: boom');
    expect(configErrorText(401, undefined, 'test')).toMatch(/ui-url\.txt/);
    expect(configErrorText(503, 'read-only', 'save', { reason: 'demo mode' })).toBe('Read-only: demo mode');
    expect(configErrorText(500, 'claude mcp add-json failed: x', 'save', { backup: '/r/backups/a.json' })).toBe('Claude CLI failed: claude mcp add-json failed: x Backup: /r/backups/a.json');
    expect(configErrorText(400, 'confirm-required', 'test', { reason: 'npx -y x' })).toBe('Needs confirmation: npx -y x');
  });
  it('GET and POSTs carry the token only in the Authorization header', async () => {
    const f = stub({ ok: true, status: 200, json: async () => ({ ok: true }) });
    await fetchClaudeConfig('tok');
    await mcpSave('tok', { target: { scope: 'user', name: 'x' }, server: { type: 'stdio', command: 'npx' } });
    await mcpDelete('tok', { scope: 'user', name: 'x', hash: 'h' });
    await mcpReveal('tok', { scope: 'user', name: 'x', field: 'env', key: 'K' });
    await mcpTest('tok', { ref: { scope: 'user', name: 'x' } });
    const calls = f.mock.calls as unknown as Array<[string, { method?: string; headers: Record<string, string>; body?: string }]>;
    expect(calls.map(([u, i]) => `${i.method ?? 'GET'} ${u.replace('http://127.0.0.1:7777', '')}`)).toEqual(['GET /claude-config', 'POST /claude-config/mcp/save', 'POST /claude-config/mcp/delete', 'POST /claude-config/mcp/reveal', 'POST /claude-config/mcp/test']);
    for (const [u, i] of calls) { expect(u).not.toContain('tok'); expect(i.body ?? '').not.toContain('tok'); expect(i.headers.authorization).toBe('Bearer tok'); }
    expect(calls[1][1].headers['content-type']).toBe('application/json'); expect(JSON.parse(calls[1][1].body!)).toEqual({ target: { scope: 'user', name: 'x' }, server: { type: 'stdio', command: 'npx' } });
  });
  it('failures keep the server {error} text', async () => {
    stub({ ok: false, status: 409, json: async () => ({ error: 'changed' }) });
    const e = await mcpSave('t', { target: { scope: 'user', name: 'x' }, server: { type: 'stdio' } }).catch((x) => x);
    expect(e).toBeInstanceOf(ConfigHttpError); expect(errInfo(e)).toEqual({ status: 409, error: 'changed' });
    stub({ ok: false, status: 500, json: async () => ({ error: 'claude mcp remove failed: x', reason: 'r', backup: '/b' }) });
    expect(errInfo(await mcpDelete('t', { scope: 'user', name: 'x', hash: 'h' }).catch((x) => x))).toEqual({ status: 500, error: 'claude mcp remove failed: x', reason: 'r', backup: '/b' });
    stub({ ok: false, status: 404, json: async () => { throw new SyntaxError('empty'); } });
    expect(errInfo(await fetchClaudeConfig('t').catch((x) => x))).toEqual({ status: 404, error: undefined });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    expect(errInfo(await fetchClaudeConfig('t').catch((x) => x)).status).toBe(0);
    expect(errInfo(new Error('x'))).toEqual({ status: 0 });
  });
  it('read-only reason: inside a Claude Code session gets the restart advice', () => {
    expect(readOnlyReason({})).toEqual({ text: 'demo mode', inSession: false });
    expect(readOnlyReason({ error: 'claude CLI not found (install Claude Code or set OFFICE_CLAUDE_BIN)' }).inSession).toBe(false);
    expect(readOnlyReason({ error: 'started inside a Claude Code session (CLAUDECODE=1): the claude CLI refuses config writes' }).inSession).toBe(true);
  });
  it('a save never sends original and cloneFrom together', () => {
    const v = srv({ name: 'x' });
    for (const d of [draftFromView(v, 'edit'), draftFromView(v, 'clone'), emptyDraft()]) { const r = saveRequest({ ...d, name: 'y' }); expect(!!r.original && !!r.cloneFrom).toBe(false); }
  });
  it('the Claude tab is remembered', () => {
    expect(loadTab({ getItem: () => 'claude', setItem: () => {} })).toBe('claude');
    expect(loadTab({ getItem: () => 'nope', setItem: () => {} })).toBe('office');
  });
});
