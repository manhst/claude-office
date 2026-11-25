import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmod, lstat, mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';
import { redactText } from './redact.js';
import { findClaude, run, which } from './claudeConfig.js';
import type { HistoryOpener, HistoryOpenerId, HistoryOpenersResponse, HistoryOpenResponse, McpErrorResponse } from './types.js';

export type ExecResult = { code: number | null; stdout: string; stderr: string; error?: string };
/** Runs bin with an argv array (never a shell) and waits: mdfind, plutil, lsappinfo, osascript, open. A timeout gives { code: null, error: 'timed out' }. */
export type Exec = (bin: string, args: string[], o: { timeoutMs: number; env: NodeJS.ProcessEnv }) => Promise<ExecResult>;
/** Starts an app detached with an argv array (never a shell): Windows Terminal and Windows editors. false = it could not be spawned. */
export type Launch = (bin: string, args: string[], env: NodeJS.ProcessEnv) => Promise<boolean>;
/** Read-only file system view used for detection and the project-dir check (injectable for tests). */
export interface OpenerFs { kind(p: string): Promise<'dir' | 'file' | null>; list(dir: string): Promise<string[]>; read(p: string): Promise<string | undefined> }
/** HistoryIndex.locate: raw cwd (absent when the transcript has none), redacted project label, transcript folder name and mtime. */
export interface SessionLocation { cwd?: string; project: string; folder: string; mtimeMs: number }
export interface SessionOpenerOpts {
  locate(sid: string): Promise<SessionLocation | null>;
  /** sid is live in Claude Deck right now (needs confirm) */
  isLive?(sid: string): boolean;
  /** Claude Deck run dir: macOS resume scripts go to <runDir>/resume/ */
  runDir?: string;
  /** History transcript root; a non-default one (or CLAUDE_CONFIG_DIR) is handed to claude as CLAUDE_CONFIG_DIR */
  historyRoot?: string;
  demo?: boolean; platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; home?: string; appDirs?: string[];
  exec?: Exec; launch?: Launch; fs?: OpenerFs; sleep?: (ms: number) => Promise<void>; now?: () => number;
  /** claude CLI path (default: findClaude, on Windows also claude.cmd; else plain `claude`) */
  claude?: () => string | undefined;
  /** runs fn after ms (deletes a resume script; default an unref'd timer) */
  later?: (fn: () => void, ms: number) => void;
}
/** UUID-shaped session id (what `claude --resume` and the extension's /open link accept). */
export const SESSION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** C0/C1 controls, DEL, U+2028/U+2029: never accepted in a path that reaches a terminal or a script. */
export const CONTROL = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/;
/** The only text typed into the user's shell is `/bin/sh '<script path>'`, and the path must match this (no quote, $, !, backslash, ~ … in any shell). */
export const SAFE_SCRIPT_PATH = /^[A-Za-z0-9/._ -]+$/;
const waitWindows = ['if not wasRunning then', 'repeat 50 times', 'if (count of windows) > 0 then exit repeat', 'delay 0.1', 'end repeat', 'end if'];
/** Fixed AppleScripts (one `-e` per line), data only in argv. Cold start: the app's own first window is used instead of a second one (waits ≤5 s for it). */
export const ITERM_SCRIPT = ['on run argv', 'set cmd to item 1 of argv', 'set wasRunning to application id "com.googlecode.iterm2" is running', 'tell application id "com.googlecode.iterm2"',
  'activate', 'set s to missing value', ...waitWindows,
  'if (not wasRunning) and (count of windows) > 0 then', 'set s to current session of window 1', // cold start: use iTerm's own first window
  'else if (count of windows) > 0 then', 'set w to current window', 'if w is missing value then set w to window 1', // running: a new tab in the front window
  'tell w to set t to (create tab with default profile)', 'set s to current session of t',
  'else', 'set s to current session of (create window with default profile)', 'end if',
  'tell s to write text cmd', 'end tell', 'end run'];
