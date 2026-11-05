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
/** Account-wide usage reading, built exactly like esp-claude's payload.ts. null when the engine has no limit reading yet. */
export function usagePayload(rateLimits: Any, context: Any, cost: Any, ts: number) {
  const rl: Any[] = Array.isArray(rateLimits) ? rateLimits : [];
  const pick = (limits: Any[], kind: string) => { const w = limits.find((l: Any) => l?.kind === kind); return w ? { pct: w.percentUsed, resets_at: w.resetsAt ?? null } : null; };
  const payload = { source: 'claude-code', ts, five_hour: pick(rl, 'five_hour'), seven_day: pick(rl, 'seven_day'), context_pct: context?.percent ?? null, cost_usd: cost ? Math.round(cost.usd * 100) / 100 : null };
  const hasReading = payload.five_hour !== null || payload.seven_day !== null;
  return hasReading ? payload : null;
}
type Step = { kind: 'text'; text: string } | { kind: 'tool'; name: string; detail?: string; isError?: boolean };
/** Turn post caps in UTF-16 chars (the server takes bodies up to 64 * 1024 chars); `msgs` = most messages $.session.messages() returns. */
export const TURN_CAP = { prompt: 4000, text: 4000, answer: 12_000, steps: 60, body: 56_000, msgs: 4096 };
const clip = (s: unknown, n: number) => (typeof s === 'string' && s.trim() ? (s.length > n ? `${s.slice(0, n)}…` : s) : undefined);
const isPrompt = (m: Any) => m?.role === 'user' && typeof m.text === 'string' && !!m.text.trim() && !(Array.isArray(m.toolResults) && m.toolResults.length);
/** The current turn's CLI lines: messages from `base` (the count at turn.start), else after the last typed prompt; assistant text and tool summaries (toolDetail) only, never tool inputs or results. A last text equal to `answer` is left to the answer. */
export function turnSteps(msgs: unknown, answer?: unknown, base?: number): Step[] {
  if (!Array.isArray(msgs)) return [];
  let i = msgs.length - 1; while (i >= 0 && !isPrompt(msgs[i])) i--;
  const from = typeof base === 'number' && base >= 0 && base <= msgs.length && msgs.length < TURN_CAP.msgs ? base : i + 1; // shrunk (compacted) or capped list: scan
  const out: Array<Step & { raw?: string }> = [];
  for (const m of msgs.slice(from)) {
    if (m?.role !== 'assistant') continue;
    if (typeof m.text === 'string' && m.text.trim()) out.push({ kind: 'text', text: clip(m.text, TURN_CAP.text)!, raw: m.text });
    for (const u of Array.isArray(m.toolUses) ? m.toolUses : []) { const name = String(u?.tool ?? 'tool'); out.push({ kind: 'tool', name, detail: toolDetail(name, u?.input), ...(u?.isError ? { isError: true } : {}) }); }
  }
  const last = out.at(-1);
  if (last?.kind === 'text' && typeof answer === 'string' && last.raw!.trim() === answer.trim()) out.pop();
  return out.slice(-TURN_CAP.steps).map(({ raw, ...st }) => st as Step);
}
/** JSON body of a `turn` post, capped: prompt/text/answer lengths, the last 60 steps, then oldest steps (and if need be the answer) dropped until it fits `max` chars. */
export function turnBody(sid: string, turn: Any, max = TURN_CAP.body): string {
  const id64 = (v: unknown) => (v == null ? undefined : String(v).slice(0, 64));
  const t: Any = { ...turn, id: id64(turn?.id), agentId: id64(turn?.agentId), agentType: id64(turn?.agentType), prompt: clip(turn?.prompt, TURN_CAP.prompt), answer: clip(turn?.answer, TURN_CAP.answer),
    reason: typeof turn?.reason === 'string' && turn.reason.length <= 20 ? turn.reason : undefined };
  if (Array.isArray(turn?.steps)) t.steps = turn.steps.slice(-TURN_CAP.steps).map((x: Any) => (x?.kind === 'text' ? { ...x, text: clip(x.text, TURN_CAP.text) ?? '' } : x));
  const body = { type: 'turn', sid, turn: t };
  let n = JSON.stringify(body).length;
  while (n > max && t.steps?.length) n -= JSON.stringify(t.steps.shift()).length + 1;
  n = JSON.stringify(body).length;
  while (n > max && t.answer && t.answer.length > 1) { t.answer = `${t.answer.slice(0, Math.floor((t.answer.length - 1) / 2))}…`; n = JSON.stringify(body).length; } // strictly shorter each pass
  if (n > max) delete t.answer;
  return JSON.stringify(body);
}

