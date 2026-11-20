import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ITERM_SCRIPT, OPENER_CAP, SAFE_SCRIPT_PATH, TERMINAL_SCRIPT, SessionOpener, resumeScript, shellQuote, type Exec, type ExecResult, type OpenerFs, type SessionLocation, type SessionOpenerOpts } from '../src/opener.js';

const SID = '7f3c2a10-5b6e-4d21-9a8f-0c1d2e3f4a05', SID2 = '11111111-2222-4333-8444-555555555555', CLAUDE = '/Users/me/.local/bin/claude', NOW = Date.parse('2026-11-20T05:00:00Z');
const OK: ExecResult = { code: 0, stdout: '', stderr: '' };
type Call = { bin: string; args: string[]; env: NodeJS.ProcessEnv };
const folderOf = (cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, '-');
/** fake fs: `dirs` are directories; files map path → content */
function fakeFs(dirs: string[], files: Record<string, string> = {}): OpenerFs {
  const d = new Set(dirs);
  return {
    kind: async (p) => (d.has(p) ? 'dir' : p in files ? 'file' : null),
    list: async (dir) => [...new Set([...d, ...Object.keys(files)].filter((p) => p.startsWith(`${dir}/`) || p.startsWith(`${dir}\\`)).map((p) => p.slice(dir.length + 1).split(/[\\/]/)[0]))],
    read: async (p) => files[p],
  };
}
/** fake exec: plutil answers from `bundles`, mdfind from `spotlight`, lsappinfo from `running()`, osascript/open from `answer` */
function fakeExec(bundles: Record<string, string>, spotlight: Record<string, string[]> = {}, answer: (c: Call) => ExecResult | Promise<ExecResult> = () => OK, running: (bundle: string) => boolean = () => true) {
  const calls: Call[] = [];
  const exec: Exec = async (bin, args, o) => {
    const c = { bin, args, env: o.env }; calls.push(c);
    if (bin === '/usr/bin/plutil') { const app = args[5].replace(/\/Contents\/Info\.plist$/, ''); return app in bundles ? { ...OK, stdout: `${bundles[app]}\n` } : { code: 1, stdout: '', stderr: 'no plist' }; }
    if (bin === '/usr/bin/mdfind') { const id = /'([^']+)'/.exec(args[0])![1]; return { ...OK, stdout: (spotlight[id] ?? []).join('\n') + '\n' }; }
    if (bin === '/usr/bin/lsappinfo') return { ...OK, stdout: running(args[4]) ? '"pid"=4242\n' : '' };
    return answer(c);
  };
  return { exec, calls };
}
const HOME = '/Users/me', EXT = `${HOME}/.cursor/extensions`;
type MacOpts = Partial<SessionOpenerOpts> & { answer?: (c: Call) => ExecResult | Promise<ExecResult>; ext?: boolean; cwd?: string; live?: boolean; at?: Partial<SessionLocation>; running?: (b: string) => boolean };
/** a Mac with iTerm in ~/Applications, Terminal in Utilities, Cursor found by Spotlight only, Cursor's extension installed; every sid in `sids` is indexed */
function mac(o: MacOpts = {}) {
  const cwd = o.cwd ?? '/w/shop', runDir = o.runDir ?? mkdtempSync(join(tmpdir(), 'office-run-'));
  const fs = fakeFs(['/A/Cursor.app', `${HOME}/Applications/iTerm.app`, '/S/Utilities/Terminal.app', '/Other/Cursor.app', '/Applications/Cursor 2.app', `${HOME}/Downloads/Cursor.app`, `${HOME}/.Trash/Cursor.app`, cwd,
    ...(o.ext === false ? [] : [`${EXT}/anthropic.claude-code-2.1.329-darwin-arm64`])], { [`${EXT}/.obsolete`]: '{"anthropic.claude-code-2.1.1-darwin-arm64":true}', [`${EXT}/anthropic.claude-code-2.1.1-darwin-arm64/x`]: '' });
  const { exec, calls } = fakeExec({ '/A/Cursor.app': 'com.example.NotCursor', [`${HOME}/Applications/iTerm.app`]: 'com.googlecode.iterm2', '/S/Utilities/Terminal.app': 'com.apple.Terminal' },
    { 'com.todesktop.230313mzl4w4u92': [`${HOME}/Downloads/Cursor.app`, `${HOME}/.Trash/Cursor.app`, '/Other/Cursor.app', '/Applications/Cursor 2.app'] }, o.answer, o.running);
  const sleeps: number[] = [], later: Array<[() => void, number]> = [];
  const op = new SessionOpener({ platform: 'darwin', home: HOME, appDirs: ['/A', `${HOME}/Applications`, '/S/Utilities'], fs, exec, sleep: async (ms) => { sleeps.push(ms); }, claude: () => CLAUDE, now: () => NOW, runDir,
    historyRoot: `${HOME}/.claude/projects`, later: (fn, ms) => { later.push([fn, ms]); },
    env: { HOME, USER: 'me', PATH: '/x/bin', CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'abc', OFFICE_RUN_DIR: '/r', ANTHROPIC_API_KEY: 'sk-ant-secret', NODE_OPTIONS: '--require x' },
    locate: async (sid) => ([SID, SID2].includes(sid) ? { cwd, project: '/w/shop', folder: folderOf(cwd), mtimeMs: NOW - 3_600_000, ...o.at } : null), isLive: () => !!o.live, ...o });
  return { op, calls, sleeps, later, runDir, get launches() { return calls.filter((c) => c.bin === '/usr/bin/osascript' || c.bin === '/usr/bin/open'); } };
}
const scripts = (runDir: string) => (existsSync(join(runDir, 'resume')) ? readdirSync(join(runDir, 'resume')) : []);

