// office mod: reports this Claude Code session to the local virtual office server.
// The engine type defs are not vendored here, so every `$` call is optional-chained and wrapped in try/catch:
// a missing API degrades the mod (fewer details), it never breaks the session. See mod/README.md for the API list to verify.
type Any = any;
const HEARTBEAT_MS = 12_000;
const DEFAULT_ENDPOINT = 'http://127.0.0.1:7777/event';

const safe = <T>(f: () => T, fb?: T): T | undefined => { try { return f(); } catch { return fb; } };
const base = (p: unknown) => (typeof p === 'string' ? p.split(/[\\/]/).filter(Boolean).pop() : undefined);
const line1 = (s: unknown, n = 80) => (typeof s === 'string' ? s.split(/\r?\n/)[0].slice(0, n) : undefined);
const firstSentence = (s: unknown) => (typeof s === 'string' ? (s.trim().split(/(?<=[.!?])\s|\n/)[0] ?? '').slice(0, 140) : undefined);

/** Short, non-sensitive tool detail: file basename, first line of a command, a glob/pattern, a URL host, a subagent description. Never contents. */
export function toolDetail(name: string, input: Any): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  if (input.file_path || input.path || input.notebook_path) return base(input.file_path ?? input.path ?? input.notebook_path);
  if (typeof input.command === 'string') return line1(input.command);
  if (typeof input.url === 'string') return safe(() => new URL(input.url).host);
  if (typeof input.pattern === 'string') return line1(input.pattern, 60);
  if (typeof input.query === 'string') return line1(input.query, 60);
  if (typeof input.description === 'string') return line1(input.description, 80);
  return name === 'TodoWrite' ? 'todos' : undefined;
}
/** Claude Code transcript dir: <configDir>/projects/<cwd with non-alphanumerics → '-'>/<sessionId>.jsonl */
export function transcriptPath(configDir: string, cwd: string, sid: string) { return `${configDir}/projects/${cwd.replace(/[^a-zA-Z0-9]/g, '-')}/${sid}.jsonl`; }
/** Last custom-title wins over last ai-title. */
export function titleFromJsonl(text: string): string | undefined {
  let ai: string | undefined, custom: string | undefined;
  for (const l of text.split('\n')) {
    if (!l.includes('-title')) continue;
    const j = safe(() => JSON.parse(l)); if (!j) continue;
    if (j.type === 'custom-title' && j.customTitle) custom = String(j.customTitle);
    if (j.type === 'ai-title' && j.aiTitle) ai = String(j.aiTitle);
  }
  return custom ?? ai;
}

