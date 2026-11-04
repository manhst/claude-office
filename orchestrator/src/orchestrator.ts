import type { AgentDriver, AgentHandle } from './driver.js';
import { StreamParser } from './parser.js';
import { AgentStateMachine } from './state.js';
import { redactText } from './redact.js';
import { Router, extractAsks, stripAsks, type RoutedMessage } from './router.js';
import { mapHook, type HookPayload } from './hooks.js';
import { ROLES, type AgentView, type OfficeEvent, type RoleDef } from './types.js';

interface Turn { prompt: string; chain: string[]; answering?: RoutedMessage }
interface Agent {
  view: AgentView; def: RoleDef; sm: AgentStateMachine; handle?: AgentHandle; quiet?: NodeJS.Timeout;
  sessionId?: string; turns: number; running: boolean; inbox: Turn[]; pending: Map<string, string[]>; // qid → chain to restore on reply
  status?: 'done' | 'error'; external?: boolean; owed: RoutedMessage[]; // questions to answer once own asks resolve
}
export interface OrchestratorOpts { maxAgents?: number; quietMs?: number; timeoutMs?: number; cwd?: string; maxTurnsPerAgent?: number; maxHops?: number; maxMessages?: number }
const DESKS: Record<string, { x: number; y: number }> = { researcher: { x: 0, y: 0 }, coder: { x: 1, y: 0 }, reviewer: { x: 2, y: 0 } };

export class Orchestrator {
  private agents = new Map<string, Agent>();
  private byRole = new Map<string, string>();
  private listeners: Array<(e: OfficeEvent) => void> = [];
  private router: Router;
  private idleWaiters: Array<() => void> = [];
  constructor(private driver: AgentDriver, private opts: OrchestratorOpts = {}, private roles: Record<string, RoleDef> = ROLES) {
    this.router = new Router(new Set(Object.keys(roles)), { maxHops: opts.maxHops ?? 3, maxMessages: opts.maxMessages ?? 20 });
  }
  on(fn: (e: OfficeEvent) => void) { this.listeners.push(fn); }
  private emit(e: OfficeEvent) { for (const l of this.listeners) l(e); }
  snapshot(): OfficeEvent { return { t: 'office.snapshot', agents: [...this.agents.values()].map((a) => ({ ...a.view, desk: { ...a.view.desk } })), ts: Date.now() }; }

  /** Phase-1 API: run a task with one lead agent; resolves when the whole office is quiet. */
  async spawn(task: string, role: RoleDef): Promise<'done' | 'error'> { return this.run(task, role.role); }
  run(task: string, leadRole: string): Promise<'done' | 'error'> {
    const a = this.ensureAgent(leadRole);
    a.inbox.push({ prompt: task, chain: [] });
    const p = new Promise<'done' | 'error'>((r) => this.idleWaiters.push(() => r(a.status ?? 'error')));
    this.pump(a);
    return p;
  }

  private ensureAgent(role: string): Agent {
    const existing = this.byRole.get(role);
    if (existing) return this.agents.get(existing)!;
    if (this.agents.size >= (this.opts.maxAgents ?? 6)) throw new Error('agent pool full');
    const def = this.roles[role];
    const n = this.agents.size;
    const id = `${role}-${Math.random().toString(16).slice(2, 10)}`;
    const view: AgentView = { id, role, name: def.name, state: 'idle', desk: DESKS[role] ?? { x: n % 3, y: 1 + Math.floor(n / 3) } };
    const a: Agent = { view, def, turns: 0, running: false, inbox: [], pending: new Map(), owed: [],
      sm: new AgentStateMachine((s) => { view.state = s; this.emit({ t: 'agent.state', id, state: s, ts: Date.now() }); }) };
    this.agents.set(id, a); this.byRole.set(role, id);
    this.emit({ t: 'agent.spawned', id, role, name: def.name, desk: view.desk, tools: def.tools, ts: Date.now() });
    return a;
  }

  private pump(a: Agent) {
    if (a.running || a.status === 'error' || !a.inbox.length) return;
    if (a.turns >= (this.opts.maxTurnsPerAgent ?? 8)) {
      a.inbox.length = 0; this.emit({ t: 'office.notice', level: 'warn', id: a.view.id, text: `${a.def.name} hit the turn limit`, ts: Date.now() });
      return;
    }
    this.startTurn(a, a.inbox.shift()!);
  }