export const TERMINAL_SCRIPT = ['on run argv', 'set cmd to item 1 of argv', 'set wasRunning to application id "com.apple.Terminal" is running', 'tell application id "com.apple.Terminal"',
  'activate', ...waitWindows, 'if (not wasRunning) and (count of windows) > 0 then', 'do script cmd in window 1', 'else', 'do script cmd', 'end if', 'end tell', 'end run'];
/** POSIX single-quoted word for /bin/sh: 'it'\''s' (backslashes are literal inside). */
export const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
/** The resume script run by /bin/sh: cd (fails closed), optional CLAUDE_CONFIG_DIR, exec claude. Data appears only single-quoted; sid is UUID-checked. */
export const resumeScript = (cwd: string, claude: string, sid: string, configDir?: string) =>
  `#!/bin/sh\ncd -- ${shellQuote(cwd)} || exit 1\n${configDir ? `export CLAUDE_CONFIG_DIR=${shellQuote(configDir)}\n` : ''}exec ${shellQuote(claude)} --resume ${sid}\n`;
/** caps (ms unless noted): openers cache, detection probes, osascript, open, wait after the editor window, editor cold start, live window, script lifetime, stale scripts, project dir stat */
export const OPENER_CAP = { cacheMs: 60_000, detectMs: 5000, osaMs: 60_000, openMs: 20_000, editorWaitMs: 1500, editorColdMs: 6000, liveMs: 120_000, scriptMs: 120_000, staleMs: 600_000, statMs: 2000 };
const OSA = '/usr/bin/osascript', OPEN = '/usr/bin/open', MDFIND = '/usr/bin/mdfind', PLUTIL = '/usr/bin/plutil', LSAPPINFO = '/usr/bin/lsappinfo';
/** Windows env allow-list (lowercase): never ELECTRON_RUN_AS_NODE, NODE_OPTIONS, VSCODE_*, CLAUDECODE, CLAUDE_CODE_*, DECK_* / OFFICE_* … */
const WIN_ENV = new Set(['systemroot', 'windir', 'systemdrive', 'path', 'pathext', 'comspec', 'userprofile', 'username', 'userdomain', 'appdata', 'localappdata', 'temp', 'tmp', 'homedrive', 'homepath',
  'programfiles', 'programfiles(x86)', 'programdata', 'programw6432', 'number_of_processors', 'processor_architecture', 'os']);
