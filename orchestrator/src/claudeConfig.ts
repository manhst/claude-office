import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, copyFileSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { open, readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { redactText } from './redact.js';
import { EXTRA_BIN_DIRS, commandLine, probeMcp } from './mcpProbe.js';
import type { ClaudeConfigView, ClaudeProjectView, McpPair, McpRef, McpScope, McpServerView, McpWriteResponse } from './types.js';

const SCOPES: readonly McpScope[] = ['user', 'local', 'project', 'settings'], WRITABLE: readonly McpScope[] = ['user', 'local', 'project'];
const RANK: Record<McpScope, number> = { user: 0, local: 1, project: 2, settings: 3 };
const KNOWN = new Set(['type', 'command', 'args', 'env', 'url', 'headers']);
const TYPES = new Set(['', 'stdio', 'http', 'streamable-http', 'sse', 'ws']), URL_TYPES = new Set(['http', 'streamable-http', 'sse', 'ws']);
/** The claude CLI's rule for new server names (letters, digits, - and _), minus a leading '-' that it would read as an option. */
export const MCP_NAME = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/;
const SECRET = /(pass|secret|token|key|auth|cookie|credential|session|private)/i;
const USERINFO = /[a-z][\w+.-]*:\/\/[^\s/?#@:]*:[^\s/?#@]+@/i, QUERY = /[?&](api[_-]?key|key|token|access[_-]?token|secret|password|sig|signature)=/i;
/** Mask rule for env/header values: secret-looking key, URL userinfo password, secret query param, or anything redactText changes. */
export const looksSecret = (key: string, value: string) => SECRET.test(key) || USERINFO.test(value) || QUERY.test(value) || redactText(value, Infinity) !== value;
/** cli.error when Claude Deck runs inside a Claude Code session, where `claude mcp add-json … -` refuses stdin by design (never worked around). */
export const IN_SESSION = 'The Claude Deck server was started from inside a Claude Code session, where the claude CLI refuses these writes. Restart it with the Claude Deck app or a normal terminal.';
const REFUSED = /refused inside a Claude Code session/i;
/** Same session test as the claude CLI (plus CLAUDE_CODE_SESSION_ID). */
const inSession = (env: NodeJS.ProcessEnv) => Boolean(env.CLAUDE_CODE_CHILD_SESSION || env.CLAUDECODE || env.CLAUDE_CODE_SESSION_ID);
/** Saves kept as backups, claude CLI timeout, concurrent probes, .mcp.json size, stat timeout and cache TTL. */
export const CLAUDE_CONFIG_CAP = { backups: 30, cliMs: 20_000, probes: 3, mcpJson: 256 * 1024, statMs: 1000, statTtlMs: 5000 };
const C = CLAUDE_CONFIG_CAP;
type Reply = { status: number; body: unknown };
type Cli = { path?: string; version?: string; error?: string };
type Kind = 'file' | 'dir' | null;
const fail = (status: number, error: string, extra: object = {}): Reply => ({ status, body: { error, ...extra } });
const obj = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as any) : {});
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const put = (o: Record<string, unknown>, k: string, v: unknown) => Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
const isFileSync = (f: string) => { try { return statSync(f).isFile(); } catch { return false; } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const text = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));
/** JSON with object keys sorted at every level. */
export const stableJson = (v: unknown): string => Array.isArray(v) ? `[${v.map(stableJson).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableJson((v as any)[k])}`).join(',')}}` : JSON.stringify(v) ?? 'null';
/** Hash of a stored entry; edits/deletes must send it back (409 when the file changed meanwhile). */
export const entryHash = (e: unknown) => createHash('sha256').update(stableJson(e)).digest('hex');
/** An entry as the CLI may normalize it (type-less stdio, empty args/env/headers), for the after-write check. */
const canon = (e: unknown) => {
  const o = { ...obj(e) }; if (!o.type && typeof o.command === 'string') o.type = 'stdio';
  for (const k of ['args', 'env', 'headers']) if ((Array.isArray(o[k]) && !o[k].length) || (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k]) && !Object.keys(o[k]).length)) delete o[k];
  return stableJson(o);
};
/** Claude Code's files: DECK_CLAUDE_JSON / DECK_CLAUDE_SETTINGS, else (demoDir's fixtures, else) `$CLAUDE_CONFIG_DIR/.claude.json` or ~/.claude.json and
 *  `<config dir>/settings.json`. Under vitest the real files are refused, loudly. */
export function claudePaths(env: NodeJS.ProcessEnv = process.env, demoDir?: string) {
  const dir = env.CLAUDE_CONFIG_DIR, home = homedir();
  const claudeJson = resolve(env.DECK_CLAUDE_JSON || (demoDir ? join(demoDir, '.claude.json') : join(dir || home, '.claude.json')));
  const settings = resolve(env.DECK_CLAUDE_SETTINGS || (demoDir ? join(demoDir, 'settings.json') : join(dir || join(home, '.claude'), 'settings.json')));
  if (env.VITEST) {
    const real = [join(home, '.claude.json'), join(home, '.claude', 'settings.json'), ...(dir ? [join(dir, '.claude.json'), join(dir, 'settings.json')] : [])].map((p) => resolve(p));
    if (!env.DECK_CLAUDE_JSON || !env.DECK_CLAUDE_SETTINGS || real.includes(claudeJson) || real.includes(settings)) throw new Error('claudePaths: tests must set DECK_CLAUDE_JSON and DECK_CLAUDE_SETTINGS to temp files, never the real Claude Code config');
  }
  return { claudeJson, settings };
}
/** The Claude Code config dir (CLAUDE_CONFIG_DIR or ~/.claude; DECK_CLAUDE_CONFIG_DIR overrides). Under vitest only the override counts, and never the real dir. */
export function claudeConfigDir(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.DECK_CLAUDE_CONFIG_DIR) { const d = resolve(env.DECK_CLAUDE_CONFIG_DIR); return env.VITEST && [join(homedir(), '.claude'), ...(env.CLAUDE_CONFIG_DIR ? [env.CLAUDE_CONFIG_DIR] : [])].some((r) => resolve(r) === d) ? undefined : d; }
  return env.VITEST ? undefined : resolve(env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'));
}
/** First file named `name` (Windows: + PATHEXT suffixes) in the absolute PATH entries, then ~/.local/bin, /opt/homebrew/bin, /usr/local/bin. */
export function which(name: string, path = process.env.PATH ?? '', exts = process.platform === 'win32' ? ['', ...(process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').toLowerCase().split(';')] : ['']) {
  for (const d of [...path.split(delimiter), ...EXTRA_BIN_DIRS()]) if (d && isAbsolute(d)) for (const x of exts) { const f = join(d, name + x); if (isFileSync(f)) return f; }
  return undefined;
}
/** The claude CLI: DECK_CLAUDE_BIN, else `claude` on PATH / the usual install dirs. Under vitest only DECK_CLAUDE_BIN (a fake) is accepted. */
export function findClaude(env: NodeJS.ProcessEnv = process.env): Cli {
  if (env.DECK_CLAUDE_BIN) return isFileSync(env.DECK_CLAUDE_BIN) ? { path: resolve(env.DECK_CLAUDE_BIN) } : { error: 'DECK_CLAUDE_BIN does not exist' };
  if (env.VITEST) return { error: 'tests never run the real claude CLI (set DECK_CLAUDE_BIN)' };
  const p = which('claude', env.PATH, process.platform === 'win32' ? ['.exe'] : ['']);
  return p ? { path: p } : { error: 'claude CLI not found (install Claude Code or set DECK_CLAUDE_BIN)' };
}
/** Runs a command without a shell (a .js/.mjs path runs under node), `input` on stdin; output capped at 64 KB each; killed after timeoutMs; never throws. */
export function run(bin: string, args: string[], o: { cwd?: string; input?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}) {
  return new Promise<{ code: number | null; stdout: string; stderr: string; error?: string }>((res) => {
    const node = /\.[cm]?js$/.test(bin); let out = '', err = '', over = false, ch: ChildProcess;
    try { ch = spawn(node ? process.execPath : bin, node ? [bin, ...args] : args, { cwd: o.cwd, env: o.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); }
    catch (e) { res({ code: null, stdout: '', stderr: '', error: String((e as Error)?.message ?? e) }); return; }
    const fin = (r: { code: number | null; error?: string }) => { if (over) return; over = true; clearTimeout(t); res({ ...r, stdout: out, stderr: err }); };
    const t = setTimeout(() => { ch.kill('SIGKILL'); fin({ code: null, error: 'timed out' }); }, o.timeoutMs ?? C.cliMs);
    ch.stdout!.setEncoding('utf8').on('data', (s: string) => { if (out.length < 65536) out += s; });
    ch.stderr!.setEncoding('utf8').on('data', (s: string) => { if (err.length < 65536) err += s; });
    ch.on('error', (e) => fin({ code: null, error: e.message })); ch.on('close', (code) => fin({ code }));
    ch.stdin!.on('error', () => {}); ch.stdin!.end(o.input ?? '');
  });
}
const cliError = (r: { code: number | null; stdout: string; stderr: string; error?: string }) =>
  redactText((r.error ?? (r.stderr.trim() || r.stdout.trim() || `exit code ${r.code}`)).split(/\r?\n/).filter(Boolean).slice(-4).join(' '), 500);
/** A JSON object file; undefined when missing; bigger than `max` → error; retried while Claude Code may be mid-write. */
async function readJson(f: string, max = 64 << 20): Promise<Record<string, any> | undefined> {
  for (let i = 0; ; i++) {
    let raw: string;
    try { const fh = await open(f, 'r'); try { if ((await fh.stat()).size > max) throw new Error(`${basename(f)} is larger than ${max >> 10} KB`); raw = await fh.readFile('utf8'); } finally { await fh.close(); } }
    catch (e: any) { if (e?.code === 'ENOENT' || e?.code === 'ENOTDIR') return undefined; throw e; }
    try { return obj(JSON.parse(raw)); } catch { if (i >= 2) throw new Error(`cannot parse ${f}`); await sleep(100); }
  }
}
const norm = (p: string) => (process.platform === 'win32' ? p.replace(/\\/g, '/') : p);
const sameKey = (a: string, b: string) => (process.platform === 'win32' ? norm(a).toLowerCase() === norm(b).toLowerCase() : a === b);
async function worktreeMain(gitFile: string, dir: string): Promise<string | undefined> {
  const m = /^gitdir:\s*(.+)$/m.exec(await readFile(gitFile, 'utf8').catch(() => '')); if (!m) return undefined;
  const gitdir = resolve(dir, m[1].trim()), common = (await readFile(join(gitdir, 'commondir'), 'utf8').catch(() => '')).trim();
  if (!common) return undefined;
  const c = resolve(gitdir, common); return basename(c) === '.git' ? dirname(c) : undefined;
}
/** The key the claude CLI files local-scope servers under for a cwd: the git root of its real path (a worktree → the main repo), else the real path; '/' on Windows. */
export async function configKey(dir: string): Promise<string> {
  const real = await realpath(dir);
  for (let d = real; ;) {
    const g = join(d, '.git'), st = await stat(g).catch(() => null);
    if (st?.isDirectory()) return norm(d);
    if (st?.isFile()) return norm((await worktreeMain(g, d)) ?? d);
    const up = dirname(d); if (up === d) return norm(real); d = up;
  }
}
/** env var / header pairs for the view: values that look secret are left out with masked:true. */
function pairs(v: unknown): McpPair[] { return Object.entries(obj(v)).map(([key, x]) => { const value = text(x); return looksSecret(key, value) ? { key, masked: true } : { key, value }; }); }
const ENV_KEY = /^[^=\s\0]+$/, HEADER_KEY = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
function pairsIn(list: unknown, field: 'env' | 'headers', src: unknown): Record<string, unknown> | string {
  if (list === undefined) return {};
  if (!Array.isArray(list) || list.length > 200) return `${field} must be a list`;
  const out: Record<string, unknown> = {}, seen = new Set<string>(), stored = obj(obj(src)[field]);
  for (const p of list) {
    const key = p?.key;
    if (typeof key !== 'string' || key.length > 256 || !(field === 'env' ? ENV_KEY : HEADER_KEY).test(key)) return `${field}: bad key ${JSON.stringify(String(key ?? '')).slice(0, 80)}`;
    const k = field === 'headers' ? key.toLowerCase() : key; if (seen.has(k)) return `${field}: duplicate key ${key}`; seen.add(k);
    if (p.keep === true) { if (!own(stored, key)) return `${field}: no stored value to keep for ${key}`; put(out, key, stored[key]); }
    else if (typeof p.value === 'string' && p.value.length <= 16384) put(out, key, p.value);
    else return `${field}: ${key} needs a string value`;
    const v = text(out[key]);
    if (v.includes('\0') || (field === 'headers' && /[\r\n]/.test(v))) return `${field}: ${key} has a NUL${field === 'headers' ? ' or line break' : ''}`;
  }
  return out;
}
/** McpServerInput → the JSON entry to store; keep:true values and the extra keys (oauth, timeout…) come from `src` (the edited or cloned entry). */
export function buildEntry(v: any, src?: unknown): Record<string, unknown> | string {
  if (!v || typeof v !== 'object') return 'server required';
  const type = typeof v.type === 'string' ? v.type.trim() : '';
  if (type !== 'stdio' && !URL_TYPES.has(type)) return 'type must be stdio | http | streamable-http | sse | ws';
  const extra = Object.fromEntries(Object.entries(obj(src)).filter(([k]) => !KNOWN.has(k)));
  if (type === 'stdio') {
    if (typeof v.command !== 'string' || !v.command.trim() || v.command.length > 4096 || v.command.includes('\0')) return 'stdio needs a command (no NUL)';
    if (v.args !== undefined && (!Array.isArray(v.args) || v.args.length > 1000 || v.args.some((a: unknown) => typeof a !== 'string' || a.length > 16384 || a.includes('\0')))) return 'args must be a list of strings (no NUL)';
    const env = pairsIn(v.env, 'env', src); if (typeof env === 'string') return env;
    return { type, command: v.command.trim(), args: v.args ?? [], env, ...extra };
  }
  const url = typeof v.url === 'string' ? v.url.trim() : ''; let u: URL | undefined; try { u = url.includes('\0') ? undefined : new URL(url); } catch { /* below */ }
  if (!u || !(type === 'ws' ? ['ws:', 'wss:'] : ['http:', 'https:']).includes(u.protocol)) return type === 'ws' ? 'ws needs a ws(s):// url' : `${type} needs an http(s) url`;
  const headers = pairsIn(v.headers, 'headers', src); if (typeof headers === 'string') return headers;
  return { type, url, ...(Object.keys(headers).length ? { headers } : {}), ...extra };
}
/** env/header keys a project-scope save would write into the (usually committed) .mcp.json: kept values and secret-looking ones. */
function projectSecrets(v: any, e: Record<string, any>): string[] {
  const keys: string[] = [];
  for (const f of ['env', 'headers'] as const) {
    const kept = new Set((Array.isArray(v?.[f]) ? v[f] : []).filter((p: any) => p?.keep === true).map((p: any) => p.key));
    for (const [k, x] of Object.entries(obj(e[f]))) if (kept.has(k) || looksSecret(k, text(x))) keys.push(k);
  }
  return keys;
}
interface Raw { cj: Record<string, any>; st: Record<string, any>; mcp: Map<string, Record<string, any>> }
export interface ClaudeConfigOpts { claudeJson: string; settings: string; runDir: string; demo?: boolean; fsRoot?: string; env?: NodeJS.ProcessEnv; home?: string }
/** Claude config tab: MCP servers of Claude Code across user / local / project (.mcp.json) / settings (read-only) scopes. Writes only through the claude
 *  CLI (`mcp add-json` / `mcp remove`, its own merging writers) after a hash check, a key check and a backup, proves an add before any remove, and
 *  re-reads to verify; never writes the files itself. */
export class ClaudeConfig {
  private cliCache?: { at: number; p: Promise<Cli> }; private chain: Promise<unknown> = Promise.resolve(); private refused = false; private probes = 0;
  private kinds = new Map<string, { at: number; p: Promise<Kind> }>();
  private readonly home: string; private readonly env: NodeJS.ProcessEnv;
  constructor(private o: ClaudeConfigOpts) { this.home = o.home ?? homedir(); this.env = o.env ?? process.env; }
  /** where a project path lives on disk (demo fixtures map /home/demo/… into the fixture dir) */
  private fs(p: string) { return this.o.fsRoot ? join(this.o.fsRoot, p) : p; }
  private mcpFile(p: string) { return join(this.fs(p), '.mcp.json'); }
  /** async stat with a timeout (a hung mount must not block), cached a few seconds */
  private kind(p: string): Promise<Kind> {
    const c = this.kinds.get(p); if (c && Date.now() - c.at < C.statTtlMs) return c.p;
    const q: Promise<Kind> = Promise.race([stat(p).then((s): Kind => (s.isFile() ? 'file' : s.isDirectory() ? 'dir' : null), () => null), sleep(C.statMs).then(() => null)]);
    if (this.kinds.size > 5000) this.kinds.clear(); this.kinds.set(p, { at: Date.now(), p: q }); return q;
  }
  private async onPath(name: string, path: string | undefined) {
    const exts = process.platform === 'win32' ? ['', ...(this.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').toLowerCase().split(';')] : [''];
    const dirs = [...(path ?? '').split(delimiter), ...EXTRA_BIN_DIRS()].filter((d) => d && isAbsolute(d));
    return (await Promise.all(dirs.flatMap((d) => exts.map((x) => this.kind(join(d, name + x)))))).includes('file');
  }
  /** claude CLI path + version (`claude --version`), cached; a failure is retried after a minute. No version (read-only) inside a Claude Code session, once
   *  the CLI refused a write as such, or when the config files are overridden without DECK_CLAUDE_BIN. */
  cli(): Promise<Cli> {
    if (this.o.demo) return Promise.resolve({ error: 'demo mode: read-only' });
    if (this.refused || inSession(this.env)) { const f = findClaude(this.env); return Promise.resolve({ ...(f.path ? { path: f.path } : {}), error: IN_SESSION }); }
    if ((this.env.DECK_CLAUDE_JSON || this.env.DECK_CLAUDE_SETTINGS) && !this.env.DECK_CLAUDE_BIN)
      return Promise.resolve({ error: 'DECK_CLAUDE_JSON / DECK_CLAUDE_SETTINGS are set without DECK_CLAUDE_BIN: reads and claude CLI writes would target different files' });
    const c = this.cliCache;
    if (!c || Date.now() - c.at > 60_000) {
      const p = (async (): Promise<Cli> => {
        const f = findClaude(this.env); if (!f.path) return f;
        const r = await run(f.path, ['--version'], { env: this.env, timeoutMs: C.cliMs }), v = /\d+\.\d+\.\d+[\w.-]*/.exec(r.stdout)?.[0];
        return r.code === 0 && v ? { path: f.path, version: v } : { path: f.path, error: `claude --version failed: ${cliError(r)}` };
      })();
      this.cliCache = { at: Date.now(), p }; p.then((x) => { if (x.version && this.cliCache?.p === p) this.cliCache.at = Infinity; }, () => {});
    }
    return this.cliCache!.p;
  }
  private async read(): Promise<Raw> {
    const cj = (await readJson(this.o.claudeJson)) ?? {}, st = (await readJson(this.o.settings)) ?? {}, mcp = new Map<string, Record<string, any>>();
    await Promise.all(Object.keys(obj(cj.projects)).map(async (p) => { const j = await readJson(this.mcpFile(p), C.mcpJson).catch(() => ({})); if (j) mcp.set(p, j); }));
    return { cj, st, mcp };
  }
  private stored(r: Raw, ref: McpRef): any {
    const projects = obj(r.cj.projects), p = ref.project ?? '';
    const m = obj(ref.scope === 'user' ? r.cj.mcpServers : ref.scope === 'local' ? (own(projects, p) ? obj(projects[p]).mcpServers : undefined) : ref.scope === 'project' ? r.mcp.get(p)?.mcpServers : r.st.mcpServers);
    return own(m, ref.name) ? m[ref.name] : undefined;
  }
  private async found(cmd: string, project: string | undefined, env: unknown): Promise<boolean> {
    if (isAbsolute(cmd)) return (await this.kind(this.fs(cmd))) === 'file';
    if (/[\\/]/.test(cmd)) return (await this.kind(resolve(project ? this.fs(project) : this.home, cmd))) === 'file';
    return !!this.o.demo || this.onPath(cmd, typeof obj(env).PATH === 'string' ? obj(env).PATH : this.env.PATH);
  }
  private async warnings(scope: McpScope, e: Record<string, any>, project: string | undefined): Promise<string[]> {
    const w: string[] = [], type = typeof e.type === 'string' ? e.type : '';
    if (!TYPES.has(type)) w.push(`unknown type "${redactText(type, 40)}"`);
    if (type === '' || type === 'stdio') {
      if (typeof e.command !== 'string' || !e.command.trim()) w.push('stdio server without a command');
      else if (!(await this.found(e.command, project, e.env))) w.push(`command not found: ${redactText(e.command, 200)}`);
    }
    if (URL_TYPES.has(type) && (typeof e.url !== 'string' || !e.url.trim())) w.push(`${type} server without a url`);
    if (scope === 'settings') w.push('not loaded by Claude Code; clone to user/local/project to use it');
    return w;
  }
  private async build(r: Raw, cli: Cli): Promise<ClaudeConfigView> {
    const writable = !this.o.demo && !!cli.version && !cli.error, projects = obj(r.cj.projects), paths = Object.keys(projects).sort();
    const local = new Map(paths.map((p) => [p, obj(obj(projects[p]).mcpServers)])), proj = new Map(paths.map((p) => [p, obj(r.mcp.get(p)?.mcpServers)]));
    const servers: McpServerView[] = [], pending: Promise<void>[] = [];
    const add = (scope: McpScope, project: string | undefined, file: string, map: Record<string, any>) => {
      for (const [name, e0] of Object.entries(map)) {
        const e = obj(e0), type = typeof e.type === 'string' ? e.type : '';
        let shadowedBy: McpServerView['shadowedBy'], approval: McpServerView['approval'];
        if (scope === 'project') {
          if (own(local.get(project!)!, name)) shadowedBy = { scope: 'local', project };
          const pv = obj(projects[project!]), has = (k: string) => Array.isArray(pv[k]) && pv[k].includes(name);
          approval = has('disabledMcpjsonServers') ? 'disabled' : has('enabledMcpjsonServers') ? 'enabled' : 'pending';
        }
        if (scope === 'user') { const p = paths.find((x) => own(local.get(x)!, name)) ?? paths.find((x) => own(proj.get(x)!, name)); if (p) shadowedBy = { scope: own(local.get(p)!, name) ? 'local' : 'project', project: p }; }
        const s: McpServerView = { name, scope, ...(project !== undefined ? { project } : {}), file, type, ...(typeof e.command === 'string' ? { command: e.command } : {}),
          ...(Array.isArray(e.args) ? { args: e.args.map(text) } : {}), ...(typeof e.url === 'string' ? { url: e.url } : {}),
          env: pairs(e.env), headers: pairs(e.headers), extraKeys: Object.keys(e).filter((k) => !KNOWN.has(k)), ...(approval ? { approval } : {}), ...(shadowedBy ? { shadowedBy } : {}),
          warnings: [], hash: entryHash(e0), readOnly: scope === 'settings' || !writable };
        servers.push(s); pending.push(this.warnings(scope, e, project).then((w) => { s.warnings = w; }));
      }
    };
    add('user', undefined, this.o.claudeJson, obj(r.cj.mcpServers));
    for (const p of paths) add('local', p, this.o.claudeJson, local.get(p)!);
    for (const p of paths) add('project', p, join(p, '.mcp.json'), proj.get(p)!);
    add('settings', undefined, this.o.settings, obj(r.st.mcpServers));
    const exists = await Promise.all(paths.map((p) => this.kind(this.fs(p))));
    await Promise.all(pending);
    servers.sort((a, b) => RANK[a.scope] - RANK[b.scope] || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || (a.project ?? '').localeCompare(b.project ?? ''));
    const pv: ClaudeProjectView[] = paths.map((p, i) => {
      const v = obj(projects[p]);
      return { path: p, exists: exists[i] === 'dir', localServers: Object.keys(local.get(p)!).length, hasMcpJson: r.mcp.has(p), trusted: v.hasTrustDialogAccepted === true,
        allowedTools: Array.isArray(v.allowedTools) ? v.allowedTools.length : 0, ...(typeof v.lastSessionId === 'string' ? { lastSessionId: v.lastSessionId } : {}),
        ...(typeof v.lastCost === 'number' && Number.isFinite(v.lastCost) ? { lastCost: v.lastCost } : {}) };
    });
    return { files: { claudeJson: this.o.claudeJson, settings: this.o.settings }, readAt: Date.now(), writable, cli, servers, projects: pv };
  }
  /** GET /claude-config */
  async view(): Promise<ClaudeConfigView> { const [r, cli] = await Promise.all([this.read(), this.cli()]); return this.build(r, cli); }
  /** POST /claude-config/mcp/<op>: save | delete | reveal | test. Replies { status, body } (errors as McpErrorResponse). `signal` aborts a running test. */
  async post(op: string, body: unknown, signal?: AbortSignal): Promise<Reply> {
    try {
      if (op === 'reveal') return await this.reveal(obj(body));
      if (op === 'test') return await this.test(obj(body), signal);
      if (op !== 'save' && op !== 'delete') return fail(404, 'unknown operation');
      const cli = await this.cli(); if (this.o.demo || !cli.version) return fail(503, 'read-only', { reason: this.o.demo ? 'demo mode' : cli.error ?? 'claude CLI unavailable' });
      return await this.serial(() => (op === 'save' ? this.save(obj(body)) : this.del(obj(body))));
    } catch (e) { return fail(500, redactText(String((e as Error)?.message ?? e), 300)); }
  }
  private serial<T>(f: () => Promise<T>): Promise<T> { const p = this.chain.then(f, f); this.chain = p.catch(() => {}); return p; }
  private ref(v: any, scopes: readonly McpScope[], strict = false): McpRef | string {
    if (!v || typeof v !== 'object') return 'ref required';
    if (!scopes.includes(v.scope)) return `scope must be ${scopes.join(' | ')}`;
    if (strict ? !(typeof v.name === 'string' && MCP_NAME.test(v.name)) : !(typeof v.name === 'string' && v.name.length >= 1 && v.name.length <= 256 && !/[\0-\x1F\x7F]/.test(v.name)))
      return strict ? 'name: 1-64 letters, digits, - or _ (the claude CLI rule), not starting with -' : 'bad name';
    if (v.scope === 'local' || v.scope === 'project') return typeof v.project === 'string' && v.project ? { scope: v.scope, project: v.project, name: v.name } : 'project required for local/project scope';
    return { scope: v.scope, name: v.name };
  }
  private async knownDir(r: Raw, p: unknown) { return typeof p === 'string' && own(obj(r.cj.projects), p) && (await this.kind(this.fs(p))) === 'dir'; }
  /** Why a CLI write under `ref` would land elsewhere: local scope is keyed by configKey (git root of the real path), project scope writes <real cwd>/.mcp.json. */
  private async misplaced(ref?: McpRef): Promise<string | undefined> {
    if (!ref || (ref.scope !== 'local' && ref.scope !== 'project')) return undefined;
    const p = ref.project!;
    try {
      if (ref.scope === 'local') { const key = await configKey(p); return sameKey(key, p) ? undefined : `the claude CLI keeps local servers for ${p} under ${key} (git root / real path), not under this key; change them from ${key}`; }
      const real = await realpath(p); return sameKey(real, p) ? undefined : `${p} resolves to ${real}; the claude CLI writes .mcp.json in the real path, so entries under this path can't be changed here`;
    } catch { return `${p} does not exist`; }
  }
  /** Copies the files a write may touch into `<runDir>/claude-config-backups/<iso>-[<path hash>-]<file>` (mode 600), keeping the newest 30 saves. */
  private backup(files: string[]): string | undefined {
    const dir = join(this.o.runDir, 'claude-config-backups'); mkdirSync(dir, { recursive: true, mode: 0o700 });
    const iso = new Date().toISOString().replace(/[:.]/g, '-'); let first: string | undefined;
    for (const f of new Set(files)) {
      if (!isFileSync(f)) continue;
      const dst = join(dir, `${iso}-${f === this.o.claudeJson ? '' : `${createHash('sha256').update(dirname(f)).digest('hex').slice(0, 12)}-`}${basename(f)}`);
      copyFileSync(f, dst); chmodSync(dst, 0o600); first ??= dst;
    }
    const stamp = (x: string) => /^\d{4}-\d\d-\d\dT[\d-]+Z/.exec(x)?.[0] ?? x, all = readdirSync(dir), saves = [...new Set(all.map(stamp))].sort();
    const drop = new Set(saves.slice(0, Math.max(0, saves.length - C.backups))); for (const x of all) if (drop.has(stamp(x))) rmSync(join(dir, x), { force: true });
    return first;
  }
  private async mcp(op: 'add-json' | 'remove', ref: McpRef, entry?: unknown): Promise<string | undefined> {
    if (ref.name.startsWith('-')) return 'names starting with "-" cannot be passed to the claude CLI';
    const c = await this.cli(); if (!c.path || !c.version) return c.error ?? 'claude CLI unavailable';
    const r = await run(c.path, ['mcp', op, '-s', ref.scope, ref.name, ...(op === 'add-json' ? ['-'] : [])],
      { cwd: ref.scope === 'user' ? this.home : ref.project, input: op === 'add-json' ? JSON.stringify(entry) : undefined, env: this.env, timeoutMs: C.cliMs });
    if (r.code === 0 && !r.error) return undefined;
    if (REFUSED.test(`${r.stderr}\n${r.stdout}`)) { this.refused = true; return IN_SESSION; } // read-only from now on
    return cliError(r);
  }
  /** After a CLI write: each ref holds the expected entry (as the CLI may normalize it), or is gone (entry undefined). */
  private async verify(checks: Array<{ ref: McpRef; entry?: unknown }>): Promise<string | undefined> {
    const r = await this.read();
    for (const { ref, entry } of checks) {
      const s = this.stored(r, ref), where = `${ref.name} (${ref.scope}${ref.project ? ` ${ref.project}` : ''})`;
      if (entry === undefined ? s !== undefined : s === undefined || canon(s) !== canon(entry)) return entry === undefined ? `${where} is still there` : `${where} was not stored as sent`;
    }
    return undefined;
  }
  private async done(backup: string | undefined, checks: Array<{ ref: McpRef; entry?: unknown }>): Promise<Reply> {
    const bad = await this.verify(checks); if (bad) return fail(500, `the claude CLI reported success, but ${bad}; check the file (backup kept)`, backup ? { backup } : {});
    const body: McpWriteResponse = { ok: true, view: await this.view(), ...(backup ? { backup } : {}) }; return { status: 200, body };
  }
  private async save(b: Record<string, any>): Promise<Reply> {
    const tn = b.target?.name;
    if (b.original && typeof tn === 'string' && !MCP_NAME.test(tn) && b.original.name === tn && b.original.scope === b.target?.scope)
      return fail(400, `"${redactText(tn, 80)}" can't be saved under its current name (the claude CLI only takes letters, digits, - and _): rename it`);
    const t = this.ref(b.target, WRITABLE, true); if (typeof t === 'string') return fail(400, `target: ${t}`);
    if (b.original !== undefined && b.cloneFrom !== undefined) return fail(400, 'original and cloneFrom are exclusive');
    const orig = b.original === undefined ? undefined : this.ref(b.original, WRITABLE); if (typeof orig === 'string') return fail(400, `original: ${orig}`);
    if (orig && typeof b.original.hash !== 'string') return fail(400, 'original.hash required');
    const from = b.cloneFrom === undefined ? undefined : this.ref(b.cloneFrom, SCOPES); if (typeof from === 'string') return fail(400, `cloneFrom: ${from}`);
    const r = await this.read();
    if (t.scope !== 'user' && !(await this.knownDir(r, t.project))) return fail(400, 'target.project must be a project in ~/.claude.json that exists on disk');
    const cur = orig ? this.stored(r, orig) : undefined;
    if (orig && (cur === undefined || entryHash(cur) !== b.original.hash)) return fail(409, 'changed');
    const src = orig ? cur : from ? this.stored(r, from) : undefined;
    if (from && src === undefined) return fail(404, 'cloneFrom not found');
    const bad = (await this.misplaced(t)) ?? (await this.misplaced(orig)); if (bad) return fail(400, bad);
    const e = buildEntry(b.server, src); if (typeof e === 'string') return fail(400, e);
    const same = !!orig && orig.scope === t.scope && orig.name === t.name && (orig.project ?? '') === (t.project ?? '');
    if (!same && this.stored(r, t) !== undefined) return fail(409, 'exists');
    if (t.scope === 'project' && b.confirmProjectSecrets !== true) {
      const keys = projectSecrets(b.server, e);
      if (keys.length) return fail(400, 'confirm-required', { reason: `${join(t.project!, '.mcp.json')} is usually committed to git; this would write ${keys.join(', ')} into it` });
    }
    const backup = this.backup([this.o.claudeJson, ...[t, orig].flatMap((x) => (x?.scope === 'project' ? [this.mcpFile(x.project!)] : []))]), bk = backup ? { backup } : {};
    if (same) { // prove the CLI takes the new JSON (temp name) before removing anything
      let tmp: McpRef; do { const sfx = `__deck_tmp_${randomBytes(3).toString('hex')}`; tmp = { ...t, name: `${t.name.slice(0, 64 - sfx.length)}${sfx}` }; } while (this.stored(r, tmp) !== undefined);
      let x = await this.mcp('add-json', tmp, e); if (x) return fail(500, `claude mcp add-json failed (nothing was changed): ${x}`, bk);
      x = await this.mcp('remove', tmp); if (x) return fail(500, `could not remove the temporary entry ${tmp.name}: ${x}`, bk);
      x = await this.mcp('remove', orig!); if (x) return fail(500, `claude mcp remove failed: ${x}`, bk);
      x = await this.mcp('add-json', t, e);
      if (x) { const back = await this.mcp('add-json', orig!, cur); return fail(500, `claude mcp add-json failed: ${x}${back ? `; restoring the original failed too (see the backup): ${back}` : ' (the original entry was restored)'}`, bk); }
      return this.done(backup, [{ ref: t, entry: e }, { ref: tmp }]);
    }
    let x = await this.mcp('add-json', t, e); if (x) return fail(500, `claude mcp add-json failed: ${x}`, bk);
    if (orig) { x = await this.mcp('remove', orig); if (x) return fail(500, `saved, but removing the old entry failed: ${x}`, bk); }
    return this.done(backup, [{ ref: t, entry: e }, ...(orig ? [{ ref: orig }] : [])]);
  }
  private async del(b: Record<string, any>): Promise<Reply> {
    if (b.scope === 'settings') return fail(400, 'settings entries are read-only (Claude Code does not load them)');
    const ref = this.ref(b, WRITABLE); if (typeof ref === 'string') return fail(400, ref);
    if (typeof b.hash !== 'string') return fail(400, 'hash required');
    const cur = this.stored(await this.read(), ref);
    if (cur === undefined || entryHash(cur) !== b.hash) return fail(409, 'changed');
    const bad = await this.misplaced(ref); if (bad) return fail(400, bad);
    const backup = this.backup([this.o.claudeJson, ...(ref.scope === 'project' ? [this.mcpFile(ref.project!)] : [])]);
    const x = await this.mcp('remove', ref); if (x) return fail(500, `claude mcp remove failed: ${x}`, backup ? { backup } : {});
    return this.done(backup, [{ ref }]);
  }
  private async reveal(b: Record<string, any>): Promise<Reply> {
    const ref = this.ref(b, SCOPES); if (typeof ref === 'string') return fail(400, ref);
    if (b.field !== 'env' && b.field !== 'headers') return fail(400, 'field must be env | headers');
    if (typeof b.key !== 'string' || !b.key) return fail(400, 'key required');
    const cur = this.stored(await this.read(), ref), m = obj(obj(cur)[b.field]);
    if (cur === undefined || !own(m, b.key)) return fail(404, 'not found');
    return { status: 200, body: { value: text(m[b.key]) } };
  }
  /** Runs a probe. Project-scope entries (.mcp.json, often from a cloned repo) need confirm:true unless Claude Code approved them in a trusted project,
   *  and never get `${VAR}` expansion from Claude Deck's env. At most 3 at a time (429). */
  private async test(b: Record<string, any>, signal?: AbortSignal): Promise<Reply> {
    const r = await this.read(); let entry: unknown, name: string, cwd = this.home, gate: McpRef | undefined;
    if (b.ref !== undefined) {
      const ref = this.ref(b.ref, SCOPES); if (typeof ref === 'string') return fail(400, ref);
      entry = this.stored(r, ref); if (entry === undefined) return fail(404, 'not found');
      name = ref.name; if (ref.project && (await this.kind(this.fs(ref.project))) === 'dir') cwd = this.fs(ref.project);
      if (ref.scope === 'project') gate = ref;
    } else {
      const from = b.from === undefined ? undefined : this.ref(b.from, SCOPES); if (typeof from === 'string') return fail(400, `from: ${from}`);
      const src = from ? this.stored(r, from) : undefined; if (from && src === undefined) return fail(404, 'from not found');
      const e = buildEntry(b.server, src); if (typeof e === 'string') return fail(400, e);
      if (b.project !== undefined) { if (!(await this.knownDir(r, b.project))) return fail(400, 'project must be a project in ~/.claude.json that exists on disk'); cwd = this.fs(b.project); }
      entry = e; name = from?.name ?? '<name>'; if (from?.scope === 'project') gate = from;
    }
    if (this.o.demo) return { status: 200, body: { ok: false, ms: 0, error: 'demo mode: servers are not started' } };
    const vars: NodeJS.ProcessEnv = gate ? {} : this.env;
    if (gate && b.confirm !== true) {
      const pv = obj(obj(r.cj.projects)[gate.project!]), has = (k: string) => Array.isArray(pv[k]) && pv[k].includes(gate!.name);
      if (!has('enabledMcpjsonServers') || has('disabledMcpjsonServers') || pv.hasTrustDialogAccepted !== true) return fail(400, 'confirm-required', { reason: redactText(commandLine(entry, vars), 1000) });
    }
    if (this.probes >= C.probes) return fail(429, 'busy');
    this.probes++;
    try { return { status: 200, body: await probeMcp(entry, { name, cwd, env: this.env, vars, signal }) }; } finally { this.probes--; }
  }
}
