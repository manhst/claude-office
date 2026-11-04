// office mod: reports this Claude Code session to the local virtual office server (POST <endpoint>, loopback only).
// API as used by the owner's working usage-esp mod. Every handler observes only and always calls next(e).
import type { Register } from 'claude-code';
type Any = any;
const HEARTBEAT_MS = 12_000;
const DEFAULT_ENDPOINT = 'http://127.0.0.1:7777/event';


const base = (p: unknown) => (typeof p === 'string' ? p.split(/[\\/]/).filter(Boolean).pop() : undefined);
const line1 = (s: unknown, n = 80) => (typeof s === 'string' ? s.split(/\r?\n/)[0].slice(0, n) : undefined);
const firstSentence = (s: unknown) => (typeof s === 'string' && s.trim() ? (s.trim().split(/(?<=[.!?])\s|\n/)[0] ?? '').slice(0, 140) : undefined);

/** Short, non-sensitive tool detail: file basename, first line of a command, a URL host, a pattern/query, a description. Never contents. */
export function toolDetail(name: string, a: Any): string | undefined {
  if (!a || typeof a !== 'object') return undefined;
  const file = a.file_path ?? a.path ?? a.notebook_path;
  if (typeof file === 'string') return base(file);
  if (typeof a.command === 'string') return line1(a.command);
  if (typeof a.url === 'string') { try { return new URL(a.url).host; } catch { return undefined; } }
  if (typeof a.pattern === 'string') return line1(a.pattern, 60);
  if (typeof a.query === 'string') return line1(a.query, 60);
  if (typeof a.description === 'string') return line1(a.description, 80);
  return name === 'TodoWrite' ? 'todos' : undefined;
}
/** <configDir>/projects/<cwd with non-alphanumerics → '-'>/<sessionId>.jsonl */
export function transcriptPath(configDir: string, cwd: string, sid: string) { return `${configDir}/projects/${cwd.replace(/[^a-zA-Z0-9]/g, '-')}/${sid}.jsonl`; }
/** Last custom-title wins over last ai-title. */
export function titleFromJsonl(text: string): string | undefined {
  let ai: string | undefined, custom: string | undefined;
  for (const l of text.split('\n')) {
    if (!l.includes('-title')) continue;
    let j: Any; try { j = JSON.parse(l); } catch { continue; }
    if (j?.type === 'custom-title' && j.customTitle) custom = String(j.customTitle);
    if (j?.type === 'ai-title' && j.aiTitle) ai = String(j.aiTitle);
  }
  return custom ?? ai;
}

// The engine checks this module statically: `$` is never stored, destructured, spread, returned or put in objects.
// It is only a handler parameter, the first parameter/argument of module-level helpers, and spelled `$.noun.verb(...)`.
type State = {
  endpoint: string; loopback: boolean; quiet: boolean; ended: boolean; sid: string; cwd: string; root: string; transcript: string;
  title?: string; sessionTitle?: string; state: string; tool: { name: string; detail?: string } | null; prompt?: string; queue: Promise<void>;
};

