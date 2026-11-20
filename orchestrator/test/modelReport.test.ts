import { describe, it, expect } from 'vitest';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ModelReport, classifyError, errorPattern, modelLabel } from '../src/modelReport.js';
import { DEMO_NOW } from '../src/cli.js';

const NOW = new Date(2026, 10, 20, 12).getTime(); // Friday 2026-11-20 12:00 local; its week starts Monday 2026-11-16
/** local time `day` days from 2026-11-20 at 09:00 + min minutes, as a transcript timestamp */
const at = (day: number, min = 0) => new Date(new Date(2026, 10, 20 + day, 9).getTime() + min * 60_000).toISOString();
const OPUS = 'claude-opus-5-5', SONNET = 'claude-sonnet-5-5', HAIKU = 'claude-haiku-5-5';
let n = 0;
type L = Record<string, unknown>;
const base = (ts: string, x: L = {}) => ({ parentUuid: null, isSidechain: false, uuid: `u${++n}`, timestamp: ts, userType: 'external', entrypoint: 'cli', cwd: '/w/shop', sessionId: 's', version: '2.1.0', ...x });
const prompt = (content: unknown, ts: string, x: L = {}) => ({ ...base(ts, x), type: 'user', message: { role: 'user', content } });
const asst = (model: string, ts: string, content: unknown[], m: L = {}, x: L = {}) => ({ ...base(ts, x), type: 'assistant', message: { model, id: `m${++n}`, type: 'message', role: 'assistant', content, ...m } });
const tool = (model: string, ts: string, id: string, name: string, input: unknown, m: L = {}, x: L = {}) => asst(model, ts, [{ type: 'tool_use', id, name, input }], m, x);
const res = (id: string, content: unknown, ts: string, err = false, x: L = {}) => ({ ...base(ts, x), type: 'user', message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content, ...(err ? { is_error: true } : {}) }] }, toolUseResult: {} });
const intr = (ts: string) => prompt([{ type: 'text', text: '[Request interrupted by user]' }], ts);
const write = (root: string, rel: string, lines: unknown[]) => { const f = join(root, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n'); return f; };
const SECRET = 'sk-abcdefghijklmnop1234';

/** s1 (shop, opus-led, two models, subagent), s2 (sdk-cli automation, haiku 4.5), s3 (blog, sonnet, 20 days ago) */
function world() {
  const root = mkdtempSync(join(tmpdir(), 'deck-mr-'));
  write(root, '-w-shop/s1.jsonl', [
    { type: 'queue-operation', operation: 'enqueue', timestamp: at(-1), sessionId: 's1' },
    prompt('fix the cart total PROMPTTEXT', at(-1, 0)),
    // one API response written as three lines (text, tool_use, tool_use): one call, usage max, effort once
    asst(OPUS, at(-1, 1), [{ type: 'text', text: 'Looking.' }], { id: 'A1', usage: { output_tokens: 10 } }, { effort: 'high' }),
    asst(OPUS, at(-1, 1), [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/w/shop/a.ts' } }], { id: 'A1', usage: { output_tokens: 50 } }, { effort: 'high' }),
    asst(OPUS, at(-1, 1), [{ type: 'tool_use', id: 't2', name: 'Edit', input: { file_path: '/w/shop/a.ts' } }], { id: 'A1', usage: { output_tokens: 50 } }, { effort: 'high' }),
    res('t1', 'TOOLRESULTTEXT file body', at(-1, 2)),
    res('t2', '<tool_use_error>String to replace not found in file.\nString: total = 1</tool_use_error>', at(-1, 2), true),
    tool(OPUS, at(-1, 3), 't3', 'Bash', { command: 'npm test 2>&1 | tail -5' }, { id: 'A2', stop_reason: 'max_tokens', usage: { output_tokens: 5 } }),
    asst(OPUS, at(-1, 3), [{ type: 'text', text: 'cut' }], { id: 'A2', stop_reason: 'max_tokens' }),
    res('t3', 'Tests:  1 failed, 3 passed, 4 total', at(-1, 4)), // exit 0 (piped), failure only in the text
    { ...base(at(-1, 5)), type: 'system', subtype: 'compact_boundary' },
    prompt('sai rồi, vẫn lỗi ở giỏ hàng', at(-1, 60)), // correction of the opus turn, although sonnet answers it
    tool(SONNET, at(-1, 61), 't4', 'Edit', { file_path: '/w/shop/a.ts' }),
    res('t4', 'ok', at(-1, 61)),
    tool(SONNET, at(-1, 62), 't5', 'Bash', { command: 'npm test' }),
    { ...base(at(-1, 62)), type: 'assistant', isApiErrorMessage: true, error: 'rate_limit', apiErrorStatus: 429, message: { model: '<synthetic>', id: 'X', role: 'assistant', content: [{ type: 'text', text: 'API Error' }] } },
    { ...base(at(-1, 62)), type: 'system', subtype: 'api_error', error: { message: 'socket hang up', connection: { code: 'ECONNRESET' } }, retryAttempt: 1 },
    { ...base(at(-1, 63)), type: 'system', subtype: 'api_error', error: { message: 'socket hang up', connection: { code: 'ECONNRESET' } }, retryAttempt: 2 },
    res('t5', 'Tests:  4 passed, 4 total', at(-1, 64)),
    asst(OPUS, at(-1, 65), [{ type: 'text', text: 'done' }]),
    intr(at(-1, 66)), // turn 2 = sonnet (2 calls vs 1)
    prompt('<command-name>/clear</command-name>', at(-1, 90)),
    { type: 'custom-title', customTitle: 'Cart fix token=supersecretvalue123 postgres://admin:S3cretPw@db/x', sessionId: 's1' },
    { type: 'cost-state', sessionId: 's1', totalCostUSD: 0.2, modelUsage: { [OPUS]: { costUSD: 0.2 } } },
    { type: 'cost-state', sessionId: 's1', totalCostUSD: 1.5, totalLinesAdded: 10, totalLinesRemoved: 4, modelUsage: { [OPUS]: { costUSD: 1 }, [SONNET]: { costUSD: 0.5 } } },
    { type: 'pr-link', sessionId: 's1', prUrl: 'https://github.com/w/shop/pull/1' }, { type: 'pr-link', sessionId: 's1', prUrl: 'https://github.com/w/shop/pull/1' },
  ]);
  write(root, '-w-shop/s1/subagents/agent-a1.jsonl', [
    prompt('Find callers', at(-1, 10), { isSidechain: true }),
    tool(HAIKU, at(-1, 11), 'h1', 'WebFetch', { url: 'https://x.example/a' }, {}, { isSidechain: true }),
    res('h1', 'Request failed with status code 404', at(-1, 11), true, { isSidechain: true }),
    { type: 'cost-state', sessionId: 's1', totalCostUSD: 99, modelUsage: { [HAIKU]: { costUSD: 99 } } },
  ]);
  write(root, '-w-shop/s2.jsonl', [
    prompt('/esp-sync', at(0, -30), { entrypoint: 'sdk-cli' }),
    ...Array.from({ length: 10 }, (_, i) => asst('claude-haiku-4-5-20251001', at(0, -29 + i), [{ type: 'text', text: 'ok' }], {}, { entrypoint: 'sdk-cli' })),
  ]);
  write(root, '-w-blog/s3.jsonl', [
    prompt('add rss', at(-20, 0), { cwd: '/w/blog' }),
    tool(SONNET, at(-20, 0.5), 'd1', 'Bash', { command: 'ls' }, {}, { cwd: '/w/blog' }),
    res('d1', 'Exit code 1\nboom', at(-20, 1), true, { cwd: '/w/blog' }),
  ]);
  return root;
}
const by = (r: Awaited<ReturnType<ModelReport['report']>>, m: string) => r.models.find((x) => x.model === m)!;

describe('error classification and patterns', () => {
  it('classifies in the .py order (rejected, infra/deny/misuse overrides, infra, misuse, exit code, other)', () => {
    expect(classifyError("The user doesn't want to proceed with this tool use. Connection refused")).toBe('user_rejected');
    expect(classifyError('The server-side auto mode classifier gave no verdict; permission was denied by the Claude Code auto mode classifier')).toBe('infra');
    expect(classifyError('Permission for this action has been denied. Reason: prod write')).toBe('auto_denied');
    expect(classifyError('**Input Error** request timed out')).toBe('misuse');
    expect(classifyError('MCP error -32603: relation_not_found')).toBe('misuse');
    expect(classifyError('connect ECONNREFUSED 127.0.0.1:5432 (syntax error)')).toBe('infra');
    expect(classifyError('<tool_use_error>String to replace not found in file.</tool_use_error>')).toBe('misuse');
    expect(classifyError('Exit code 2\nls: x: No such file or directory')).toBe('misuse');
    expect(classifyError('Exit code 28\ncurl: operation aborted')).toBe('infra');
    expect(classifyError('Exit code 1\nboom')).toBe('cmd_fail');
    expect(classifyError('something odd')).toBe('other');
    expect(classifyError(`Exit code 1\n${'x'.repeat(3000)} Connection refused ${'x'.repeat(3000)}`)).toBe('cmd_fail'); // long: head 800 + tail 800 only
    expect(classifyError(`Exit code 1\n${'x'.repeat(5000)}\nConnection refused`)).toBe('infra');
  });
  it('normalizes and redacts patterns', () => {
    expect(errorPattern('Exit code 1\nok\nnpm ERR! failed at /Users/me/proj/src/a.ts line 12345\ndone')).toBe('Exit code 1 · npm ERR! failed at <path> line N');
    expect(errorPattern('<tool_use_error>Error: column "foo_bar" does not exist</tool_use_error>')).toBe('Error: column "…" does not exist');
    expect(errorPattern('connect 10.0.0.12:5432 failed for manh@example.com')).toBe('connect <ip> failed for <email>');
    expect(errorPattern('\n<system>x</system>\n   ')).toBe('(empty)');
    const p = errorPattern(`Invalid key ${SECRET} password=hunter2hunter2 Bearer abcdefgh12345678 at C:\\Users\\someone\\repo\\file.ts`);
    for (const s of [SECRET, 'hunter2', 'abcdefgh12345678', 'someone']) expect(p).not.toContain(s);
    expect(p).toContain('<path>');
    expect(errorPattern(`Error: ${'word '.repeat(60)}`)).toMatch(/^.{110}…$/);
  });
  it('masks every secret shape found in review, including the line appended after `Exit code N`', () => {
    const cases: Array<[string, string[]]> = [
      ['Error: Authorization: Bearer 9f8a7b6c5d4e3f2a1b0c failed', ['9f8a7b6c5d4e3f2a1b0c']],
      ['Error: Authorization: Bearer abc12 failed', ['abc12']],
      ['Exit code 22\ncurl: (22) The requested URL returned error: 401 https://api.example.com/v1/items?access_token=abc123short', ['abc123short']],
      ['Error 403 for https://maps.example.com/api?q=x&key=AIzaShort1', ['AIzaShort1']],
      ['could not connect to postgres://admin:S3cretPw@localhost:5432/app', ['S3cretPw', 'admin']],
      ['Exit code 1\nError: connect redis://:hunter2pw@localhost:6379 failed', ['hunter2pw']],
      ['(eval):1: command not found: mysql -uroot -pS3cretPw', ['S3cretPw']],
      ['invalid_client: client_secret=abcDEF123 rejected', ['abcDEF123']],
      ['HTTP 401 with header x-api-key: abcd1234efgh5678', ['abcd1234efgh5678']],
      ['request failed (api-key: k1k2k3k4)', ['k1k2k3k4']],
      ['bad request cookie: session=s3ss10n; theme=d4rk', ['s3ss10n', 'd4rk']],
      ['psql failed with pgpassword=hunter2 set', ['hunter2']],
      ['Exit code 1\nsshpass -p Pa55word ssh host: Permission denied', ['Pa55word']],
      ['error: {"api_key": "q9w8e7r6", "user": "x"}', ['q9w8e7r6']],
    ];
    for (const [txt, leaks] of cases) { const p = errorPattern(txt); for (const l of leaks) expect(p, txt).not.toContain(l); }
    expect(errorPattern('Error: Authorization: Bearer 9f8a7b6c5d4e3f2a1b0c failed')).toBe('Error: Authorization: … failed');
    expect(errorPattern('could not connect to postgres://admin:S3cretPw@localhost:5432/app')).toBe('could not connect to postgres://<cred>@localhost:N/app');
  });
  it('labels model ids', () => {
    expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5'); expect(modelLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5');
    expect(modelLabel('claude-sonnet-4-20250514')).toBe('Sonnet 4'); expect(modelLabel('gpt-x')).toBe('gpt-x');
  });
});

describe('ModelReport', () => {
  it('dedupes API calls by message id; attributes turns, interrupts and corrections; verify by exit code or text; costs from main files only', async () => {
    const root = world(), r = new ModelReport(root, { now: () => NOW, home: '/home/me' });
    const a = await r.report({ days: 30 });
    expect(a).toMatchObject({ days: 30, since: new Date(2026, 9, 22).getTime(), generatedAt: NOW, auto: false, autoSkipped: 1, sessions: 2 });
    expect(a.models.map((m) => m.model)).toEqual([OPUS, SONNET, HAIKU]);
    expect(a.modelOrder).toEqual(['claude-haiku-4-5-20251001', OPUS, SONNET, HAIKU]); // every transcript, automation included
    expect(by(a, OPUS)).toMatchObject({ label: 'Opus 5.5', sessions: 1, subagentRuns: 0, turns: 1, prompts: 1, apiCalls: 3, toolCalls: 3, edits: 1, editFails: 1, interrupts: 0, corrections: 1,
      verifyRuns: 1, verifyFails: 1, verifySessions: 1, verifyGreen: 1, turnMedianMs: 5 * 60_000, turnP90Ms: 5 * 60_000, outputTokens: 55, costUsd: 1, compactions: 1, maxTokensStops: 1,
      refusals: 0, linesChanged: 14, prs: 1, effort: { high: 1 }, smallSample: true, errors: { misuse: 1, cmd_fail: 0, infra: 0, auto_denied: 0, user_rejected: 0, other: 0 } });
    expect(by(a, SONNET)).toMatchObject({ sessions: 1, turns: 2, prompts: 2, apiCalls: 3, toolCalls: 3, edits: 1, editFails: 0, interrupts: 1, corrections: 0, verifyRuns: 1, verifyFails: 0,
      turnMedianMs: 60_000, turnP90Ms: 6 * 60_000, costUsd: 0.5, errors: { cmd_fail: 1 } }); // turn 2 ends at the Esc (66 min), not at the next prompt (90 min)
    expect(by(a, HAIKU)).toMatchObject({ sessions: 0, subagentRuns: 1, turns: 0, prompts: 0, apiCalls: 1, toolCalls: 1, costUsd: 0, errors: { other: 1 } });
    expect(a.totals).toEqual({ turns: 3, toolCalls: 7, errors: { misuse: 1, cmd_fail: 1, infra: 0, auto_denied: 0, user_rejected: 0, other: 1 }, interrupts: 1, corrections: 1, costUsd: 1.5, apiErrors: 1, retryIncidents: 1 });
    expect(a.apiErrors).toEqual([{ kind: 'rate_limit (429)', count: 1, lastAt: Date.parse(at(-1, 62)) }]);
    expect(a.retries).toEqual([{ kind: 'ECONNRESET', incidents: 1, retries: 2 }]);
    expect(a.tools).toEqual([{ tool: 'Bash', calls: 3, errors: 1, byCategory: { cmd_fail: 1 } }, { tool: 'Edit', calls: 2, errors: 1, byCategory: { misuse: 1 } }, { tool: 'WebFetch', calls: 1, errors: 1, byCategory: { other: 1 } }]);
    expect(a.patterns).toEqual([
      { category: 'misuse', pattern: 'String to replace not found in file.', count: 1, tool: 'Edit', byModel: { [OPUS]: 1 }, lastAt: Date.parse(at(-1, 2)) },
      { category: 'cmd_fail', pattern: 'Exit code 1', count: 1, tool: 'Bash', byModel: { [SONNET]: 1 }, lastAt: Date.parse(at(-20, 1)) },
      { category: 'other', pattern: 'Request failed with status code 404', count: 1, tool: 'WebFetch', byModel: { [HAIKU]: 1 }, lastAt: Date.parse(at(-1, 11)) },
    ]);
    expect(a.review).toEqual([{ sid: 's1', title: 'Cart fix token=… postgres://<cred>@db/x', project: '/w/shop', projectName: 'shop', model: OPUS, lastAt: Date.parse(at(-1, 90)), turns: 2, toolCalls: 5, misuse: 1, interrupts: 1, corrections: 1, rejected: 0, costUsd: 1.5, score: 5 }]);
    const json = JSON.stringify(a);
    for (const s of ['supersecretvalue123', 'S3cretPw', 'TOOLRESULTTEXT', 'PROMPTTEXT', 'giỏ hàng', 'total = 1']) expect(json).not.toContain(s);
  });
  it('freshness: scannedAt / refreshing / generatedAt; fresh waits for a scan started after the request; one scan at a time; memo per scan', async () => {
    const root = world(), r = new ModelReport(root, { now: () => NOW, ttlMs: 60_000 });
    const t0 = Date.now(), [x, y] = await Promise.all([r.report(), r.report({ days: 7 })]), t1 = Date.now();
    expect(r.stats).toMatchObject({ files: 4, parsed: 4 }); // the two first calls shared one scan
    expect(x).toMatchObject({ generatedAt: NOW, scannedAt: r.scannedAt, refreshing: false }); expect(y.scannedAt).toBe(r.scannedAt);
    expect(x.scannedAt).toBeGreaterThanOrEqual(t0); expect(x.scannedAt).toBeLessThanOrEqual(t1);
    write(root, '-w-blog/s5.jsonl', [prompt('more', at(-2)), tool(SONNET, at(-2, 1), 'f1', 'Read', {})]);
    expect((await r.report()).totals.toolCalls).toBe(7); // within the TTL: cached
    const orig = (r as any).scan.bind(r); let scans = 0, active = 0, most = 0;
    (r as any).scan = async () => { scans++; most = Math.max(most, ++active); try { return await orig(); } finally { active--; } };
    const running = r.refresh(); write(root, '-w-blog/s6.jsonl', [prompt('later', at(-2)), tool(SONNET, at(-2, 2), 'g1', 'Read', {})]);
    const [f, g] = await Promise.all([r.report({ fresh: true }), r.report({ fresh: true })]); await running;
    expect(f.totals.toolCalls).toBe(9); expect(g.totals.toolCalls).toBe(9); expect(f).toMatchObject({ refreshing: false, scannedAt: r.scannedAt });
    expect([scans, most]).toEqual([2, 1]); // the running scan, then one shared scan for both fresh requests
    const before = (await r.report()).scannedAt; await new Promise((res) => setTimeout(res, 5)); await r.refresh();
    expect((await r.report()).scannedAt).toBeGreaterThan(before); // nothing changed, but the answer names the newer scan
    const s = new ModelReport(root, { now: () => NOW, ttlMs: 0 });
    expect((await s.report()).refreshing).toBe(false); expect((await s.report()).refreshing).toBe(true); await s.refresh();
  });
  it('modelOrder: API calls in the last 52 weeks first, then older models', async () => {
    const root = mkdtempSync(join(tmpdir(), 'deck-mr-'));
    write(root, '-w-x/o1.jsonl', [prompt('old', at(-60 * 7)), ...Array.from({ length: 30 }, (_, i) => asst('claude-opus-4-1', at(-60 * 7, i + 1), [{ type: 'text', text: 'ok' }]))]);
    write(root, '-w-x/o2.jsonl', [prompt('new', at(-1)), asst(SONNET, at(-1, 1), []), asst(OPUS, at(-1, 2), []), asst(OPUS, at(-1, 3), [])]);
    const a = await new ModelReport(root, { now: () => NOW }).report({ days: 0 });
    expect(a.modelOrder).toEqual([OPUS, SONNET, 'claude-opus-4-1']);
    expect(a.models.map((m) => m.model)).toEqual(['claude-opus-4-1', OPUS, SONNET]); // rows: most calls in the window
  });
  it('auto=1 counts automation sessions', async () => {
    const r = new ModelReport(world(), { now: () => NOW });
    const a = await r.report({ days: 30, auto: true });
    expect(a).toMatchObject({ auto: true, autoSkipped: 0, sessions: 3 });
    expect(by(a, 'claude-haiku-4-5-20251001')).toMatchObject({ label: 'Haiku 4.5', sessions: 1, apiCalls: 10, turns: 1, prompts: 0 });
    expect(a.models[0].model).toBe('claude-haiku-4-5-20251001');
  });
  it('windows are local calendar days; the trend is 12..52 Monday weeks ending this week', async () => {
    const r = new ModelReport(world(), { now: () => NOW });
    const w7 = await r.report({ days: 7 });
    expect(w7).toMatchObject({ since: new Date(2026, 10, 14).getTime(), sessions: 1 });
    expect(by(w7, SONNET)).toMatchObject({ sessions: 0, turns: 1, toolCalls: 2, errors: { cmd_fail: 0 } });
    expect(w7.trend).toHaveLength(12);
    expect(w7.trend.at(-1)).toEqual({ week: '2026-11-16', models: { [OPUS]: { toolCalls: 3, misuse: 1, turns: 1, interrupts: 0, corrections: 1 }, [SONNET]: { toolCalls: 2, misuse: 0, turns: 1, interrupts: 1, corrections: 0 }, [HAIKU]: { toolCalls: 1, misuse: 0, turns: 0, interrupts: 0, corrections: 0 } } });
    expect(w7.trend.find((w) => w.week === '2026-10-26')).toEqual({ week: '2026-10-26', models: { [SONNET]: { toolCalls: 1, misuse: 0, turns: 1, interrupts: 0, corrections: 0 } } }); // outside the window, inside the trend
    expect(w7.trend[0]).toEqual({ week: '2026-08-31', models: {} });
    expect((await r.report({ days: 120 })).trend).toHaveLength(18);
    const all = await r.report({ days: 0 });
    expect(all).toMatchObject({ days: 0, since: new Date(2026, 9, 31).getTime(), sessions: 2 }); expect(all.trend).toHaveLength(52);
    const d1 = await r.report({ days: 1 });
    expect(d1).toMatchObject({ since: new Date(2026, 10, 20).getTime(), sessions: 0, autoSkipped: 1, models: [], review: [] });
    const root = mkdtempSync(join(tmpdir(), 'deck-mr-'));
    write(root, '-w-x/b1.jsonl', [prompt('go', new Date(2026, 10, 19, 23, 0).toISOString()), tool(OPUS, new Date(2026, 10, 19, 23, 30).toISOString(), 'x1', 'Read', {}), tool(OPUS, new Date(2026, 10, 20, 0, 30).toISOString(), 'x2', 'Read', {})]);
    const b = new ModelReport(root, { now: () => NOW });
    expect(by(await b.report({ days: 1 }), OPUS)).toMatchObject({ toolCalls: 1, turns: 0, sessions: 1 }); // the turn started yesterday
    expect(by(await b.report({ days: 2 }), OPUS)).toMatchObject({ toolCalls: 2, turns: 1, sessions: 1 });
  });
  it('re-parses only new or changed files, drops deleted ones, and answers stale requests at once', async () => {
    const root = world(), r = new ModelReport(root, { now: () => NOW, ttlMs: 60_000 });
    expect((await r.report()).totals.toolCalls).toBe(7);
    expect(r.stats).toMatchObject({ files: 4, parsed: 4 });
    await r.refresh(); expect(r.stats).toMatchObject({ files: 4, parsed: 0 });
    appendFileSync(join(root, '-w-blog/s3.jsonl'), JSON.stringify(tool(SONNET, at(-20, 2), 'd2', 'Read', {}, {}, { cwd: '/w/blog' })) + '\n');
    write(root, '-w-blog/s4.jsonl', [prompt('more', at(-2)), tool(SONNET, at(-2, 1), 'e1', 'Read', {})]);
    await r.refresh(); expect(r.stats).toMatchObject({ files: 5, parsed: 2 });
    expect((await r.report()).totals.toolCalls).toBe(9);
    rmSync(join(root, '-w-shop/s1'), { recursive: true });
    await r.refresh(); expect(r.stats).toMatchObject({ files: 4, parsed: 0 });
    expect((await r.report()).totals.toolCalls).toBe(8);
    const s = new ModelReport(root, { now: () => NOW, ttlMs: 0 });
    await s.report();
    appendFileSync(join(root, '-w-blog/s4.jsonl'), JSON.stringify(tool(SONNET, at(-2, 2), 'e2', 'Read', {})) + '\n');
    expect((await s.report()).totals.toolCalls).toBe(8); // stale answer, refresh started in the background
    await s.refresh();
    expect((await s.report()).totals.toolCalls).toBe(9);
  });
  it('subagent transcripts: no prompts, turns or cost; skipped with their automation parent', async () => {
    const root = mkdtempSync(join(tmpdir(), 'deck-mr-'));
    write(root, '-w-x/p1.jsonl', [prompt('go', at(-1), { entrypoint: 'sdk-cli' }), asst(OPUS, at(-1, 1), [{ type: 'text', text: 'ok' }], {}, { entrypoint: 'sdk-cli' })]);
    write(root, '-w-x/p1/subagents/agent-1.jsonl', [prompt('sai rồi', at(-1, 2), { entrypoint: 'sdk-cli', isSidechain: true }), tool(HAIKU, at(-1, 3), 'k1', 'Read', {}, {}, { entrypoint: 'sdk-cli', isSidechain: true })]);
    const r = new ModelReport(root, { now: () => NOW });
    expect(await r.report()).toMatchObject({ autoSkipped: 1, sessions: 0, models: [] });
    const a = await r.report({ auto: true });
    expect(by(a, HAIKU)).toMatchObject({ subagentRuns: 1, sessions: 0, turns: 0, prompts: 0, corrections: 0, toolCalls: 1 });
    expect(by(a, OPUS)).toMatchObject({ sessions: 1, turns: 1, prompts: 1 });
  });
  it('kept lines over 8 MB are dropped unparsed; the entrypoint peek reads non-kept lines within the first 60 only', async () => {
    const root = mkdtempSync(join(tmpdir(), 'deck-mr-'));
    write(root, '-w-x/big.jsonl', [prompt('go', at(-1)), tool(OPUS, at(-1, 1), 'b1', 'Read', {}), tool(OPUS, at(-1, 2), 'b2', 'Write', { content: 'x'.repeat(9 << 20) }), tool(OPUS, at(-1, 3), 'b3', 'Read', {})]);
    expect(by(await new ModelReport(root, { now: () => NOW }).report(), OPUS)).toMatchObject({ toolCalls: 2, edits: 0, apiCalls: 2, turns: 1 });
    const r2 = mkdtempSync(join(tmpdir(), 'deck-mr-')), none = { entrypoint: undefined };
    const att = { parentUuid: null, isSidechain: false, attachment: { type: 'hook_success' }, type: 'attachment', uuid: 'att', timestamp: at(-1), entrypoint: 'sdk-cli', cwd: '/w/x', sessionId: 'p1' };
    write(r2, '-w-x/p1.jsonl', [att, prompt('/esp-sync', at(-1, 1), none), asst(OPUS, at(-1, 2), [], {}, none)]); // only the attachment says sdk-cli
    const q = { type: 'queue-operation', operation: 'enqueue', timestamp: at(-1), sessionId: 'p2' };
    write(r2, '-w-x/p2.jsonl', [...Array.from({ length: 60 }, () => q), att, prompt('typed', at(-1, 1), none), asst(OPUS, at(-1, 2), [], {}, none)]); // sdk-cli only after line 60
    expect(await new ModelReport(r2, { now: () => NOW }).report()).toMatchObject({ autoSkipped: 1, sessions: 1, review: [] });
  });
  it('missing root, unreadable lines and huge lines are tolerated', async () => {
    expect(await new ModelReport(join(tmpdir(), 'deck-mr-nope-x'), { now: () => NOW }).report()).toMatchObject({ sessions: 0, models: [], trend: expect.any(Array) });
    const root = mkdtempSync(join(tmpdir(), 'deck-mr-'));
    write(root, '-w-x/q1.jsonl', ['{not json', JSON.stringify({ type: 'api-request-blob', body: 'x'.repeat(3 << 20) }), prompt('go', at(-1)), tool(OPUS, at(-1, 1), 'q', 'Read', {}), '{"type":"assistant","trunc']);
    expect(by(await new ModelReport(root, { now: () => NOW }).report(), OPUS)).toMatchObject({ toolCalls: 1, turns: 1 });
  });
  it('the demo fixtures give a non-empty report (two models, every error cause, Esc, correction, red then green tests, cost)', async () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/demo/history');
    const a = await new ModelReport(root, { now: () => DEMO_NOW }).report({ days: 30 });
    expect(a.sessions).toBeGreaterThanOrEqual(3); expect(a.autoSkipped).toBe(1); expect(a.models.length).toBeGreaterThanOrEqual(2);
    for (const k of ['misuse', 'cmd_fail', 'infra', 'auto_denied', 'user_rejected', 'other'] as const) expect(a.totals.errors[k]).toBeGreaterThan(0);
    expect(a.totals).toMatchObject({ interrupts: expect.any(Number), corrections: expect.any(Number) });
    expect(a.totals.interrupts).toBeGreaterThan(0); expect(a.totals.corrections).toBeGreaterThan(0); expect(a.totals.costUsd).toBeGreaterThan(0);
    expect(a.models.some((m) => m.verifyFails > 0 && m.verifyGreen > 0)).toBe(true);
    expect(a.models.some((m) => m.subagentRuns > 0)).toBe(true);
    expect(a.review.length).toBeGreaterThan(0); expect(a.apiErrors.length).toBeGreaterThan(0); expect(a.retries.length).toBeGreaterThan(0);
    expect(a.trend.filter((w) => Object.keys(w.models).length).length).toBeGreaterThanOrEqual(2);
  });
});