/** a claude.cmd that cmd.exe /d /c can run without any quoting or metacharacter (no spaces, %, ^, &, parentheses, quotes) */
const WIN_CMD = /^[A-Za-z]:\\[A-Za-z0-9._\\-]+\.cmd$/i;
interface App { id: HistoryOpenerId; label: string; kind: 'terminal' | 'editor'; bundle?: string; name?: string; scheme?: string; ext?: string }
interface Found extends App { path: string; resumes: boolean }
const MAC: App[] = [
  { id: 'iterm', label: 'iTerm', kind: 'terminal', bundle: 'com.googlecode.iterm2', name: 'iTerm.app' },
  { id: 'terminal', label: 'Terminal', kind: 'terminal', bundle: 'com.apple.Terminal', name: 'Terminal.app' },
  { id: 'cursor', label: 'Cursor', kind: 'editor', bundle: 'com.todesktop.230313mzl4w4u92', name: 'Cursor.app', scheme: 'cursor', ext: '.cursor' },
  { id: 'vscode', label: 'VS Code', kind: 'editor', bundle: 'com.microsoft.VSCode', name: 'Visual Studio Code.app', scheme: 'vscode', ext: '.vscode' },
];
const WIN: App[] = [
  { id: 'windows-terminal', label: 'Windows Terminal', kind: 'terminal' },
  { id: 'cursor', label: 'Cursor', kind: 'editor', scheme: 'cursor', ext: '.cursor' },
  { id: 'vscode', label: 'VS Code', kind: 'editor', scheme: 'vscode', ext: '.vscode' },
];
const T = {
  demo: 'Demo mode does not open real apps.', os: 'Reopen only works on macOS and Windows.', none: 'No app found that can resume a session (iTerm, Terminal, Cursor, VS Code, Windows Terminal).',
  sid: 'Invalid session id.', app: 'This app is not installed on this machine.', confirm: 'confirm must be true or false.', notFound: 'Session not found in History.',
  noCwd: 'This session did not record a project folder, so there is nowhere to open it.', noDir: (p: string) => `The project folder no longer exists: ${p}`,
  slowDir: (p: string) => `The project folder is not responding (network drive disconnected?): ${p}`,
  badDir: 'Invalid project path (not absolute, too long or has control characters); it cannot be opened safely.',
  mismatch: 'The project folder recorded in the session does not match the folder the session is stored under; not opening it to avoid running in the wrong place.',
  live: 'This session is running in Claude Deck. Reopening starts a second claude on the same session and the two may overwrite each other. Send again with confirm: true to open anyway.',
  recent: 'This session was reopened less than 2 minutes ago. Opening it again puts two claudes on the same session. Send again with confirm: true to open anyway.',
  touched: 'This session was written in the last 2 minutes and may still be running in another window. Send again with confirm: true to open anyway.',
  busy: 'Another session is being opened; wait a moment and try again.',
  auth: (a: string) => `macOS has not allowed Claude Deck to control ${a}. Go to System Settings → Privacy & Security → Automation, enable ${a} for the app running Claude Deck (Terminal, iTerm or the Claude Deck app), then try again.`,
  pending: (a: string) => `macOS is asking for permission to control ${a}. Click OK, then try again.`,
  script: 'Could not create the resume script in the Claude Deck run folder.',
  unsafeRun: 'The Claude Deck run folder (DECK_RUN_DIR) has special characters and cannot be typed safely into a terminal. Use a path with only letters, digits, spaces and / . _ -',
  winCmd: 'claude is only available as claude.cmd in a path with spaces or special characters, so it cannot run safely. Install the native claude.exe, or open Windows Terminal and run claude --resume.',
  ask: (a: string) => `The first time, macOS may ask to allow Claude Deck to control ${a}.`, folder: (a: string) => `The Claude Code extension is not installed in ${a}, so only the project folder was opened.`,
  resumed: (a: string) => `The session opens in the active ${a} window.`, uriFail: (a: string) => `Opened the folder in ${a} but could not open the session.`,
};
const nodeFs: OpenerFs = {
  kind: async (p) => { const s = await stat(p).catch(() => null) ?? await lstat(p).catch(() => null); return !s ? null : s.isDirectory() ? 'dir' : 'file'; }, // lstat: Windows app execution aliases (wt.exe)
  list: (d) => readdir(d).catch(() => []), read: (p) => readFile(p, 'utf8').catch(() => undefined),
};
type Reply = { status: number; body: HistoryOpenResponse | McpErrorResponse };
const fail = (status: number, error: string, reason?: string): Reply => ({ status, body: { error, ...(reason ? { reason } : {}) } });
const errText = (r: ExecResult) => `${r.error ?? ''} ${r.stderr} ${r.code === null ? '' : `exit ${r.code}`}`.trim();
const within = <T>(p: Promise<T>, ms: number) => new Promise<T | 'timeout'>((res) => { const t = setTimeout(() => res('timeout'), ms); t.unref?.(); p.then((v) => { clearTimeout(t); res(v); }, () => { clearTimeout(t); res('timeout'); }); });
/** Resumes a past Claude Code session in a local app (History "Reopen"; GET /history/openers, POST /history/open). Detection reads app bundles, Spotlight, lsappinfo and
 *  extension folders only; nothing is launched to probe. Every process gets an argv array (never a shell) and an allow-listed env. On macOS no transcript data is ever
 *  typed: it goes into a 0600 /bin/sh script under <runDir>/resume/ and the terminal only receives `/bin/sh '<script>'`; the AppleScripts are constants with data
 *  in argv. One launch at a time; a session that is live, was opened <2 min ago or whose transcript changed <2 min ago needs confirm. Under vitest nothing runs
 *  unless exec/launch are injected. */