// The engine checks this module statically: `$` is never stored, destructured, spread, returned or put in objects.
// It is only a handler parameter, the first parameter/argument of module-level helpers, and spelled `$.noun.verb(...)`.
type State = {
  endpoint: string; loopback: boolean; quiet: boolean; ended: boolean; sid: string; cwd: string; root: string; transcript: string;
  title?: string; sessionTitle?: string; state: string; tool: { name: string; detail?: string } | null; prompt?: string; queue: Promise<void>;
  /** Main turn answered but $.agent.list() still has busy subagents — keep posting working until clear (esp pendingDone). */
  pendingDone: boolean;
  /** Running main-loop turn id ('' when none) and when its last progress post went out. */
  turnId: string; progressAt: number;
  /** Main-loop message count at turn.start (-1 unknown): the turn's steps are the messages from here. */
  msgBase: number;
  /** Local ids for turns the engine gave no turnId: the main loop's in turnId, a subagent's by agentId until its end. */
  localN: number; subTurns: Map<string, string>;
};
const LOCAL = `local-${Date.now().toString(36)}`;
/** e.turnId, else a local id unique to this process. */
const turnIdOf = (st: State, e: Any) => (typeof e?.turnId === 'string' && e.turnId ? e.turnId : `${LOCAL}-${++st.localN}`);
const PROGRESS_MS = 2000;

