import type { ClaudeProjectView, McpPairInput, McpRef, McpSaveRequest, McpScope, McpServerInput, McpServerView, McpTestRequest } from './types';
import { fold, parseTerms } from './history';
/** Pure helpers for the Claude config tab (unit-tested in test/claude-config.test.ts): import parsing, editor drafts, validation, list filters. */

export type Scope3 = 'user' | 'local' | 'project';
export const SCOPES: McpScope[] = ['user', 'local', 'project', 'settings'];
export const SCOPE_LABEL: Record<McpScope, string> = { user: 'User', local: 'Local', project: 'Project', settings: 'settings.json' };
/** Types the server (and the claude CLI) accept on save; anything else stored is shown with a warning and must be changed before saving. */
export const KNOWN_TYPES = ['stdio', 'http', 'streamable-http', 'sse', 'ws'];
export const NAME_MAX = 64;
/** What the claude CLI accepts as a server name. */
export const NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** Name the CLI accepts: accents dropped, other runs of disallowed chars (spaces, dots…) → '-', no leading/trailing '-'; already valid names stay as they are. */
export function sanitizeName(n: string) {
  if (NAME_RE.test(n) && !n.startsWith('-')) return n;
  const s = n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+/, '').slice(0, NAME_MAX).replace(/-+$/, '');
  return s || 'server';
}
export const renameNote = (from: string, to: string) => `Renamed “${from}” to “${to}”: the claude CLI only accepts letters, digits, _ and -.`;
export const isUrl = (s: string) => /^https?:\/\/\S+$/i.test(s);
export const isWsUrl = (s: string) => /^wss?:\/\/\S+$/i.test(s);
/** url + headers types (everything but stdio among the known ones). */
export const isWeb = (t: string) => t === 'http' || t === 'streamable-http' || t === 'sse' || t === 'ws';
const ENV_KEY = /^[^=\s\0]+$/, HEADER_KEY = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/** POSIX-ish word splitting: whitespace separates; '…' is literal; "…" honours \" \\ \$ \` escapes; a backslash outside quotes escapes the next char; backslash-newline joins lines. Throws on an unclosed quote. */
export function shellSplit(s: string): string[] {
  const out: string[] = []; let cur = '', has = false, i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') {
      const n = s[i + 1];
      if (n === undefined) { cur += c; has = true; i++; } else if (n === '\n') i += 2; else if (n === '\r' && s[i + 2] === '\n') i += 3; else { cur += n; has = true; i += 2; }
      continue;
    }
    if (c === "'") { const j = s.indexOf("'", i + 1); if (j < 0) throw new Error('unclosed single quote'); cur += s.slice(i + 1, j); has = true; i = j + 1; continue; }
    if (c === '"') {
      has = true; i++;
      for (;;) {
        if (i >= s.length) throw new Error('unclosed double quote');
        const d = s[i];
        if (d === '"') { i++; break; }
        if (d === '\\' && i + 1 < s.length && '"\\$`\n'.includes(s[i + 1])) { if (s[i + 1] !== '\n') cur += s[i + 1]; i += 2; continue; }
        cur += d; i++;
      }
      continue;
    }
    if (/\s/.test(c)) { if (has) { out.push(cur); cur = ''; has = false; } i++; continue; }
    cur += c; has = true; i++;
  }
  if (has) out.push(cur);
  return out;
}