async function subagents($: Any) {
  try { return ((await $.agent.list()) ?? []).map((a: Any) => ({ type: a.type, description: a.description, status: a.status })); } catch { return []; }
}
async function readTitle($: Any, st: State) {
  if (st.sessionTitle) { st.title = st.sessionTitle; return; } // classic events give it directly
  try { if (st.transcript && (await $.fs.exists(st.transcript))) st.title = titleFromJsonl(await $.fs.read(st.transcript)) ?? st.title; } catch { /* no transcript yet */ }
}
async function post($: Any, st: State, type: string, body: Any) {
  body.subagents = await subagents($);
  try { body.costUsd = (await $.session.usage())?.cost?.usd; } catch { /* no usage */ }
  if (type === 'start' || type === 'heartbeat') Object.assign(body, { project: base(st.root) ?? base(st.cwd), cwd: st.cwd, root: st.root, title: st.title, transcript: st.transcript });
  try { await $.http.fetch(st.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); } catch { /* office not running */ }
}
/** Posts go out one at a time, in event order; the body is snapshotted now. */
function send($: Any, st: State, type: string): Promise<void> {
  if (st.quiet || !st.loopback || !st.sid || (st.ended && type !== 'end')) return st.queue;
  const body: Any = { type, sid: st.sid, state: st.state, tool: st.tool, prompt: st.prompt };
  st.queue = st.queue.then(() => post($, st, type, body)).catch(() => {});
  return st.queue;
}
function setState($: Any, st: State, s: string, t: State['tool'], type = t ? 'tool' : 'state') { st.state = s; st.tool = t; void send($, st, type); }
async function heartbeat($: Any, st: State) { await readTitle($, st); await send($, st, 'heartbeat'); }
async function start($: Any, st: State, e: Any) {
  st.quiet = ((await $.env.get('CLAUDE_CODE_ENTRYPOINT')) ?? '') === 'sdk-cli'; // headless claude -p
  if (st.quiet) return;
  st.sid = String(await $.session.id());
  st.cwd = String(e?.cwd ?? '');
  try { st.root = (await $.session.repo())?.root ?? st.cwd; } catch { st.root = st.cwd; }
  const home = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME')) || '';
  const config = (await $.env.get('CLAUDE_CONFIG_DIR')) || (home ? `${home}/.claude` : '');
  if (!st.transcript) st.transcript = config && st.cwd ? transcriptPath(config, st.cwd, st.sid) : '';
  await readTitle($, st); void send($, st, 'start');
}
function classicInfo(st: State, e: Any) {
  if (typeof e?.session_title === 'string' && e.session_title) st.sessionTitle = st.title = e.session_title;
  if (typeof e?.transcript_path === 'string' && e.transcript_path) st.transcript = e.transcript_path;
}

export const register: Register = (on: Any, options: Any) => {
  const endpoint = String(options?.endpoint || DEFAULT_ENDPOINT);
  const st: State = {
    endpoint, loopback: /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\//.test(endpoint), // by design: never post off this PC
    quiet: false, ended: false, sid: '', cwd: '', root: '', transcript: '', state: 'idle', tool: null, queue: Promise.resolve(),
  };
  let beating = false;
  on('session.start', async ($: Any, e: Any, next: Any) => {
    try {
      await start($, st, e);
      if (!st.quiet && !beating) { beating = true; $.clock.every(HEARTBEAT_MS, () => void heartbeat($, st)); }
    } catch { /* never break the session */ }
    return next(e);
  });
  on('turn.start', ($: Any, e: Any, next: Any) => { if (e?.agentId === undefined) setState($, st, 'thinking', null); else void send($, st, 'subagents'); return next(e); });
  on('tool.call', async ($: Any, e: Any, next: Any) => {
    if (next?.origin?.plugin === 'engine') {
      const name = String(e?.tool ?? 'tool');
      if (e?.agentId === undefined) setState($, st, 'tool', { name, detail: toolDetail(name, e) }); else void send($, st, 'subagents'); // subagent calls: refresh list only
    }
    return await next(e);
  }).catch(($: Any, e: Any, next: Any) => next(e));
  on('classic.PermissionRequest', ($: Any, e: Any, next: Any) => {
    const name = String(e?.tool_name ?? 'tool');
    setState($, st, 'waiting-permission', { name, detail: toolDetail(name, e?.tool_input) }, 'state');
    return next(e);
  }).catch(($: Any, e: Any, next: Any) => next(e));
  // Optional extra: may be skipped for user-tier plugins (cc-plugin-sec-default); nothing essential depends on it.
  on('classic.SessionStart', ($: Any, e: Any, next: Any) => { classicInfo(st, e); return next(e); }).catch(($: Any, e: Any, next: Any) => next(e));
  on('classic.UserPromptSubmit', ($: Any, e: Any, next: Any) => {
    classicInfo(st, e);
    const p = firstSentence(e?.prompt); if (p) st.prompt = p;
    return next(e);
  }).catch(($: Any, e: Any, next: Any) => next(e));
  on('turn.complete', async ($: Any, e: Any, next: Any) => {
    if (e?.agentId === undefined) { await readTitle($, st); setState($, st, e?.reason === 'aborted' ? 'idle' : 'done', null); } else void send($, st, 'subagents');
    return next(e);
  });
  on('session.end', async ($: Any, e: Any, next: Any) => { await send($, st, 'end'); st.ended = true; return next(e); });
};