/** running|pending|waiting = still doing work (same filter as esp-claude). */
const AGENT_BUSY = /^(running|pending|waiting)$/i;
/** Map whatever $.agent.list() returns into a stable desk payload (id/name/type/description/status). */
function mapListedAgent(a: Any) {
  if (!a || typeof a !== 'object') return null;
  const id = a.id ?? a.agentId;
  const type = a.type ?? a.agentType;
  const out: Any = { status: typeof a.status === 'string' && a.status ? a.status : 'running' };
  if (id != null && String(id)) out.id = String(id);
  if (typeof a.name === 'string' && a.name) out.name = a.name;
  if (typeof type === 'string' && type) out.type = type;
  if (typeof a.description === 'string' && a.description) out.description = a.description;
  return out;
}
async function listAgents($: Any) {
  try { return ((await $.agent.list()) ?? []).map(mapListedAgent).filter(Boolean); } catch { return []; }
}
async function busyAgents($: Any) {
  return (await listAgents($)).filter((a: Any) => AGENT_BUSY.test(String(a.status ?? '')));
}
/** Full list (busy + recently finished) so the orchestrator can clear desks that went idle. */
async function subagents($: Any) {
  return listAgents($);
}
function agentsDetail(busy: Any[]) {
  const n = busy.length;
  const head = `${n} agent${n === 1 ? '' : 's'}`;
  const task = busy.map((a: Any) => a.description).find((d: Any) => typeof d === 'string' && d);
  return task ? `${head}: ${String(task).slice(0, 80)}` : head;
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
async function postRaw($: Any, st: State, body: string) {
  try { await $.http.fetch(st.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body }); } catch { /* office not running */ }
}
/** Usage goes on the same ordered queue; only when there is a reading. u = { rateLimits, context, cost } (session.measure event or $.session.usage()). */
function sendUsage($: Any, st: State, u: Any, ts: number): Promise<void> {
  if (st.quiet || !st.loopback || !st.sid || st.ended) return st.queue;
  const usage = usagePayload(u?.rateLimits, u?.context, u?.cost, ts);
  if (!usage) return st.queue;
  const body = JSON.stringify({ type: 'usage', sid: st.sid, usage });
  st.queue = st.queue.then(() => postRaw($, st, body)).catch(() => {});
  return st.queue;
}
/** Turn posts go on the same ordered queue; a subagent's type is looked up there so the hook is not held up. */
function sendTurn($: Any, st: State, turn: Any): Promise<void> {
  if (st.quiet || !st.loopback || !st.sid || st.ended || !turn.id) return st.queue;
  const sid = st.sid;
  st.queue = st.queue.then(async () => { if (turn.agentId && !turn.agentType) turn.agentType = await agentType($, turn.agentId); await postRaw($, st, turnBody(sid, turn)); }).catch(() => {});
  return st.queue;
}
async function agentType($: Any, id: string) { return (await listAgents($)).find((a: Any) => a.id === id)?.type; }
/** Steps of the main turn, or of a subagent's run (none when the engine denies its messages). */
async function readSteps($: Any, st: State, agentId?: string, answer?: string): Promise<Step[]> {
  try { return agentId === undefined ? turnSteps(await $.session.messages(), answer, st.msgBase) : turnSteps(await $.session.messages({ agentId }), answer); } catch { return []; }
}
async function msgCount($: Any) { try { const m = await $.session.messages(); return Array.isArray(m) ? m.length : -1; } catch { return -1; } }
/** Live steps of the running main turn; dropped when that turn ended meanwhile, so an end is never followed by a start. */
async function progress($: Any, st: State, id: string) {
  const steps = await readSteps($, st);
  if (st.turnId === id && steps.length) void sendTurn($, st, { id, phase: 'start', steps });
}
/** A subagent run's end: its id (the start's local one when the engine gave none) and its steps. */
async function subEnd($: Any, st: State, e: Any, end: Any) {
  const agentId = String(e.agentId), id = e?.turnId || st.subTurns.get(agentId) || turnIdOf(st, e); st.subTurns.delete(agentId);
  return { ...end, id, agentId, steps: await readSteps($, st, agentId, end.answer) };
}
async function readUsage($: Any, st: State) { try { await sendUsage($, st, await $.session.usage(), Date.now()); } catch { /* no usage */ } }
function setState($: Any, st: State, s: string, t: State['tool'], type = t ? 'tool' : 'state') { st.state = s; st.tool = t; void send($, st, type); }
async function heartbeat($: Any, st: State) { await follow($, st); await readTitle($, st); await send($, st, 'heartbeat'); await readUsage($, st); }
/** Per-session fields. The module lives as long as the process, which can move to another session (/resume, /clear) after session.end. */
function reset(st: State, sid: string) { Object.assign(st, { sid, ended: false, transcript: '', title: undefined, sessionTitle: undefined, state: 'idle', tool: null, prompt: undefined, pendingDone: false, turnId: '', progressAt: 0, msgBase: -1 }); st.subTurns.clear(); }
/** If the engine now reports another session id, start reporting that session. */
async function follow($: Any, st: State) {
  if (st.quiet || !st.sid) return;
  let id = ''; try { id = String(await $.session.id()); } catch { return; }
  if (id && id !== st.sid) { reset(st, id); await begin($, st); }
}
async function start($: Any, st: State, e: Any) {
  st.quiet = ((await $.env.get('CLAUDE_CODE_ENTRYPOINT')) ?? '') === 'sdk-cli'; // headless claude -p
  if (st.quiet) return;
  const sid = String(await $.session.id());
  if (sid !== st.sid) reset(st, sid); else st.ended = false;
  st.cwd = String(e?.cwd ?? '');
  try { st.root = (await $.session.repo())?.root ?? st.cwd; } catch { st.root = st.cwd; }
  await begin($, st);
}
async function begin($: Any, st: State) {
  const home = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME')) || '';
  const config = (await $.env.get('CLAUDE_CONFIG_DIR')) || (home ? `${home}/.claude` : '');
  if (!st.transcript) st.transcript = config && st.cwd ? transcriptPath(config, st.cwd, st.sid) : '';
  await readTitle($, st); void send($, st, 'start'); await readUsage($, st);
}
function classicInfo(st: State, e: Any) {
  if (typeof e?.session_title === 'string' && e.session_title) st.sessionTitle = st.title = e.session_title;
  if (typeof e?.transcript_path === 'string' && e.transcript_path) st.transcript = e.transcript_path;
}