describe('SessionOpener detection', () => {
  it('macOS: bundle id in the app folders, then Spotlight (Applications first; Downloads, Trash, other volumes skipped); resumes needs a live extension folder; cached ~60 s', async () => {
    let now = 1000; const { op, calls } = mac({ now: () => now });
    expect(await op.openers()).toEqual({ openers: [{ id: 'iterm', label: 'iTerm', kind: 'terminal', resumes: true }, { id: 'terminal', label: 'Terminal', kind: 'terminal', resumes: true },
      { id: 'cursor', label: 'Cursor', kind: 'editor', resumes: true }] });
    expect(calls.filter((c) => c.bin === '/usr/bin/mdfind').map((c) => c.args[0]).sort()).toEqual(["kMDItemCFBundleIdentifier == 'com.microsoft.VSCode'", "kMDItemCFBundleIdentifier == 'com.todesktop.230313mzl4w4u92'"]);
    expect(calls.every((c) => ['/usr/bin/plutil', '/usr/bin/mdfind'].includes(c.bin))).toBe(true); // detection never launches anything
    expect((op as any).cache.list.find((f: any) => f.id === 'cursor').path).toBe('/Applications/Cursor 2.app');
    const n = calls.length; now += 59_000; await op.openers(); expect(calls.length).toBe(n);
    now += 2000; await op.openers(); expect(calls.length).toBeGreaterThan(n);
    expect((await mac({ ext: false }).op.openers()).openers.find((x) => x.id === 'cursor')).toMatchObject({ resumes: false }); // only an obsolete version left
    const { op: o2, calls: c2 } = mac(); await Promise.all([o2.openers(), o2.openers()]); expect(c2.filter((c) => c.bin === '/usr/bin/mdfind')).toHaveLength(2); // one detection at a time
  });
  it('Windows: Windows Terminal (WindowsApps or PATH), Cursor / VS Code executables; other OSes and demo list nothing with a reason', async () => {
    const la = 'C:\\Users\\me\\AppData\\Local', fs = fakeFs([`C:\\Users\\me\\.cursor\\extensions\\anthropic.claude-code-2.1.329-win32-x64`], { 'D:\\tools\\wt.exe': '', [`${la}\\Programs\\cursor\\Cursor.exe`]: '' });
    const op = new SessionOpener({ platform: 'win32', home: 'C:\\Users\\me', env: { LOCALAPPDATA: la, PATH: 'C:\\x;D:\\tools;relative' }, fs, exec: fakeExec({}).exec, locate: async () => null });
    expect(await op.openers()).toEqual({ openers: [{ id: 'windows-terminal', label: 'Windows Terminal', kind: 'terminal', resumes: true }, { id: 'cursor', label: 'Cursor', kind: 'editor', resumes: true }] });
    expect(await new SessionOpener({ platform: 'linux', locate: async () => null }).openers()).toEqual({ openers: [], reason: expect.stringContaining('macOS') });
    const { op: d, calls } = mac({ demo: true });
    expect(await d.openers()).toEqual({ openers: [], reason: expect.stringContaining('demo') });
    expect(await d.open({ sid: SID, app: 'iterm' })).toMatchObject({ status: 409, body: { error: 'unavailable' } }); expect(calls).toEqual([]);
    expect(await new SessionOpener({ platform: 'darwin', fs: fakeFs([]), appDirs: [], locate: async () => null }).openers()).toEqual({ openers: [], reason: expect.any(String) }); // vitest: no real exec
  });
});

