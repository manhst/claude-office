import { randomUUID } from 'node:crypto';
import type { AgentDriver, AgentHandle } from './driver.js';
import { StreamParser } from './parser.js';
import { AgentStateMachine } from './state.js';
import { redactText } from './redact.js';
import type { AgentView, OfficeEvent, RoleDef } from './types.js';
interface Agent { view: AgentView; sm: AgentStateMachine; handle?: AgentHandle; quiet?: NodeJS.Timeout; started: number; finished: boolean }
export class Orchestrator {
  private agents = new Map<string, Agent>();
  private listeners: Array<(e: OfficeEvent) => void> = [];
  constructor(private driver: AgentDriver, private opts: { maxAgents?: number; quietMs?: number; timeoutMs?: number; cwd?: string } = {}) {}
  on(fn: (e: OfficeEvent) => void) { this.listeners.push(fn); }
  private emit(e: OfficeEvent) { for (const l of this.listeners) l(e); }
  snapshot(): OfficeEvent { return { t: 'office.snapshot', agents: [...this.agents.values()].map((a) => ({ ...a.view })), ts: Date.now() }; }
  spawn(task: string, role: RoleDef): Promise<'done' | 'error'> {
    if (this.agents.size >= (this.opts.maxAgents ?? 6)) throw new Error('agent pool full');
    const id = `${role.role}-${randomUUID().slice(0, 8)}`;
    const n = this.agents.size;
    const view: AgentView = { id, role: role.role, name: role.name, state: 'idle', desk: { x: n % 3, y: Math.floor(n / 3) } };
    const a: Agent = { view, started: Date.now(), finished: false, sm: new AgentStateMachine((s) => { view.state = s; this.emit({ t: 'agent.state', id, state: s, ts: Date.now() }); }) };
    this.agents.set(id, a);
    const parser = new StreamParser(id);
    let spawnedSent = false;
    const sendSpawned = (extra: { sessionId?: string; model?: string } = {}) => {
      if (spawnedSent) return; spawnedSent = true;
      this.emit({ t: 'agent.spawned', id, role: role.role, name: role.name, desk: view.desk, tools: role.tools, ...extra, ts: Date.now() });
      a.sm.feed('task');
    };
    return new Promise((resolve) => {
      const finish = (s: 'done' | 'error') => { if (a.finished) return; a.finished = true; clearTimeout(a.quiet); resolve(s); };
      a.handle = this.driver.start({ task, role, cwd: this.opts.cwd ?? process.cwd(), timeoutMs: this.opts.timeoutMs ?? 10 * 60_000 }, {
        onLine: (line) => {
          const p = parser.parseLine(line);
          if (p.init) sendSpawned({ sessionId: p.sessionId, model: p.init.model });
          p.events.forEach((e, i) => {
            sendSpawned();
            const inp = p.inputs[i];
            if (inp === 'result' || inp === 'fail') { a.sm.feed(inp); this.emit(e); finish(inp === 'result' ? 'done' : 'error'); return; }
            a.sm.feed(inp); this.emit(e);
            if (inp === 'text') { clearTimeout(a.quiet); a.quiet = setTimeout(() => a.sm.feed('quiet'), this.opts.quietMs ?? 1500); }
          });
        },
        onExit: (code, stderrTail) => {
          sendSpawned();
          if (!a.finished) {
            const err = code === 0 ? 'process exited without result' : `exit ${code}: ${redactText(stderrTail.trim(), 300)}`;
            a.sm.feed('fail'); this.emit({ t: 'agent.error', id, error: err, ts: Date.now() }); finish('error');
          }
        },
      });
    });
  }
  cancelAll() { for (const a of this.agents.values()) a.handle?.cancel(); }
}