/** A backslash outside quotes (not a line continuation): shell rules drop it, which breaks Windows paths. */
export function hasBareBackslash(s: string): boolean {
  let q = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q === "'") { if (c === "'") q = ''; continue; }
    if (q === '"') { if (c === '\\') i++; else if (c === '"') q = ''; continue; }
    if (c === "'" || c === '"') { q = c; continue; }
    if (c === '\\') { const n = s[i + 1]; if (n === '\n' || (n === '\r' && s[i + 2] === '\n')) { i++; continue; } return true; }
  }
  return false;
}
/** `$VAR` / `$(…)` anywhere in the server (Claude Code only expands `${VAR}`). */
export const hasLiteralVars = (v: McpServerInput) => [v.command ?? '', v.url ?? '', ...(v.args ?? []), ...[...(v.env ?? []), ...(v.headers ?? [])].map((p) => p.value ?? '')].some((x) => /\$(?!\{)[A-Za-z_(]/.test(x));
export const BACKSLASH_NOTE = 'Backslashes outside quotes were dropped (shell rules): quote Windows paths, e.g. \'C:\\tools\\server.exe\'.';
export const VAR_NOTE = '$VAR and $(…) are kept as literal text: Claude Code only expands ${VAR}.';
/** One server parsed from pasted JSON or a `claude mcp add` command; name '' = ask the user. notes: what was inferred or left out. */
export type ImportItem = { name: string; scope?: Scope3; server: McpServerInput; notes: string[] };
export type ImportResult = { ok: true; items: ImportItem[] } | { ok: false; error: string };
const fail = (error: string): ImportResult => ({ ok: false, error });
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const scopeArg = (v?: string): Scope3 | undefined => v === 'global' ? 'user' : v === 'user' || v === 'local' || v === 'project' ? v : undefined;
const ENV_RE = /^([^=]+)=([\s\S]*)$/, HDR_RE = /^([^:]+):\s*([\s\S]*)$/, HDR_START = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+:(?!\/\/)/;

/** Server object (Claude / VS Code / Cursor style) → McpServerInput; keys we can't edit here are reported in notes. */
export function serverFromObject(name: string, o: Record<string, unknown>): ImportItem {
  const notes: string[] = [], str = (v: unknown) => (v == null ? '' : String(v));
  const url = typeof o.url === 'string' ? o.url : '';
  let type = typeof o.type === 'string' && o.type ? o.type : '';
  if (!type) { type = url && !o.command ? (isWsUrl(url) ? 'ws' : 'http') : 'stdio'; if (url && !o.command) notes.push(`No "type": a url is taken as ${type}.`); }
  let args: string[] = [];
  if (Array.isArray(o.args)) args = o.args.map(str);
  else if (typeof o.args === 'string') { try { args = shellSplit(o.args); notes.push('"args" was a string: split like a shell would.'); } catch { args = [o.args]; } }
  const pairs = (v: unknown): McpPairInput[] => isObj(v) ? Object.entries(v).map(([key, value]) => ({ key, value: str(value) })) : [];
  const stdio = type === 'stdio', web = isWeb(type), env = pairs(o.env), headers = pairs(o.headers);
  const extra = Object.keys(o).filter((k) => !['type', 'command', 'args', 'url', 'env', 'headers'].includes(k));
  if (extra.length) notes.push(`Not imported: ${extra.join(', ')}.`);
  if (web && (o.command || args.length || env.length)) notes.push(`${type} server: command/args/env left out.`);
  if (stdio && (url || headers.length)) notes.push('stdio server: url/headers left out.');
  const server: McpServerInput = { type, ...(!web ? { command: str(o.command), args, env } : {}), ...(!stdio ? { url, headers } : {}) };
  if (hasLiteralVars(server)) notes.push(VAR_NOTE);
  return { name, server, notes };
}
const looksServer = (o: Record<string, unknown>) => typeof o.command === 'string' || typeof o.url === 'string' || (typeof o.type === 'string' && !isObj(o.type));
/** Pasted JSON: `{"mcpServers":{name:{…}}}` (or VS Code's `{"servers":…}`), `{name:{…}}`, a bare server (name ''), or a `"name": {…}` fragment. */
export function parseMcpJson(text: string): ImportResult {
  const t = text.trim(); if (!t) return fail('Paste a JSON object.');
  let o: unknown;
  try { o = JSON.parse(t); } catch (e) { try { o = JSON.parse(`{${t.replace(/,\s*$/, '')}}`); } catch { return fail(`Not valid JSON: ${(e as Error).message}`); } }
  if (!isObj(o)) return fail('Expected a JSON object.');
  if (looksServer(o)) return { ok: true, items: [serverFromObject('', o)] };
  const map = isObj(o.mcpServers) ? o.mcpServers : isObj(o.servers) ? o.servers : o;
  const items = Object.entries(map).filter(([, v]) => isObj(v)).map(([k, v]) => serverFromObject(k, v as Record<string, unknown>));
  return items.length ? { ok: true, items } : fail('No MCP servers found in that JSON.');
}

/** `claude mcp add [-s scope] [-t transport] [-e K=V]… [-H "K: V"]… <name> <commandOrUrl> [args…]` (also `--`, `--scope=`, `--transport=`)
 *  and `claude mcp add-json [-s scope] <name> '<json>'`. -e/-H take several values like the CLI (while they look like K=V / "K: V"). */
export function parseMcpAddCommand(text: string): ImportResult {
  let t: string[];
  try { t = shellSplit(text.trim()); } catch (e) { return fail(`Can't split the command: ${(e as Error).message}.`); }
  const at = t.findIndex((x, k) => x === 'mcp' && (t[k + 1] === 'add' || t[k + 1] === 'add-json'));
  if (at < 0) return fail('Expected "claude mcp add …" or "claude mcp add-json …".');
  const json = t[at + 1] === 'add-json', rest = t.slice(at + 2), pos: string[] = [], env: McpPairInput[] = [], headers: McpPairInput[] = [], notes: string[] = hasBareBackslash(text) ? [BACKSLASH_NOTE] : [];
  let scope: Scope3 | undefined, transport: string | undefined, dd = false;
  for (let k = 0; k < rest.length; k++) {
    const a = rest[k];
    if (dd || a === '-' || !a.startsWith('-')) { pos.push(a); continue; }
    if (a === '--') { dd = true; continue; }
    const eq = a.startsWith('--') ? a.indexOf('=') : -1, flag = eq > 0 ? a.slice(0, eq) : a, inline = eq > 0 ? a.slice(eq + 1) : undefined;
    const val = () => inline ?? rest[++k];
    if (flag === '-s' || flag === '--scope') { const v = val(), s = scopeArg(v); if (!s) return fail(`Unknown scope "${v ?? ''}" (user, local or project).`); scope = s; continue; }
    if (!json && (flag === '-t' || flag === '--transport')) { const v = val(); if (!v) return fail(`${flag} needs a value (stdio, http or sse).`); transport = v; continue; }
    if (!json && (flag === '-e' || flag === '--env' || flag === '-H' || flag === '--header')) {
      const isEnv = flag === '-e' || flag === '--env', re = isEnv ? ENV_RE : HDR_RE, more = isEnv ? /^[A-Za-z_][A-Za-z0-9_]*=/ : HDR_START;
      let v = val();
      for (;;) {
        const m = v === undefined ? null : re.exec(v);
        if (!m) return fail(isEnv ? `-e expects KEY=VALUE, got "${v ?? ''}".` : `-H expects "Name: value", got "${v ?? ''}".`);
        (isEnv ? env : headers).push({ key: m[1].trim(), value: m[2] });
        if (inline === undefined && more.test(rest[k + 1] ?? '')) { v = rest[++k]; continue; }
        break;
      }
      continue;
    }
    if (flag === '--client-id' || flag === '--callback-port') { val(); notes.push(`Not imported: ${flag} (OAuth; set it up in Claude Code).`); continue; }
    if (flag === '--client-secret') { notes.push('Not imported: --client-secret (OAuth; set it up in Claude Code).'); continue; }
    if (pos.length >= 2 && !json) { pos.push(a); continue; } // after the command: an argument for the server (the CLI wants `--` here)
    return fail(`Unknown option "${a}".`);
  }
  const name = pos[0];
  if (!name) return fail('Missing the server name.');
  if (json) {
    if (!pos[1]) return fail('Missing the JSON after the name.');
    let o: unknown; try { o = JSON.parse(pos[1]); } catch (e) { return fail(`Not valid JSON: ${(e as Error).message}`); }
    if (!isObj(o)) return fail('add-json expects a JSON object.');
    const it = serverFromObject(name, o); return { ok: true, items: [{ ...it, ...(scope ? { scope } : {}), notes: [...notes, ...it.notes.filter((n) => !notes.includes(n))] }] };
  }
  const target = pos[1];
  if (!target) return fail('Missing the command or URL after the name.');
  let type = transport ?? 'stdio';
  if (!transport && (isUrl(target) || isWsUrl(target))) { type = isWsUrl(target) ? 'ws' : 'http'; notes.push(`No --transport: a URL is taken as ${type}.`); }
  const web = isWeb(type);
  if (web && pos.length > 2) notes.push(`Ignored extra arguments after the URL: ${pos.slice(2).join(' ')}`);
  if (web && env.length) notes.push(`${type} server: -e values left out.`);
  if (!web && headers.length) notes.push(`${type} server: -H headers left out.`);
  const server: McpServerInput = web ? { type, url: target, headers } : { type, command: target, args: pos.slice(2), env };
  if (hasLiteralVars(server)) notes.push(VAR_NOTE);
  return { ok: true, items: [{ name, ...(scope ? { scope } : {}), server, notes }] };
}

/** Editor row. masked: the stored value is a secret; while the key is still `orig` and the value is '' (never revealed) or the revealed `shown`, it's sent as {key, keep:true}. */
export type PairDraft = { key: string; value: string; masked?: boolean; orig?: string; shown?: string };
export type McpDraft = {
  mode: 'new' | 'edit' | 'clone'; scope: Scope3; project: string; name: string; type: string;
  command: string; /** one argument per line */ args: string; url: string; env: PairDraft[]; headers: PairDraft[]; extraKeys: string[];
  original?: McpRef & { hash: string }; cloneFrom?: McpRef;
  /** stored args hold '' or line breaks, which the one-per-line box can't round-trip */
  lossyArgs?: boolean;
};
export const refOf = (v: { scope: McpScope; project?: string; name: string }): McpRef => ({ scope: v.scope, ...(v.project ? { project: v.project } : {}), name: v.name });
export const refKey = (v: { scope: McpScope; project?: string; name: string }) => `${v.scope}\u0000${v.project ?? ''}\u0000${v.name}`;
/** First free `base`, `base-2`, `base-3`… */
export function uniqueName(base: string, taken: ReadonlySet<string>) { if (!taken.has(base)) return base; for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`; }
/** Names already used where a draft would be saved (scope + project). */
export function namesIn(servers: readonly McpServerView[], scope: McpScope, project?: string) {
  return new Set(servers.filter((v) => v.scope === scope && (scope === 'user' || scope === 'settings' || (v.project ?? '') === (project ?? ''))).map((v) => v.name));
}
const pairsDraft = (ps: McpServerView['env']): PairDraft[] => ps.map((p) => p.masked ? { key: p.key, value: '', masked: true, orig: p.key } : { key: p.key, value: p.value ?? '' });
export const argsText = (args: readonly string[] = []) => args.join('\n');
/** Lines → args: keeps order and spaces inside an argument, drops empty lines. */
export const argsFromText = (t: string) => t.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l !== '');
export function emptyDraft(scope: Scope3 = 'user', project = ''): McpDraft {
  return { mode: 'new', scope, project: scope === 'user' ? '' : project, name: '', type: 'stdio', command: '', args: '', url: '', env: [], headers: [], extraKeys: [] };
}
/** Stored entry → editor draft. edit: same place, sends `original` (+hash); clone: `<sanitized name>-copy` (free in `taken`), sends `cloneFrom` so masked values are kept; settings.json entries clone into user scope. */
export function draftFromView(v: McpServerView, mode: 'edit' | 'clone', taken: ReadonlySet<string> = new Set()): McpDraft {
  const scope: Scope3 = v.scope === 'settings' ? 'user' : v.scope, args = v.args ?? [];
  return {
    mode, scope, project: scope === 'user' ? '' : v.project ?? '', name: mode === 'clone' ? uniqueName(`${sanitizeName(v.name).slice(0, NAME_MAX - 7)}-copy`, taken) : v.name, type: v.type || 'stdio',
    command: v.command ?? '', args: argsText(args), url: v.url ?? '', env: pairsDraft(v.env), headers: pairsDraft(v.headers), extraKeys: v.extraKeys,
    ...(args.some((a) => a === '' || /[\r\n]/.test(a)) ? { lossyArgs: true } : {}),
    ...(mode === 'edit' ? { original: { ...refOf(v), hash: v.hash } } : { cloneFrom: refOf(v) }),
  };
}
/** Parsed import → new draft (scope from `-s` when given, else the defaults; the name made CLI-safe, see renameNote). */
export function draftFromImport(it: ImportItem, def: { scope: Scope3; project: string }): McpDraft {
  const s = it.server, scope = it.scope ?? def.scope, pd = (ps: McpPairInput[] = []): PairDraft[] => ps.map((p) => ({ key: p.key, value: p.value ?? '' }));
  return { ...emptyDraft(scope, def.project), name: it.name ? sanitizeName(it.name) : '', type: s.type || 'stdio', command: s.command ?? '', args: argsText(s.args), url: s.url ?? '', env: pd(s.env), headers: pd(s.headers) };
}
const keyOf = (p: PairDraft) => p.key.trim();
const keepIt = (p: PairDraft) => !!p.masked && keyOf(p) === p.orig && (p.value === '' || p.value === p.shown);
/** A revealed secret fills the row but still goes back as keep:true unless it's edited. */
export const revealRow = (p: PairDraft, value: string): PairDraft => ({ ...p, value, shown: value });
const pairsIn = (ps: PairDraft[]): McpPairInput[] => ps.filter((p) => keyOf(p) || p.value).map((p) => keepIt(p) ? { key: keyOf(p), keep: true } : { key: keyOf(p), value: p.value });
/** Draft → wire input: stdio sends command/args/env, http/streamable-http/sse/ws url/headers, an unknown type both; blank rows dropped; untouched masked rows → {key, keep:true}. */
export function draftToInput(d: McpDraft): McpServerInput {
  const t = d.type.trim(), web = isWeb(t), stdio = t === 'stdio';
  return { type: t, ...(!web ? { command: d.command.trim(), args: argsFromText(d.args), env: pairsIn(d.env) } : {}), ...(!stdio ? { url: d.url.trim(), headers: pairsIn(d.headers) } : {}) };
}
export const targetRef = (d: McpDraft): McpRef => ({ scope: d.scope, ...(d.scope !== 'user' ? { project: d.project } : {}), name: d.name.trim() });
export function saveRequest(d: McpDraft): McpSaveRequest {
  return { target: targetRef(d), server: draftToInput(d), ...(d.original ? { original: d.original } : {}), ...(d.cloneFrom ? { cloneFrom: d.cloneFrom } : {}) };
}
/** A stored entry without edits is tested by ref; anything else as a draft (masked values come from `from`; runs in the project dir). */
export function testRequest(d: McpDraft, dirty: boolean): McpTestRequest {
  if (d.original && !dirty) return { ref: refOf(d.original) };
  const from = d.original ? refOf(d.original) : d.cloneFrom;
  return { server: draftToInput(d), ...(from ? { from } : {}), ...(d.scope !== 'user' && d.project ? { project: d.project } : {}) };
}
/** Stable fingerprint of the editable fields (dirty check). */
export const draftKey = (d: McpDraft) => JSON.stringify([d.scope, d.project, d.name, d.type, d.command, d.args, d.url, d.env, d.headers]);
const EDITABLE = ['scope', 'project', 'name', 'type', 'command', 'args', 'url', 'env', 'headers'] as const;
/** After a reload (409 changed): keep the fields the user edited (draft vs init) and take the others from the fresh stored entry, with its refs and hash. */
export function rebaseDraft(draft: McpDraft, init: McpDraft, fresh: McpDraft): McpDraft {
  const out: McpDraft = { ...fresh };
  for (const k of EDITABLE) if (JSON.stringify(draft[k]) !== JSON.stringify(init[k])) Object.assign(out, { [k]: draft[k] });
  return out;
}

export type DraftErrors = Partial<Record<'name' | 'project' | 'type' | 'command' | 'url' | 'env' | 'headers', string>>;
/** Mirrors the server + claude CLI: name ^[A-Za-z0-9_-]{1,64}$, not starting with '-', free in the target scope; local/project need a known project;
 *  type one of KNOWN_TYPES; stdio needs a command, ws a ws(s):// url, the other url types an http(s) url; env keys without '=' or whitespace, header keys
 *  HTTP tokens; keys unique (headers ignoring case); a renamed secret needs a new value. */
export function validateDraft(d: McpDraft, servers: readonly McpServerView[] = [], projects?: readonly ClaudeProjectView[]): DraftErrors {
  const e: DraftErrors = {}, name = d.name.trim(), t = d.type.trim();
  if (!name) e.name = 'Name is required.';
  else if (name.length > NAME_MAX) e.name = `At most ${NAME_MAX} characters.`;
  else if (!NAME_RE.test(name)) e.name = 'Only letters, digits, _ and - (the claude CLI rejects other names).';
  else if (name.startsWith('-')) e.name = 'Can\'t start with "-".';
  else {
    const self = d.original && refKey(d.original), dup = servers.find((v) => v.scope === d.scope && (d.scope === 'user' || (v.project ?? '') === d.project) && v.name === name && refKey(v) !== self);
    if (dup) e.name = `"${name}" already exists in ${SCOPE_LABEL[d.scope]} scope${d.scope === 'user' ? '' : ` of ${d.project}`}.`;
  }
  if (d.scope !== 'user') { if (!d.project) e.project = 'Pick a project.'; else if (projects && !projects.some((p) => p.path === d.project)) e.project = 'Not a project Claude Code knows.'; }
  if (!t) e.type = 'Type is required.';
  else if (!KNOWN_TYPES.includes(t)) e.type = `Unknown type "${t}": pick ${KNOWN_TYPES.join(', ')} before saving.`;
  if (t === 'stdio' && !d.command.trim()) e.command = 'Command is required for stdio.';
  if (t === 'ws' ? !isWsUrl(d.url.trim()) : isWeb(t) && !isUrl(d.url.trim())) e.url = t === 'ws' ? 'Needs a ws:// or wss:// URL.' : 'Needs an http(s):// URL.';
  const pairs = (ps: PairDraft[], ci: boolean, what: string) => {
    const seen = new Set<string>();
    for (const p of ps) {
      const k = keyOf(p); if (!k && !p.value) continue;
      if (!k) return `Every ${what} needs a name.`;
      if (!(ci ? HEADER_KEY : ENV_KEY).test(k)) return ci ? `Header name "${k}" may only use letters, digits and !#$%&'*+.^_\`|~-.` : `Env name "${k}" can't contain "=" or spaces.`;
      const kk = ci ? k.toLowerCase() : k; if (seen.has(kk)) return `Duplicate ${what} "${k}".`; seen.add(kk);
      if (p.masked && p.value === '' && k !== p.orig) return `Enter a value for "${k}" (the stored secret belonged to "${p.orig}").`;
    }
  };
  if (!isWeb(t)) { const m = pairs(d.env, false, 'env variable'); if (m) e.env = m; }
  if (t !== 'stdio') { const m = pairs(d.headers, true, 'header'); if (m) e.headers = m; }
  return e;
}