describe('resume script', () => {
  it('is plain /bin/sh: cd fails closed, optional CLAUDE_CONFIG_DIR, exec claude; a fish/tcsh-hostile cwd survives /bin/sh quoting', () => {
    expect(resumeScript('/w/shop', CLAUDE, SID)).toBe(`#!/bin/sh\ncd -- '/w/shop' || exit 1\nexec '${CLAUDE}' --resume ${SID}\n`);
    expect(resumeScript('/w/it\'s', '/opt/c laude', SID, '/cfg/x')).toBe(`#!/bin/sh\ncd -- '/w/it'\\''s' || exit 1\nexport CLAUDE_CONFIG_DIR='/cfg/x'\nexec '/opt/c laude' --resume ${SID}\n`);
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
    if (process.platform === 'win32') return;
    const base = mkdtempSync(join(tmpdir(), 'office-q-')), nasty = join(base, `a\\'b "c" $(echo INJECTED) \`echo TICK\` !! ; & * ~`); mkdirSync(nasty);
    const fake = join(base, 'fake claude.sh'); writeFileSync(fake, '#!/bin/sh\nprintf \'%s|\' "$(pwd -P)" "$@"\n'); chmodSync(fake, 0o755); // stands in for claude: prints where it runs and its args
    const s = join(base, 'resume.sh'); writeFileSync(s, resumeScript(nasty, fake, SID, '/cfg/x'));
    expect(execFileSync('/bin/sh', [s], { encoding: 'utf8' })).toBe(`${realpathSync(nasty)}|--resume|${SID}|`);
  });
});