export class SessionOpener {
  private cache?: { at: number; list: Found[] }; private pending?: Promise<Found[]>; private launching = false; private recent = new Map<string, number>();
  private platform: NodeJS.Platform; private env: NodeJS.ProcessEnv; private home: string; private fs: OpenerFs; private exec: Exec; private launch: Launch;
  constructor(private opts: SessionOpenerOpts) {
    this.platform = opts.platform ?? process.platform; this.env = opts.env ?? process.env; this.home = opts.home ?? homedir(); this.fs = opts.fs ?? nodeFs;
    const test = !!process.env.VITEST || !!this.env.VITEST;
    this.exec = opts.exec ?? (test ? async () => ({ code: null, stdout: '', stderr: '', error: 'tests never run or launch apps' }) : (bin, args, o) => run(bin, args, o));
    this.launch = opts.launch ?? (test ? async () => false : (bin, args, env) => new Promise<boolean>((res) => {
      try { const ch = spawn(bin, args, { detached: true, stdio: 'ignore', env, shell: false }); ch.once('spawn', () => { ch.unref(); res(true); }); ch.once('error', () => res(false)); } catch { res(false); }
    }));
    if (this.platform === 'darwin' && opts.runDir && !opts.demo) void this.sweep();
  }
  private now() { return this.opts.now?.() ?? Date.now(); }
  /** CLAUDE_CONFIG_DIR for the resumed claude: the config dir of a non-default History root (<dir>/projects), else Claude Deck's own CLAUDE_CONFIG_DIR */
  private configDir(): string | undefined {
    const P = this.platform === 'win32' ? win32 : posix, root = this.opts.historyRoot;
    const d = root && P.resolve(root) !== P.resolve(this.home, '.claude', 'projects') ? (P.basename(P.resolve(root)) === 'projects' ? P.dirname(P.resolve(root)) : undefined) : this.env.CLAUDE_CONFIG_DIR || undefined;
    return d && !CONTROL.test(d) ? d : undefined;
  }
  /** env for spawned helpers: macOS a fixed minimal set (the terminal's login shell builds its own); Windows an allow-list (+ CLAUDE_CONFIG_DIR) */
  private childEnv(): NodeJS.ProcessEnv {
    const e = this.env;
    if (this.platform !== 'win32') return Object.fromEntries(Object.entries({ PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: e.HOME, USER: e.USER, TMPDIR: e.TMPDIR, LANG: e.LANG }).filter(([, v]) => v));
    const cd = this.configDir();
    return { ...Object.fromEntries(Object.entries(e).filter(([k, v]) => v !== undefined && WIN_ENV.has(k.toLowerCase()))), ...(cd ? { CLAUDE_CONFIG_DIR: cd } : {}) };
  }
  /** GET /history/openers (cached ~60 s, one detection at a time). */
  async openers(): Promise<HistoryOpenersResponse> {
    if (this.opts.demo) return { openers: [], reason: T.demo };
    if (this.platform !== 'darwin' && this.platform !== 'win32') return { openers: [], reason: T.os };
    const list = await this.detect();
    return { openers: list.map(({ id, label, kind, resumes }): HistoryOpener => ({ id, label, kind, resumes })), ...(list.length ? {} : { reason: T.none }) };
  }
  private detect(): Promise<Found[]> {
    if (this.cache && this.now() - this.cache.at < OPENER_CAP.cacheMs) return Promise.resolve(this.cache.list);
    return (this.pending ??= (this.platform === 'win32' ? this.detectWin() : this.detectMac()).then((list) => { this.cache = { at: this.now(), list }; return list; })
      .finally(() => { this.pending = undefined; }));
  }
  /** a Claude Code extension folder (anthropic.claude-code-<ver>…) that the editor hasn't marked obsolete */
  private async hasExtension(app: App) {
    const join = this.platform === 'win32' ? win32.join : posix.join, dir = join(this.home, app.ext!, 'extensions'), names = (await this.fs.list(dir)).filter((n) => /^anthropic\.claude-code-\d/.test(n));
    if (!names.length) return false;
    let old: Record<string, unknown> = {}; try { old = JSON.parse((await this.fs.read(join(dir, '.obsolete'))) ?? '{}') ?? {}; } catch { old = {}; }
    for (const n of names) if (!old[n] && (await this.fs.kind(join(dir, n))) === 'dir') return true;
    return false;
  }
  private async detectMac(): Promise<Found[]> {
    const join = posix.join, env = this.childEnv(), apps = [join(this.home, 'Applications'), '/Applications', '/System/Applications'], dirs = this.opts.appDirs ?? ['/Applications', apps[0], '/System/Applications/Utilities', '/Applications/Utilities'];
    const bundleOf = async (app: string) => { const r = await this.exec(PLUTIL, ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', join(app, 'Contents', 'Info.plist')], { timeoutMs: OPENER_CAP.detectMs, env }); return r.code === 0 ? r.stdout.trim() : undefined; };
    const skip = (p: string) => p.includes('/.Trash/') || p.startsWith('/Volumes/') || p.startsWith(`${join(this.home, 'Downloads')}/`);
    const one = async (app: App): Promise<Found | null> => {
      let path: string | undefined;
      for (const d of dirs) { const p = join(d, app.name!); if ((await this.fs.kind(p)) === 'dir' && (await bundleOf(p)) === app.bundle) { path = p; break; } }
      if (!path) { // Spotlight's index of bundle ids; the query is built from the fixed table. Hits under an Applications folder first; Downloads, Trash, other volumes never
        const r = await this.exec(MDFIND, [`kMDItemCFBundleIdentifier == '${app.bundle}'`], { timeoutMs: OPENER_CAP.detectMs, env });
        const hits = r.code === 0 ? r.stdout.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('/') && l.endsWith('.app') && !skip(l)) : [];
        const rank = (p: string) => (apps.some((a) => p.startsWith(`${a}/`)) ? 0 : 1);
        for (const h of hits.sort((a, b) => rank(a) - rank(b))) if ((await this.fs.kind(h)) === 'dir') { path = h; break; }
      }
      return path ? { ...app, path, resumes: app.kind === 'terminal' || (await this.hasExtension(app)) } : null;
    };
    return (await Promise.all(MAC.map(one))).filter((x): x is Found => !!x);
  }
  private async detectWin(): Promise<Found[]> {
    const e = this.env, la = e.LOCALAPPDATA ?? win32.join(this.home, 'AppData', 'Local'), pf = e.ProgramFiles ?? 'C:\\Program Files';
    const where: Record<string, string[]> = {
      'windows-terminal': [win32.join(la, 'Microsoft', 'WindowsApps', 'wt.exe'), ...(e.PATH ?? e.Path ?? '').split(';').filter((d) => win32.isAbsolute(d)).map((d) => win32.join(d, 'wt.exe'))],
      cursor: [win32.join(la, 'Programs', 'cursor', 'Cursor.exe')], vscode: [win32.join(la, 'Programs', 'Microsoft VS Code', 'Code.exe'), win32.join(pf, 'Microsoft VS Code', 'Code.exe')],
    };
    const out: Found[] = [];
    for (const app of WIN) {
      let path: string | undefined; for (const p of where[app.id]) if ((await this.fs.kind(p)) === 'file') { path = p; break; }
      if (path) out.push({ ...app, path, resumes: app.kind === 'terminal' || (await this.hasExtension(app)) });
    }
    return out;
  }
  /** Deletes resume scripts older than 10 min (left by a crash or restart). */
  async sweep() {
    if (!this.opts.runDir) return;
    const dir = posix.join(this.opts.runDir, 'resume'), now = Date.now();
    for (const n of await readdir(dir).catch(() => [] as string[])) {
      if (!/^[a-z0-9]+\.sh$/.test(n)) continue;
      const f = posix.join(dir, n), st = await lstat(f).catch(() => null);
      if (st?.isFile() && now - st.mtimeMs > OPENER_CAP.staleMs) await unlink(f).catch(() => {});
    }
  }
  /** sid was reopened here less than 2 min ago (POST /history/delete needs confirm then) */
  openedRecently(sid: string) { const t = this.recent.get(sid); return t !== undefined && this.now() - t < OPENER_CAP.liveMs; }
  /** POST /history/open: sid (UUID-shaped, indexed) → its recorded cwd (absolute, no controls, matching the transcript folder, an existing dir) → app (detected)
   *  → live checks unless confirm → one launch at a time. */
  async open(raw: unknown): Promise<Reply> {
    const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>, win = this.platform === 'win32';
    if (this.opts.demo) return fail(409, 'unavailable', T.demo);
    if (this.platform !== 'darwin' && !win) return fail(409, 'unavailable', T.os);
    const sid = typeof b.sid === 'string' ? b.sid : '';
    if (!SESSION_UUID.test(sid)) return fail(400, 'bad-sid', T.sid);
    if (b.confirm !== undefined && typeof b.confirm !== 'boolean') return fail(400, 'bad-confirm', T.confirm);
    const loc = await this.opts.locate(sid); if (!loc) return fail(404, 'not-found', T.notFound);
    const cwd = loc.cwd; if (!cwd) return fail(409, 'no-project', T.noCwd);
    if (cwd.length > 4096 || CONTROL.test(cwd) || !(win ? /^[A-Za-z]:\\/.test(cwd) : cwd.startsWith('/'))) return fail(400, 'bad-project', T.badDir);
    if (loc.folder.length <= 200 && cwd.replace(/[^a-zA-Z0-9]/g, '-') !== loc.folder) return fail(400, 'bad-project', T.mismatch); // the folder Claude Code derived from this cwd
    const kind = await within(this.fs.kind(cwd), OPENER_CAP.statMs);
    if (kind === 'timeout') return fail(409, 'no-project', T.slowDir(loc.project));
    if (kind !== 'dir') return fail(409, 'no-project', T.noDir(loc.project));
    const app = (await this.detect()).find((a) => a.id === b.app); if (!app) return fail(400, 'unknown-app', T.app);
    const now = this.now(); for (const [k, t] of this.recent) if (now - t >= OPENER_CAP.liveMs) this.recent.delete(k);
    if (b.confirm !== true) {
      if (this.opts.isLive?.(sid)) return fail(409, 'confirm-required', T.live);
      if (this.recent.has(sid)) return fail(409, 'confirm-required', T.recent);
      if (now - loc.mtimeMs < OPENER_CAP.liveMs) return fail(409, 'confirm-required', T.touched);
    }
    if (this.launching) return fail(409, 'busy', T.busy);
    this.launching = true;
    try { const r = await this.start(app, sid, cwd, loc.project); if (r.status === 200) this.recent.set(sid, this.now()); return r; } finally { this.launching = false; }
  }
  /** claude for the resume: injected, else findClaude (claude.exe on Windows), else on Windows a claude.cmd on PATH, else plain `claude` */
  private claudePath() {
    const p = this.opts.claude ? this.opts.claude() : findClaude(this.env).path ?? (this.platform === 'win32' ? which('claude', this.env.PATH ?? this.env.Path ?? '', ['.cmd']) : undefined);
    return p && !CONTROL.test(p) ? p : 'claude';
  }
  /** writes the resume script (dir 0700, file 0600, random name, O_EXCL) and schedules its deletion */
  private async writeScript(content: string) {
    const dir = posix.join(this.opts.runDir!, 'resume');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const st = await lstat(dir); if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('resume dir is not a directory');
    await chmod(dir, 0o700);
    const f = posix.join(dir, `${randomBytes(12).toString('hex')}.sh`);
    await writeFile(f, content, { flag: 'wx', mode: 0o600 });
    (this.opts.later ?? ((fn, ms) => { setTimeout(fn, ms).unref(); }))(() => { void unlink(f).catch(() => {}); }, OPENER_CAP.scriptMs);
    return f;
  }
  private async running(bundle: string) {
    const r = await this.exec(LSAPPINFO, ['info', '-only', 'pid', '-app', bundle], { timeoutMs: OPENER_CAP.detectMs, env: this.childEnv() });
    return r.code === 0 && /"pid"\s*=\s*\d+/.test(r.stdout);
  }
  private async start(app: Found, sid: string, cwd: string, project: string): Promise<Reply> {
    const env = this.childEnv(), ok = (resumed: boolean, note?: string): Reply => ({ status: 200, body: { ok: true, app: app.id, project, resumed, ...(note ? { note } : {}) } });
    const failed = (r: ExecResult) => fail(500, 'launch-failed', redactText(errText(r), 300)), spawnFailed = fail(500, 'launch-failed', `Could not start ${app.label}.`);
    const sleep = this.opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const uri = `${app.scheme}://anthropic.claude-code/open?session=${sid}`;
    if (this.platform === 'win32') {
      if (app.kind === 'terminal') { // wt splits its command line on ';' unless escaped; cwd only ever goes through -d
        const claude = this.claudePath(), esc = (s: string) => s.replace(/;/g, '\\;'), isCmd = /\.(cmd|bat)$/i.test(claude);
        if (isCmd && !WIN_CMD.test(claude)) return fail(409, 'unsupported-claude', T.winCmd);
        const cmdExe = win32.join(this.env.SystemRoot ?? this.env.SYSTEMROOT ?? 'C:\\Windows', 'System32', 'cmd.exe');
        return (await this.launch(app.path, ['-d', esc(cwd), ...(isCmd ? [cmdExe, '/d', '/c', claude] : [esc(claude)]), '--resume', sid], env)) ? ok(true) : spawnFailed;
      }
      if (!(await this.launch(app.path, [cwd], env))) return spawnFailed;
      if (!app.resumes) return ok(false, T.folder(app.label));
      await sleep(OPENER_CAP.editorWaitMs);
      const sent = await this.launch(app.path, ['--open-url', '--', uri], env); // the argv the editor registers for its URL scheme
      return sent ? ok(true, T.resumed(app.label)) : ok(false, T.uriFail(app.label));
    }
    if (app.kind === 'terminal') {
      const dir = posix.join(this.opts.runDir ?? '', 'resume');
      if (!this.opts.runDir || !SAFE_SCRIPT_PATH.test(`${dir}/x.sh`)) return fail(500, 'unsafe-path', T.unsafeRun);
      let script: string; try { script = await this.writeScript(resumeScript(cwd, this.claudePath(), sid, this.configDir())); } catch { return fail(500, 'launch-failed', T.script); }
      if (!SAFE_SCRIPT_PATH.test(script)) { await unlink(script).catch(() => {}); return fail(500, 'unsafe-path', T.unsafeRun); }
      const r = await this.exec(OSA, [...(app.id === 'iterm' ? ITERM_SCRIPT : TERMINAL_SCRIPT).flatMap((l) => ['-e', l]), `/bin/sh '${script}'`], { timeoutMs: OPENER_CAP.osaMs, env });
      if (r.code === 0) return ok(true, T.ask(app.label));
      await unlink(script).catch(() => {});
      if (r.code === null && /timed out/i.test(r.error ?? '')) return fail(409, 'automation-pending', T.pending(app.label));
      return /-1743|not authori[sz]ed/i.test(errText(r)) ? fail(409, 'not-authorized', T.auth(app.label)) : failed(r);
    }
    const warm = await this.running(app.bundle!);
    const r = await this.exec(OPEN, ['-a', app.path, cwd], { timeoutMs: OPENER_CAP.openMs, env }); if (r.code !== 0) return failed(r);
    if (!app.resumes) return ok(false, T.folder(app.label));
    if (!warm) for (let t = 0; t < OPENER_CAP.editorColdMs && !(await this.running(app.bundle!)); t += 500) await sleep(500); // cold start: wait for the app to register
    await sleep(OPENER_CAP.editorWaitMs); // then for the folder window, so the link lands in it
    const u = await this.exec(OPEN, [uri], { timeoutMs: OPENER_CAP.openMs, env });
    return u.code === 0 ? ok(true, T.resumed(app.label)) : ok(false, T.uriFail(app.label));
  }
}