  private startTurn(a: Agent, turn: Turn) {
    a.running = true; a.turns++; a.status = undefined;
    const id = a.view.id; const parser = new StreamParser(id);
    a.sm.feed(a.turns === 1 ? 'task' : 'resume');
    let ended = false;
    const end = (ok: boolean, resultText: string, ev?: OfficeEvent) => {
      if (ended) return; ended = true; a.running = false; clearTimeout(a.quiet);
      if (turn.answering) a.owed.push(turn.answering);
      if (!ok || a.pending.size === 0) {
        for (const q of a.owed.splice(0)) {
          const reply = this.router.reply(q, ok ? resultText : `[could not answer: ${resultText}]`);
          if (reply) this.deliverReply(reply);
          else this.notify(q.from, 'warn', `message budget exhausted; no reply from ${a.def.name}`);
        }
      }
      if (!ok) { a.status = 'error'; a.sm.feed('fail'); this.emit(ev ?? { t: 'agent.error', id, error: resultText, ts: Date.now() }); }
      else if (a.pending.size > 0) { a.sm.feed('ask'); } // waiting for colleagues: keep talking, no agent.done yet
      else if (a.inbox.length === 0) { a.status = 'done'; a.sm.feed('result'); if (ev) this.emit(ev); }
      else a.status = 'done';
      this.pump(a); this.checkIdle();
    };
    a.handle = this.driver.start({ task: turn.prompt, role: a.def, cwd: this.opts.cwd ?? process.cwd(), timeoutMs: this.opts.timeoutMs ?? 10 * 60_000,
      resumeSessionId: a.sessionId, turn: a.turns }, {
      onLine: (line) => {
        const p = parser.parseLine(line);
        if (p.sessionId) a.sessionId = p.sessionId;
        p.events.forEach((e, i) => {
          const inp = p.inputs[i];
          if (e.t === 'agent.done') return end(true, e.result, e);
          if (e.t === 'agent.error') return end(false, e.error, e);
          if (e.t === 'agent.text') {
            const asks = extractAsks(e.text); const visible = stripAsks(e.text);
            if (visible) { a.sm.feed('text'); this.emit({ ...e, text: visible }); clearTimeout(a.quiet); a.quiet = setTimeout(() => a.running && a.sm.feed('quiet'), this.opts.quietMs ?? 1500); }
            for (const ask of asks) this.routeAsk(a, ask, turn.chain);
            return;
          }
          a.sm.feed(inp as any); this.emit(e);
        });
      },
      onExit: (code, stderrTail) => {
        if (code === 0) end(false, 'process exited without result');
        else end(false, `exit ${code}: ${redactText(stderrTail.trim(), 300)}`);
      },
    });
  }

  private routeAsk(a: Agent, ask: { to: string; text: string }, chain: string[]) {
    const r = this.router.ask(a.def.role, ask, chain);
    if (!r.ok) {
      this.emit({ t: 'office.notice', level: 'warn', id: a.view.id, text: `ASK ${ask.to} rejected: ${r.reason}`, ts: Date.now() });
      // tell the asker so it can continue without waiting
      a.inbox.push({ prompt: `[office] Your question to "${ask.to}" was not delivered (${r.reason}). Continue without it.`, chain });
      return;
    }
    let target: Agent;
    try { target = this.ensureAgent(r.msg.to); } catch (e: any) { this.notify(a.def.role, 'warn', e.message); return; }
    a.pending.set(r.msg.qid, chain); a.sm.feed('ask');
    this.emit({ t: 'agent.message', from: a.view.id, to: target.view.id, text: redactText(r.msg.text, 500), kind: 'ask', hops: r.msg.hops, qid: r.msg.qid, ts: Date.now() });
    target.inbox.push({ prompt: `Question from ${a.def.name}: ${r.msg.text}\nAnswer concisely.`, chain: r.msg.chain, answering: r.msg });
    this.pump(target);
  }

  private deliverReply(reply: RoutedMessage) {
    const from = this.agents.get(this.byRole.get(reply.from)!)!; const to = this.agents.get(this.byRole.get(reply.to)!)!;
    const chain = to.pending.get(reply.qid) ?? [];
    to.pending.delete(reply.qid);
    this.emit({ t: 'agent.message', from: from.view.id, to: to.view.id, text: redactText(reply.text, 500), kind: 'reply', hops: reply.hops, qid: reply.qid, ts: Date.now() });
    to.inbox.push({ prompt: `Reply from ${from.def.name}: ${reply.text}`, chain });
    this.pump(to);
  }

  private notify(role: string, level: 'info' | 'warn', text: string) {
    this.emit({ t: 'office.notice', level, id: this.byRole.get(role), text, ts: Date.now() });
  }

  private checkIdle() {
    const busy = [...this.agents.values()].some((x) => !x.external && (x.running || (x.inbox.length > 0 && x.status !== 'error')));
    if (busy) return;
    for (const x of this.agents.values()) if (!x.external && x.pending.size && x.status !== 'error') { x.pending.clear(); x.status = 'done'; x.sm.feed('result'); }
    const w = this.idleWaiters; this.idleWaiters = []; w.forEach((f) => f());
  }

  /** Claude Code hook payloads (PreToolUse/PostToolUse/Stop/...) for sessions not spawned by us. */
  ingestHook(p: HookPayload) {
    const sid = String(p.session_id ?? 'unknown').replace(/[^\w-]/g, '').slice(0, 64) || 'unknown';
    let a = [...this.agents.values()].find((x) => x.sessionId === sid);
    if (!a) {
      const id = `session-${sid.slice(0, 8)}`;
      a = this.agents.get(id);
      if (!a) {
        const view: AgentView = { id, role: 'session', name: 'Claude session', state: 'idle', desk: { x: this.agents.size % 3, y: 1 } };
        const def: RoleDef = { role: 'session', name: 'Claude session', tools: [], systemPrompt: '' };
        a = { view, def, turns: 1, running: false, inbox: [], pending: new Map(), owed: [], sessionId: sid, external: true,
          sm: new AgentStateMachine((s) => { view.state = s; this.emit({ t: 'agent.state', id, state: s, ts: Date.now() }); }) };
        this.agents.set(id, a);
        this.emit({ t: 'agent.spawned', id, role: 'session', name: def.name, desk: view.desk, tools: [], ts: Date.now() });
        a.sm.feed('task');
      }
    }
    const m = mapHook(p, a.view.id);
    if (m.input) a.sm.feed(m.input);
    if (m.event) this.emit(m.event);
    return !!(m.input || m.event);
  }

  cancelAll() { for (const a of this.agents.values()) a.handle?.cancel(); }
}