describe('SessionOpener launching (macOS)', () => {
  it('iTerm / Terminal: transcript data only in a 0600 script; the typed text is only `/bin/sh <safe path>`; constant AppleScripts; minimal env; deleted after 2 min', async () => {
    const cwd = `/w/a\\'b "c" $(rm -rf ~) \`id\` !! ; fish`, m = mac({ cwd }), op = m.op;
    expect(await op.open({ sid: SID, app: 'iterm' })).toEqual({ status: 200, body: { ok: true, app: 'iterm', project: '/w/shop', resumed: true, note: expect.stringContaining('iTerm') } });
    expect(await op.open({ sid: SID2, app: 'terminal' })).toMatchObject({ status: 200, body: { app: 'terminal', resumed: true } });
    const [it1, te1] = m.launches;
    expect(it1.bin).toBe('/usr/bin/osascript'); expect(it1.args.slice(0, -1)).toEqual(ITERM_SCRIPT.flatMap((l) => ['-e', l])); expect(te1.args.slice(0, -1)).toEqual(TERMINAL_SCRIPT.flatMap((l) => ['-e', l]));
    for (const c of [it1, te1]) {
      const typed = c.args.at(-1)!, path = /^\/bin\/sh '(.+)'$/.exec(typed)![1];
      expect(path).toMatch(SAFE_SCRIPT_PATH); expect(path.startsWith(join(m.runDir, 'resume') + '/')).toBe(true); expect(path).toMatch(/\/[a-z0-9]+\.sh$/);
      expect(typed).not.toContain('rm -rf'); expect(typed).not.toContain('fish');
      expect(readFileSync(path, 'utf8')).toBe(resumeScript(cwd, CLAUDE, c === it1 ? SID : SID2)); // the cwd lives only here, /bin/sh-quoted
      expect(statSync(path).mode & 0o777).toBe(0o600);
    }
    expect(statSync(join(m.runDir, 'resume')).mode & 0o777).toBe(0o700);
    for (const l of [...ITERM_SCRIPT, ...TERMINAL_SCRIPT]) expect(l).not.toMatch(/rm -rf|\/w\/|resume\//); // data never reaches the AppleScript source
    expect(ITERM_SCRIPT).toContain('set wasRunning to application id "com.googlecode.iterm2" is running'); expect(TERMINAL_SCRIPT).toContain('do script cmd in window 1');
    expect(it1.env).toEqual({ PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME, USER: 'me' }); // no CLAUDECODE / CLAUDE_CODE_* / OFFICE_* / NODE_OPTIONS / keys
    expect(m.later.map(([, ms]) => ms)).toEqual([120_000, 120_000]);
    expect(scripts(m.runDir)).toHaveLength(2); for (const [fn] of m.later) fn(); await new Promise((r) => setTimeout(r, 20)); expect(scripts(m.runDir)).toEqual([]);
  });
  it('CLAUDE_CONFIG_DIR: a non-default History root or the office env is passed on in the script only', async () => {
    const line = async (o: MacOpts) => { const m = mac(o); await m.op.open({ sid: SID, app: 'iterm' }); return readFileSync(/'(.+)'/.exec(m.launches[0].args.at(-1)!)![1], 'utf8'); };
    expect(await line({})).not.toContain('CLAUDE_CONFIG_DIR');
    expect(await line({ historyRoot: '/cfg/alt/projects' })).toContain("export CLAUDE_CONFIG_DIR='/cfg/alt'\n");
    expect(await line({ env: { HOME, CLAUDE_CONFIG_DIR: '/cfg/env' } })).toContain("export CLAUDE_CONFIG_DIR='/cfg/env'\n");
  });
  it('osascript failures: -1743 → not-authorized, timeout → automation-pending, other → launch-failed (redacted); the script is removed', async () => {
    const run = async (answer: () => ExecResult) => { const m = mac({ answer }); const r = await m.op.open({ sid: SID, app: 'iterm' }); return { r, left: scripts(m.runDir) }; };
    const denied = await run(() => ({ code: 1, stdout: '', stderr: '0:120: execution error: Not authorized to send Apple events to iTerm. (-1743)' }));
    expect(denied).toEqual({ r: { status: 409, body: { error: 'not-authorized', reason: expect.stringContaining('Privacy & Security → Automation') } }, left: [] });
    const pending = await run(() => ({ code: null, stdout: '', stderr: '', error: 'timed out' }));
    expect(pending).toEqual({ r: { status: 409, body: { error: 'automation-pending', reason: 'macOS đang hỏi quyền cho phép điều khiển iTerm — bấm OK rồi thử lại.' } }, left: [] });
    const broken = await run(() => ({ code: 1, stdout: '', stderr: 'execution error: boom sk-abcdefghijklmnop1234 (-2700)' }));
    expect(broken.r).toMatchObject({ status: 500, body: { error: 'launch-failed' } }); expect(JSON.stringify(broken)).not.toContain('sk-abcdefghijklmnop1234'); expect(broken.left).toEqual([]);
    expect(OPENER_CAP.osaMs).toBe(60_000);
  });
  it('refuses a run dir that is unsafe to type, or missing; sweeps scripts older than 10 min', async () => {
    const bad = mkdtempSync(join(tmpdir(), "office-it's-")), m = mac({ runDir: bad });
    expect(await m.op.open({ sid: SID, app: 'iterm' })).toMatchObject({ status: 500, body: { error: 'unsafe-path' } }); expect(m.launches).toEqual([]); expect(scripts(bad)).toEqual([]);
    expect(await mac({ runDir: '' }).op.open({ sid: SID, app: 'terminal' })).toMatchObject({ status: 500, body: { error: 'unsafe-path' } });
    expect(SAFE_SCRIPT_PATH.test('/Users/CrossianLLC/1.ManhST/1.SRC/mine/claude-office/claude-office/orchestrator/.run/resume/0a1b2c3d4e5f.sh')).toBe(true);
    const runDir = mkdtempSync(join(tmpdir(), 'office-run-')), dir = join(runDir, 'resume'), old = (Date.now() - 11 * 60_000) / 1000; mkdirSync(dir);
    for (const n of ['old1.sh', 'new1.sh', 'Keep.sh', 'x.txt']) writeFileSync(join(dir, n), '');
    for (const n of ['old1.sh', 'Keep.sh', 'x.txt']) utimesSync(join(dir, n), old, old);
    const s = new SessionOpener({ platform: 'darwin', runDir, locate: async () => null, exec: fakeExec({}).exec }); await s.sweep();
    expect(readdirSync(dir).sort()).toEqual(['Keep.sh', 'new1.sh', 'x.txt']);
  });
  it('Cursor: running → open -a, 1.5 s, link; cold start → polls lsappinfo up to 6 s first; no extension → folder only', async () => {
    const m = mac({ cwd: '/w/my shop' });
    expect(await m.op.open({ sid: SID, app: 'cursor' })).toEqual({ status: 200, body: { ok: true, app: 'cursor', project: '/w/shop', resumed: true, note: expect.any(String) } });
    expect(m.launches.map((c) => [c.bin, c.args])).toEqual([['/usr/bin/open', ['-a', '/Applications/Cursor 2.app', '/w/my shop']], ['/usr/bin/open', [`cursor://anthropic.claude-code/open?session=${SID}`]]]);
    expect(m.sleeps).toEqual([1500]);
    let checks = 0; const cold = mac({ running: () => ++checks >= 4 }); // not running at first, registered on the 3rd poll
    await cold.op.open({ sid: SID, app: 'cursor' }); expect(cold.sleeps).toEqual([500, 500, 1500]);
    const never = mac({ running: () => false }); await never.op.open({ sid: SID, app: 'cursor' }); expect(never.sleeps).toEqual([...Array(12).fill(500), 1500]);
    const bare = mac({ ext: false });
    expect(await bare.op.open({ sid: SID, app: 'cursor' })).toMatchObject({ status: 200, body: { resumed: false, note: expect.stringContaining('extension') } }); expect(bare.launches).toHaveLength(1);
    const noUri = mac({ answer: (c) => (c.args[0].startsWith('cursor://') ? { code: 1, stdout: '', stderr: 'no handler' } : OK) });
    expect(await noUri.op.open({ sid: SID, app: 'cursor' })).toMatchObject({ status: 200, body: { resumed: false } });
  });
});

describe('SessionOpener launching (Windows)', () => {
  const la = 'C:\\Users\\me\\AppData\\Local', wt = `${la}\\Microsoft\\WindowsApps\\wt.exe`, cur = `${la}\\Programs\\cursor\\Cursor.exe`, cwd = 'C:\\w\\a;b c';
  const win = (o: { claude?: string; spawnOk?: (n: number) => boolean; cwd?: string } = {}) => {
    const dir = o.cwd ?? cwd, fs = fakeFs([dir, 'C:\\Users\\me\\.cursor\\extensions\\anthropic.claude-code-2.1.329-win32-x64'], { [wt]: '', [cur]: '' }), launched: Array<[string, string[], NodeJS.ProcessEnv]> = [];
    const op = new SessionOpener({ platform: 'win32', home: 'C:\\Users\\me', historyRoot: 'D:\\cfg\\projects', fs, exec: fakeExec({}).exec, sleep: async () => {}, now: () => NOW, claude: () => o.claude ?? 'C:\\Program Files\\claude\\claude.exe',
      env: { LOCALAPPDATA: la, Path: 'C:\\bin', SystemRoot: 'C:\\Windows', ComSpec: 'C:\\Windows\\system32\\cmd.exe', CLAUDECODE: '1', OFFICE_RUN_DIR: 'x', ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--require x', VSCODE_PID: '1', ANTHROPIC_API_KEY: 'k' },
      launch: async (bin, args, env) => { launched.push([bin, args, env]); return o.spawnOk ? o.spawnOk(launched.length) : true; },
      locate: async () => ({ cwd: dir, project: dir, folder: folderOf(dir), mtimeMs: 0 }) });
    return { op, launched };
  };
  it('wt.exe is started detached with ; escaped and an allow-listed env (+ CLAUDE_CONFIG_DIR); a failed spawn is never "resumed"', async () => {
    const w = win();
    expect(await w.op.open({ sid: SID, app: 'windows-terminal' })).toMatchObject({ status: 200, body: { resumed: true } });
    expect(w.launched[0].slice(0, 2)).toEqual([wt, ['-d', 'C:\\w\\a\\;b c', 'C:\\Program Files\\claude\\claude.exe', '--resume', SID]]);
    expect(w.launched[0][2]).toEqual({ LOCALAPPDATA: la, Path: 'C:\\bin', SystemRoot: 'C:\\Windows', ComSpec: 'C:\\Windows\\system32\\cmd.exe', CLAUDE_CONFIG_DIR: 'D:\\cfg' });
    expect(await win({ spawnOk: () => false }).op.open({ sid: SID, app: 'windows-terminal' })).toMatchObject({ status: 500, body: { error: 'launch-failed' } });
  });
  it('claude.cmd runs through cmd.exe /d /c only from a plain path; else a clear refusal', async () => {
    const npm = 'C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd', w = win({ claude: npm });
    expect(await w.op.open({ sid: SID, app: 'windows-terminal' })).toMatchObject({ status: 200 });
    expect(w.launched[0][1]).toEqual(['-d', 'C:\\w\\a\\;b c', 'C:\\Windows\\System32\\cmd.exe', '/d', '/c', npm, '--resume', SID]);
    const spaced = win({ claude: 'C:\\Users\\Mai Anh\\AppData\\Roaming\\npm\\claude.cmd' });
    expect(await spaced.op.open({ sid: SID, app: 'windows-terminal' })).toMatchObject({ status: 409, body: { error: 'unsupported-claude', reason: expect.stringContaining('claude.exe') } }); expect(spaced.launched).toEqual([]);
  });
  it('editors: folder, then --open-url; a failed spawn is launch-failed or not resumed; cwds must start with a drive letter', async () => {
    const w = win();
    expect(await w.op.open({ sid: SID, app: 'cursor' })).toMatchObject({ status: 200, body: { resumed: true } });
    expect(w.launched.map(([b, a]) => [b, a])).toEqual([[cur, [cwd]], [cur, ['--open-url', '--', `cursor://anthropic.claude-code/open?session=${SID}`]]]);
    expect(await win({ spawnOk: () => false }).op.open({ sid: SID, app: 'cursor' })).toMatchObject({ status: 500, body: { error: 'launch-failed' } });
    expect(await win({ spawnOk: (n) => n === 1 }).op.open({ sid: SID, app: 'cursor' })).toMatchObject({ status: 200, body: { resumed: false } });
    expect(await win({ cwd: '\\\\server\\share\\x' }).op.open({ sid: SID, app: 'cursor' })).toMatchObject({ status: 400, body: { error: 'bad-project' } });
  });
});

describe('SessionOpener refusals', () => {
  it('bad sid / confirm, unknown sid, no or unsafe or mismatched or missing or unresponsive project dir, unknown app', async () => {
    const m = mac(), op = m.op;
    for (const sid of ['', 'x', '../etc', `${SID}x`, 5]) expect(await op.open({ sid, app: 'iterm' })).toMatchObject({ status: 400, body: { error: 'bad-sid' } });
    expect(await op.open({ sid: SID, app: 'iterm', confirm: 'yes' })).toMatchObject({ status: 400, body: { error: 'bad-confirm' } });
    expect(await op.open({ sid: '99999999-2222-4333-8444-555555555555', app: 'iterm' })).toEqual({ status: 404, body: { error: 'not-found', reason: expect.any(String) } });
    expect(await mac({ at: { cwd: undefined } }).op.open({ sid: SID, app: 'iterm' })).toEqual({ status: 409, body: { error: 'no-project', reason: expect.stringContaining('không ghi lại') } });
    for (const cwd of ['relative/dir', '/w/a\nb', '/w/a\u0085b', '/w/a\u2028b', '/w/a\u009bb', `/${'x'.repeat(4100)}`])
      expect(await mac({ cwd, at: { folder: 'x'.repeat(201) } }).op.open({ sid: SID, app: 'iterm' })).toMatchObject({ status: 400, body: { error: 'bad-project' } });
    expect(await mac({ at: { folder: '-w-other' } }).op.open({ sid: SID, app: 'iterm' })).toEqual({ status: 400, body: { error: 'bad-project', reason: expect.stringContaining('không khớp') } });
    expect(await mac({ at: { folder: 'y'.repeat(201) } }).op.open({ sid: SID, app: 'iterm' })).toMatchObject({ status: 200 }); // long folder names are hashed by Claude Code: not compared
    expect(await mac({ at: { cwd: '/w/deleted', folder: '-w-deleted' } }).op.open({ sid: SID, app: 'iterm' })).toEqual({ status: 409, body: { error: 'no-project', reason: expect.stringContaining('/w/shop') } });
    const ms = OPENER_CAP.statMs; OPENER_CAP.statMs = 20;
    try { const hung = mac(); (hung.op as any).fs = { ...(hung.op as any).fs, kind: () => new Promise(() => {}) }; expect(await hung.op.open({ sid: SID, app: 'iterm' })).toMatchObject({ status: 409, body: { error: 'no-project', reason: expect.stringContaining('không phản hồi') } }); }
    finally { OPENER_CAP.statMs = ms; }
    for (const app of ['vscode', 'windows-terminal', 'xterm', undefined]) expect(await op.open({ sid: SID, app })).toMatchObject({ status: 400, body: { error: 'unknown-app' } });
    expect(m.launches).toEqual([]);
  });
  it('confirm-required when live in the office, opened here <2 min ago, or the transcript changed <2 min ago (distinct reasons); one launch at a time', async () => {
    const reasons: string[] = [];
    const live = mac({ live: true }), r1 = await live.op.open({ sid: SID, app: 'iterm' });
    expect(r1).toMatchObject({ status: 409, body: { error: 'confirm-required' } }); reasons.push((r1.body as any).reason);
    expect(await live.op.open({ sid: SID, app: 'iterm', confirm: true })).toMatchObject({ status: 200 });
    const r2 = await live.op.open({ sid: SID, app: 'iterm' }); reasons.push((r2.body as any).reason); // still live too; the tracker reason wins
    let now = NOW; const again = mac({ now: () => now });
    expect(await again.op.open({ sid: SID, app: 'iterm' })).toMatchObject({ status: 200 });
    const r3 = await again.op.open({ sid: SID, app: 'terminal' }); expect(r3).toMatchObject({ status: 409, body: { error: 'confirm-required' } }); reasons.push((r3.body as any).reason);
    now += 121_000; expect(await again.op.open({ sid: SID, app: 'terminal' })).toMatchObject({ status: 200 });
    const touched = mac({ at: { mtimeMs: NOW - 30_000 } }), r4 = await touched.op.open({ sid: SID, app: 'iterm' }); reasons.push((r4.body as any).reason);
    expect(r4).toMatchObject({ status: 409, body: { error: 'confirm-required' } });
    expect(new Set([reasons[0], reasons[2], reasons[3]]).size).toBe(3); expect(reasons[1]).toBe(reasons[0]);
    let release!: () => void; const gate = new Promise<void>((r) => { release = r; });
    const slow = mac({ answer: async () => { await gate; return OK; } });
    const first = slow.op.open({ sid: SID, app: 'iterm' }); await new Promise((r) => setTimeout(r, 10));
    expect(await slow.op.open({ sid: SID2, app: 'terminal' })).toMatchObject({ status: 409, body: { error: 'busy' } }); // another session: still one launch at a time
    release(); expect(await first).toMatchObject({ status: 200 });
  });
});
