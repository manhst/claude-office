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

export const register: Register = (on: Any, options: Any) => {
  const endpoint = String(options?.endpoint || DEFAULT_ENDPOINT);
  const loopback = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\//.test(endpoint); // by design: never post off this PC
  let $s: Any; // latest engine interface, used by the heartbeat
  let quiet = false, ended = false, sid = '', cwd = '', root = '', transcript = '', title: string | undefined, sessionTitle: string | undefined;
  let state = 'idle', tool: { name: string; detail?: string } | null = null, prompt: string | undefined;

  const subagents = async () => {
    try { return ((await $s.agent.list()) ?? []).map((a: Any) => ({ type: a.type, description: a.description, status: a.status })); } catch { return []; }
  };
  const readTitle = async () => {
    if (sessionTitle) { title = sessionTitle; return; } // classic events give it directly
    try { if (transcript && (await $s.fs.exists(transcript))) title = titleFromJsonl(await $s.fs.read(transcript)) ?? title; } catch { /* no transcript yet */ }
  };
  let queue: Promise<void> = Promise.resolve(); // posts go out one at a time, in event order
  const send = (type: string): Promise<void> => {
    if (quiet || !loopback || !$s || !sid || (ended && type !== 'end')) return queue;
    const body: Any = { type, sid, state, tool, prompt }; // snapshot now, so later events don't change this one
    return (queue = queue.then(() => post(type, body)).catch(() => {}));
  };
  const post = async (type: string, body: Any) => {
    body.subagents = await subagents();
    body.costUsd = (await $s.session.usage().catch(() => null))?.cost?.usd;
    if (type === 'start' || type === 'heartbeat') Object.assign(body, { project: base(root) ?? base(cwd), cwd, root, title, transcript });
    try { await $s.http.fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); } catch { /* office not running */ }
  };
  const set = (s: string, t: typeof tool, type = t ? 'tool' : 'state') => { state = s; tool = t; void send(type); };

  on('session.start', async ($: Any, e: Any, next: Any) => {
    try {
      $s = $;
      quiet = ((await $.env.get('CLAUDE_CODE_ENTRYPOINT')) ?? '') === 'sdk-cli'; // headless claude -p
      if (!quiet) {
        sid = String(await $.session.id());
        cwd = String(e?.cwd ?? '');
        root = (await $.session.repo().catch(() => null))?.root ?? cwd;
        const home = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME')) || '';
        const config = (await $.env.get('CLAUDE_CONFIG_DIR')) || (home ? `${home}/.claude` : '');
        transcript = config && cwd ? transcriptPath(config, cwd, sid) : '';
        await readTitle(); void send('start');
        $.clock.every(HEARTBEAT_MS, async () => { await readTitle(); await send('heartbeat'); });
      }
    } catch { /* never break the session */ }
    return next(e);
  });
  on('turn.start', ($: Any, e: Any, next: Any) => { $s = $; if (e?.agentId === undefined) set('thinking', null); else void send('subagents'); return next(e); });
  on('tool.call', async ($: Any, e: Any, next: Any) => {
    if (next?.origin?.plugin === 'engine') {
      $s = $;
      const name = String(e?.tool ?? 'tool'), t = { name, detail: toolDetail(name, e as Record<string, unknown>) };
      if (e?.agentId === undefined) set('tool', t); else void send('subagents'); // subagent calls: refresh the subagent list only
    }
    return await next(e);
  }).catch(($: Any, e: Any, next: Any) => next(e));
  on('classic.PermissionRequest', async ($: Any, e: Any, next: Any) => {
    $s = $; const name = String(e?.tool_name ?? 'tool');
    set('waiting-permission', { name, detail: toolDetail(name, e?.tool_input) }, 'state');
    return next(e);
  }).catch(($: Any, e: Any, next: Any) => next(e));
  on('classic.SessionStart', ($: Any, e: Any, next: Any) => {
    if (typeof e?.session_title === 'string' && e.session_title) sessionTitle = title = e.session_title;
    if (typeof e?.transcript_path === 'string' && e.transcript_path) transcript = e.transcript_path;
    return next(e);
  }).catch(($: Any, e: Any, next: Any) => next(e));
  on('classic.UserPromptSubmit', ($: Any, e: Any, next: Any) => {
    if (typeof e?.session_title === 'string' && e.session_title) sessionTitle = title = e.session_title;
    if (typeof e?.transcript_path === 'string' && e.transcript_path) transcript = e.transcript_path;
    const p = firstSentence(e?.prompt); if (p) prompt = p;
    return next(e);
  }).catch(($: Any, e: Any, next: Any) => next(e));
  on('turn.complete', async ($: Any, e: Any, next: Any) => {
    $s = $;
    if (e?.agentId === undefined) { await readTitle(); set(e?.reason === 'aborted' ? 'idle' : 'done', null); } else void send('subagents');
    return next(e);
  });
  on('session.end', async ($: Any, e: Any, next: Any) => { $s = $; await send('end'); ended = true; return next(e); });
};