export type ServerFilter = { q?: string; scope?: McpScope | 'all'; project?: string };
const hay = (v: McpServerView) => fold([v.name, v.command ?? '', v.url ?? '', v.project ?? '', (v.args ?? []).join(' ')].join('\n'));
/** Search (every word in name/command/url/project/args, case- and accent-insensitive) + project (narrows local/project entries only). */
export function matchServer(v: McpServerView, f: ServerFilter) {
  if (f.project && (v.scope === 'local' || v.scope === 'project') && v.project !== f.project) return false;
  const ts = parseTerms(f.q ?? ''); if (!ts.length) return true;
  const h = hay(v); return ts.every((t) => h.includes(t));
}
export function filterServers(list: readonly McpServerView[], f: ServerFilter) { return list.filter((v) => (!f.scope || f.scope === 'all' || v.scope === f.scope) && matchServer(v, f)); }
/** Chip counts for the search + project filter (ignoring the scope chip). */
export function scopeCounts(list: readonly McpServerView[], f: ServerFilter): Record<McpScope | 'all', number> {
  const c = { all: 0, user: 0, local: 0, project: 0, settings: 0 };
  for (const v of list) if (matchServer(v, f)) { c.all++; c[v.scope]++; }
  return c;
}
export type ServerGroup = { key: string; scope: McpScope; project?: string; servers: McpServerView[] };
/** Groups in scope order (user, local, project, settings.json), local/project split per project path; names sorted case-insensitively. */
export function groupServers(list: readonly McpServerView[]): ServerGroup[] {
  const m = new Map<string, ServerGroup>();
  for (const v of list) { const p = v.scope === 'local' || v.scope === 'project' ? v.project ?? '' : undefined, k = `${v.scope}\u0000${p ?? ''}`; let g = m.get(k); if (!g) m.set(k, g = { key: k, scope: v.scope, ...(p !== undefined ? { project: p } : {}), servers: [] }); g.servers.push(v); }
  const by = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });
  for (const g of m.values()) g.servers.sort((a, b) => by(a.name, b.name));
  return [...m.values()].sort((a, b) => SCOPES.indexOf(a.scope) - SCOPES.indexOf(b.scope) || by(a.project ?? '', b.project ?? ''));
}
export const MASK = '••••';
const SECRET_WORD = /(^|[-_.])(token|secret|password|passwd|pwd|auth|apikey|api[-_]?key|key|access[-_]?key|access[-_]?token|credentials?|private[-_]?key|sig|signature)([-_.]|$)/i;
const QUERY_SECRET = /([?&](?:api[_-]?key|key|token|access[_-]?token|secret|password|sig|signature)=)([^&#\s]+)/gi;
/** URL with the userinfo password and secret-looking query values masked (display only). */
export const maskUrl = (u: string) => u.replace(/^([a-z][a-z0-9+.-]*:\/\/[^/@:\s]*:)([^@/\s]+)(@)/i, `$1${MASK}$3`).replace(QUERY_SECRET, `$1${MASK}`);
/** Args with secret-looking values masked (display only): --access-token=…, --api-key …(value in the next arg), TOKEN=… pairs, "Authorization: Bearer …", URLs. */
export function maskArgs(args: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i], fl = /^(--?[A-Za-z0-9][\w.-]*)(?:=([\s\S]+))?$/.exec(a), kv = /^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]+)$/.exec(a);
    if (fl && SECRET_WORD.test(fl[1].replace(/^-+/, ''))) {
      if (fl[2] !== undefined) out.push(`${fl[1]}=${MASK}`);
      else if (i + 1 < args.length && !args[i + 1].startsWith('-')) { out.push(a, MASK); i++; } else out.push(a);
      continue;
    }
    if (kv && SECRET_WORD.test(kv[1])) { out.push(`${kv[1]}=${MASK}`); continue; }
    out.push(maskUrl(a).replace(/(authorization:\s*(?:bearer|basic|token)\s+)\S+/gi, `$1${MASK}`).replace(/^((?:bearer|basic)\s+)\S+$/i, `$1${MASK}`));
  }
  return out;
}
/** Display form of a server's command line / url: masked parts + whether anything was hidden. */
export function maskedView(v: { args?: string[]; url?: string }): { args: string[]; url: string; masked: boolean } {
  const args = maskArgs(v.args ?? []), url = maskUrl(v.url ?? '');
  return { args, url, masked: url !== (v.url ?? '') || args.some((a, i) => a !== v.args?.[i]) };
}
export const originOf = (u: string) => { try { const o = new URL(u.trim()).origin; return o === 'null' ? undefined : o.toLowerCase(); } catch { return undefined; } };
/** Kept (stored, unchanged) headers that would now be sent to another origin than the stored URL's: confirm first. */
export function keptHeadersMoved(d: McpDraft, storedUrl?: string): { keys: string[]; from: string; to: string } | undefined {
  if (!isWeb(d.type.trim()) || !storedUrl) return undefined;
  const keys = d.headers.filter(keepIt).map(keyOf), from = originOf(storedUrl), to = originOf(d.url);
  return keys.length && from && to && from !== to ? { keys, from, to } : undefined;
}
/** Accept a fetched view only if it isn't older than the one shown (responses can arrive out of order). */
export const isNewerView = (shownReadAt: number, readAt: number) => readAt >= shownReadAt;
export const RUN_CONFIRM = 'This project server isn\'t approved/trusted in Claude Code. Run it?';
export const projectSecretsText = (project: string) => `Secrets will be written in plain text to ${project}/.mcp.json, which is usually committed. Prefer \${VAR} references.`;
/** "User scope (~/.claude.json)", "Local scope of /p (~/.claude.json)", "Project scope (/p/.mcp.json)", "/x/settings.json (not loaded by Claude Code)". */
export function describeLocation(v: { scope: McpScope; project?: string; file: string }) {
  return v.scope === 'settings' ? `${v.file} (not loaded by Claude Code)` : `${SCOPE_LABEL[v.scope]} scope${v.scope === 'local' && v.project ? ` of ${v.project}` : ''} (${v.file})`;
}
/** One-line summary for list rows: command + args, or the url; secret-looking parts masked unless `show`. */
export function serverLine(v: McpServerView, show = false) {
  const m = show ? { args: v.args ?? [], url: v.url ?? '' } : maskedView(v);
  return isWeb(v.type) || (!v.command && v.url) ? m.url : [v.command ?? '', ...m.args.map((a) => /[\s"']/.test(a) || a === '' ? JSON.stringify(a) : a)].join(' ');
}
export const typeLabel = (t: string) => t || 'stdio';

/** Why the tab is read-only. inSession: the orchestrator runs inside a Claude Code session, where the claude CLI refuses config writes. */
export function readOnlyReason(cli: { error?: string }): { text: string; inSession: boolean } {
  const text = cli.error || 'demo mode', inSession = /claude ?code session|CLAUDECODE|nested|inside (a )?claude/i.test(text);
  return { text, inSession };
}
export const IN_SESSION_FIX = 'The orchestrator was started inside a Claude Code session, where the claude CLI refuses to change its config. Restart it with the Claude Deck app or from a normal terminal.';
export const CHANGED_MSG = 'The file changed (Claude Code writes it often). Reloaded; check and save again.';
export const APPLY_NOTE = 'Takes effect in NEW Claude Code sessions. Running sessions: /mcp → reconnect, or restart them.';
/** User-facing text for a failed claude-config request ({error} body when the server sent one; status 0 = network, -1 = not JSON). */
export function configErrorText(status: number, error: string | undefined, kind: 'load' | 'save' | 'delete' | 'test' | 'reveal', x: { reason?: string; backup?: string } = {}) {
  const t = errorBody(status, error, kind, x.reason);
  return x.backup ? `${t} Backup: ${x.backup}` : t;
}
function errorBody(status: number, error: string | undefined, kind: string, reason?: string) {
  if (status === 401 || status === 403) return 'The run token was rejected. Reopen the URL from orchestrator/.run/ui-url.txt.';
  if (status === 0) return 'Cannot reach the orchestrator. Is it running?';
  if (status === -1) return 'Unexpected response from the orchestrator.';
  if (kind === 'load' && (status === 404 || status === 405 || status === 501)) return 'This orchestrator is too old for the Claude tab (no /claude-config). Restart it.';
  if (status === 409) return error === 'changed' ? CHANGED_MSG : error || 'A server with that name already exists there.';
  if (status === 503) return `Read-only: ${reason || (error && error !== 'read-only' ? error : 'Claude Code config can\'t be written now (demo mode or claude CLI missing).')}`;
  if (status === 400 && error === 'confirm-required') return `Needs confirmation${reason ? `: ${reason}` : '.'}`;
  if (status === 404) return error && error !== 'not found' ? `Not found: ${error}` : 'That server no longer exists. Reload.';
  if (status === 400) return error ? `Invalid: ${error}${reason ? ` (${reason})` : ''}` : 'Invalid request.';
  if (status === 500) return error ? `Claude CLI failed: ${error}` : 'Claude CLI failed.';
  return `Request failed (${status})${error ? `: ${error}` : ''}.`;
}