export const register: Register = (on: Any, options: Any) => {
  const endpoint = String(options?.endpoint || DEFAULT_ENDPOINT);
  const st: State = {
    endpoint, loopback: /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\//.test(endpoint), // by design: never post off this PC
    quiet: false, ended: false, sid: '', cwd: '', root: '', transcript: '', state: 'idle', tool: null, queue: Promise.resolve(), pendingDone: false, turnId: '', progressAt: 0, msgBase: -1, localN: 0, subTurns: new Map(),
  };
  let beating = false;
  on('session.start', async ($: Any, e: Any, next: Any) => {
    try {
      await start($, st, e);
      if (!st.quiet && !beating) { beating = true; $.clock.every(HEARTBEAT_MS, () => void heartbeat($, st)); }
    } catch { /* never break the session */ }
    return next(e);
  });
  on('turn.start', async ($: Any, e: Any, next: Any) => {
    try { await follow($, st); } catch { /* never break the session */ }
    try {
      const text = typeof e?.text === 'string' && e.text.trim() ? e.text : undefined; // '' on a continuation turn
      if (e?.agentId === undefined) {
        st.turnId = turnIdOf(st, e); st.progressAt = 0; st.msgBase = -1;
        const p = firstSentence(text); if (p) st.prompt = p;
        st.pendingDone = false; setState($, st, 'thinking', null);
        void sendTurn($, st, { id: st.turnId, phase: 'start', prompt: text });
        const id = st.turnId, n = await msgCount($); if (st.turnId === id) st.msgBase = n;
      } else {
        void send($, st, 'subagents'); // subagent turn: refresh list so desks light up
        const agentId = String(e.agentId), id = turnIdOf(st, e); if (!e?.turnId) st.subTurns.set(agentId, id);
        void sendTurn($, st, { id, phase: 'start', agentId, prompt: text });
      }
    } catch { /* never break the session */ }
    return next(e);
  });
  on('tool.call', async ($: Any, e: Any, next: Any) => {
    if (next?.origin?.plugin === 'engine') {
      const name = String(e?.tool ?? 'tool');
      if (e?.agentId === undefined) {
        setState($, st, 'tool', { name, detail: toolDetail(name, e) });
        const now = Date.now(); // live steps while the turn runs, at most one read of the messages per PROGRESS_MS
        if (st.turnId && now - st.progressAt >= PROGRESS_MS) { st.progressAt = now; void progress($, st, st.turnId); }
      } else {
        // Subagent tool: refresh full agent list (and keep pendingDone sessions looking busy).
        if (st.pendingDone) {
          try {
            const busy = await busyAgents($);
            st.state = 'tool';
            st.tool = { name: 'Task', detail: agentsDetail(busy) };
          } catch { /* list failed */ }
        }
        void send($, st, 'subagents');
      }
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
    try {
      const end = { phase: 'end', answer: typeof e?.answer === 'string' ? e.answer : undefined, reason: e?.reason, durationMs: e?.durationMs };
      if (e?.agentId === undefined) {
        const id = e?.turnId || st.turnId || turnIdOf(st, e); st.turnId = '';
        void sendTurn($, st, { ...end, id, steps: await readSteps($, st, undefined, end.answer) });
        await readTitle($, st);
        if (e?.reason === 'aborted') { st.pendingDone = false; setState($, st, 'idle', null); }
        else {
          // Main answered: if subagents still busy, stay in tool/busy and keep refreshing (esp pendingDone).
          const busy = await busyAgents($);
          if (busy.length > 0) {
            st.pendingDone = true;
            st.state = 'tool';
            st.tool = { name: 'Task', detail: agentsDetail(busy) };
            void send($, st, 'tool');
          } else {
            st.pendingDone = false;
            setState($, st, 'done', null);
          }
        }
      } else if (st.pendingDone) {
        void sendTurn($, st, await subEnd($, st, e, end));
        const busy = await busyAgents($);
        if (busy.length === 0) { st.pendingDone = false; setState($, st, 'done', null); }
        else {
          st.state = 'tool';
          st.tool = { name: 'Task', detail: agentsDetail(busy) };
          void send($, st, 'subagents');
        }
      } else {
        void sendTurn($, st, await subEnd($, st, e, end));
        void send($, st, 'subagents');
      }
    } catch { /* never break the session */ }
    return next(e);
  });
  // Raised after each turn and whenever a limit moves a whole point (same hook as usage-esp).
  on('session.measure', async ($: Any, e: Any, next: Any) => {
    try { void sendUsage($, st, e, Date.now()); } catch { /* never break the session */ }
    return next(e);
  });
  on('session.end', async ($: Any, e: Any, next: Any) => { st.pendingDone = false; await send($, st, 'end'); st.ended = true; return next(e); });
};