export default function register($: Any) {
  const env: Any = safe(() => (globalThis as Any).process?.env, {}) ?? {};
  const argv: string[] = safe(() => (globalThis as Any).process?.argv, []) ?? [];
  // headless `claude -p` sessions are quiet: skip them entirely
  if (safe(() => $.session?.quiet?.() ?? $.session?.isQuiet?.() ?? $.session?.headless?.()) || argv.includes('-p') || argv.includes('--print')) return;

  const cfg = (k: string) => safe(() => $.config?.get?.(k) ?? $.config?.[k] ?? $.userConfig?.[k] ?? $.options?.[k]);
  const endpoint = String(cfg('endpoint') || env.CLAUDE_PLUGIN_OPTION_ENDPOINT || DEFAULT_ENDPOINT);
  if (!/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\//.test(endpoint)) return; // loopback only, by design
  const sid = () => String(safe(() => $.session?.id?.()) ?? env.CLAUDE_SESSION_ID ?? 'unknown');
  let cwd = String(safe(() => $.session?.cwd?.()) ?? safe(() => (globalThis as Any).process?.cwd?.()) ?? '');
  const root = () => { const r = safe(() => $.session?.repo?.()); return typeof r === 'string' ? r : r?.root ?? r?.path ?? cwd; };
  const configDir = String(env.CLAUDE_CONFIG_DIR || `${env.USERPROFILE || env.HOME || ''}/.claude`);
  let state = 'idle', tool: { name: string; detail?: string } | null = null, prompt: string | undefined, title: string | undefined, ended = false;

  const post = (type: string, extra: Any = {}) => {
    if (ended && type !== 'end') return;
    const body = JSON.stringify({ type, sid: sid(), ...extra });
    const opts = { method: 'POST', headers: { 'content-type': 'application/json' }, body };
    try { const p = $.http?.fetch ? $.http.fetch(endpoint, opts) : (globalThis as Any).fetch?.(endpoint, opts); p?.catch?.(() => {}); } catch { /* office not running: ignore */ }
  };
  const subagents = () => safe(() => ($.agent?.list?.() ?? []).map((a: Any) => ({ id: a.id, type: a.type ?? a.subagentType, description: a.description, status: a.status ?? 'running' })));
  const cost = () => safe(() => { const u = $.session?.usage?.(); return u?.cost?.usd ?? u?.costUsd; });
  const readTitle = async () => {
    try {
      const fs = await import('node:fs');
      const file = transcriptPath(configDir, cwd, sid());
      const st = fs.statSync(file); const n = Math.min(st.size, 256 * 1024); const buf = Buffer.alloc(n);
      const fd = fs.openSync(file, 'r'); try { fs.readSync(fd, buf, 0, n, st.size - n); } finally { fs.closeSync(fd); }
      title = titleFromJsonl(buf.toString('utf8')) ?? title;
    } catch { /* no file API or no transcript yet */ }
  };
  const info = () => ({ project: base(root()) ?? base(cwd), cwd, root: root(), title, transcript: transcriptPath(configDir, cwd, sid()) });
  const send = (type: string) => post(type, { state, tool, prompt, subagents: subagents(), costUsd: cost(), ...(type === 'start' || type === 'heartbeat' ? info() : {}) });
  const set = (s: string, t: typeof tool = tool) => { state = s; tool = t; send(t ? 'tool' : 'state'); };

  const on = (name: string, fn: (e: Any) => void) => {
    const h = (e: Any) => { try { if (e?.cwd) cwd = String(e.cwd); fn(e ?? {}); } catch { /* never break the session */ } };
    try { if ($.on) return $.on(name, h); if ($.hooks?.on) return $.hooks.on(name, h); if ($.events?.on) return $.events.on(name, h); } catch { /* unsupported event name */ }
  };
  const toolOf = (e: Any) => { const name = String(e.tool_name ?? e.toolName ?? e.tool?.name ?? 'tool'); return { name, detail: toolDetail(name, e.tool_input ?? e.toolInput ?? e.input ?? e.tool?.input) }; };

  on('SessionStart', () => { readTitle().finally(() => send('start')); });
  on('UserPromptSubmit', (e) => { prompt = firstSentence(e.prompt ?? e.text); set('thinking', null); });
  on('PreToolUse', (e) => set('tool', toolOf(e)));
  on('PostToolUse', () => set('thinking', null));
  on('PermissionRequest', (e) => set('waiting-permission', toolOf(e)));
  on('Notification', (e) => { if (/permission/i.test(String(e.message ?? e.notification_type ?? ''))) set('waiting-permission'); });
  on('SubagentStart', () => send('subagents'));
  on('SubagentStop', () => send('subagents'));
  on('Stop', () => { readTitle().finally(() => set('done', null)); });
  on('SessionEnd', () => { post('end'); ended = true; stop?.(); });

  // heartbeat keeps the session listed (server drops it after ~60s of silence) and refreshes title/subagents/cost
  const beat = () => { readTitle().finally(() => send('heartbeat')); };
  let stop: (() => void) | undefined;
  try {
    const t = $.clock?.setInterval ? $.clock.setInterval(beat, HEARTBEAT_MS) : $.clock?.every ? $.clock.every(HEARTBEAT_MS, beat) : setInterval(beat, HEARTBEAT_MS);
    stop = () => safe(() => (typeof t === 'function' ? t() : t?.cancel ? t.cancel() : t?.dispose ? t.dispose() : $.clock?.clearInterval ? $.clock.clearInterval(t) : clearInterval(t)));
    safe(() => (t as Any)?.unref?.());
  } catch { /* no timers: events only */ }
  beat(); // register runs at session start; announce immediately in case SessionStart already fired
}
export { register };
