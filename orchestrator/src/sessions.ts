import { basename } from 'node:path';
import { redactText } from './redact.js';
import { loadProfiles } from './profiles.js';
import type { AgentProfile, AgentState, AgentView, OfficeEvent, ProfileSource, SessionState, SessionView, SubagentInfo } from './types.js';

/** One event POSTed by the `office` mod (see mod/office/register.ts). Every field except type+sid is optional and merged. */
export interface ModEvent {
  type: 'start' | 'heartbeat' | 'state' | 'tool' | 'subagents' | 'prompt' | 'end';
  sid: string; project?: string; cwd?: string; root?: string; title?: string; transcript?: string;
  state?: SessionState; tool?: { name?: string; detail?: string } | null; subagents?: SubagentInfo[]; prompt?: string; costUsd?: number;
}
const TYPES = new Set(['start', 'heartbeat', 'state', 'tool', 'subagents', 'prompt', 'end']);
const STATES = new Set(['idle', 'thinking', 'tool', 'waiting-permission', 'done']);
const str = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? redactText(v.trim().replace(/\s+/g, ' '), n) : undefined);
/** Validate + sanitize an untrusted payload. Returns null when it is not a mod event. */
export function parseModEvent(p: any): ModEvent | null {
  if (!p || typeof p !== 'object' || !TYPES.has(p.type)) return null;
  const sid = typeof p.sid === 'string' ? p.sid.replace(/[^\w-]/g, '').slice(0, 64) : '';
  if (!sid) return null;
  const e: ModEvent = { type: p.type, sid };
  for (const k of ['project', 'title', 'prompt'] as const) { const v = str(p[k], k === 'prompt' ? 160 : 120); if (v) e[k] = v; }
  for (const k of ['cwd', 'root', 'transcript'] as const) if (typeof p[k] === 'string' && p[k].length < 1024 && !p[k].includes('\0')) e[k] = p[k];
  if (STATES.has(p.state)) e.state = p.state;
  if (p.tool === null) e.tool = null;
  else if (p.tool && typeof p.tool === 'object') e.tool = { name: str(p.tool.name, 40) ?? 'tool', detail: str(p.tool.detail, 120) };
  if (Array.isArray(p.subagents)) e.subagents = p.subagents.slice(0, 20).filter((s: any) => s && typeof s === 'object').map((s: any) => ({
    id: str(s.id, 64), type: str(s.type, 60), description: str(s.description, 120), status: str(s.status, 20) ?? 'running' }));
  if (typeof p.costUsd === 'number' && Number.isFinite(p.costUsd)) e.costUsd = p.costUsd;
  return e;
}

const ACTIVE_SUB = new Set(['running', 'pending', 'waiting']);
const MAIN_STATE: Record<SessionState, AgentState> = { idle: 'idle', thinking: 'thinking', tool: 'working', 'waiting-permission': 'talking', done: 'done' };
interface Desk { id: string; sid: string; profile: AgentProfile; view: AgentView; text?: string; callId?: string; toolKey?: string }
export interface TrackerOpts { staleMs?: number; desks?: number; cols?: number; perSession?: number; userAgentsDir?: string; now?: () => number;
  load?: (root: string, userDir?: string) => { source: ProfileSource; profiles: AgentProfile[] } }

/** Keeps the list of active Claude Code sessions and projects their activity onto office desks (agents). */
export class SessionTracker {
  private sessions = new Map<string, SessionView>();
  private desks = new Map<string, Desk>();
  private listeners: Array<(e: OfficeEvent) => void> = [];
  private calls = 0;
  constructor(private o: TrackerOpts = {}) {}
  private now() { return (this.o.now ?? Date.now)(); }
  on(fn: (e: OfficeEvent) => void) { this.listeners.push(fn); }
  private emit(e: OfficeEvent) { for (const l of this.listeners) l(e); }
  list(): SessionView[] { return [...this.sessions.values()].map((s) => ({ ...s, subagents: [...s.subagents], agentIds: [...s.agentIds] })); }
  snapshot(): OfficeEvent { return { t: 'office.snapshot', agents: [...this.desks.values()].map((d) => ({ ...d.view, desk: { ...d.view.desk } })), sessions: this.list(), ts: this.now() }; }

  ingest(raw: unknown): boolean {
    const e = parseModEvent(raw); if (!e) return false;
    const ts = this.now();
    if (e.type === 'end') { this.drop(e.sid); return true; }
    let s = this.sessions.get(e.sid);
    if (!s) s = this.create(e, ts);
    if (e.project) s.project = e.project; if (e.title) s.title = e.title; if (e.transcript) s.transcript = e.transcript;
    if (e.prompt) s.prompt = e.prompt; if (e.costUsd != null) s.costUsd = e.costUsd;
    if (e.subagents) s.subagents = e.subagents;
    if (e.tool === null) s.tool = undefined; else if (e.tool) s.tool = { name: e.tool.name!, detail: e.tool.detail, ts };
    if (e.state) { s.state = e.state; if (e.state !== 'tool' && e.state !== 'waiting-permission') s.tool = undefined; }
    s.lastSeen = ts;
    this.project(s, ts);
    this.emit({ t: 'sessions.update', sessions: this.list(), ts });
    return true;
  }
  /** Drop sessions without a heartbeat for staleMs (default 60s). */
  sweep() {
    const cut = this.now() - (this.o.staleMs ?? 60_000);
    for (const s of [...this.sessions.values()]) if (s.lastSeen < cut) this.drop(s.sid);
  }

  private create(e: ModEvent, ts: number): SessionView {
    const root = e.root || e.cwd || '';
    const { source, profiles } = (this.o.load ?? loadProfiles)(root, this.o.userAgentsDir);
    const s: SessionView = { sid: e.sid, project: e.project || basename(root) || e.sid.slice(0, 8), cwd: e.cwd || root, state: 'idle', subagents: [],
      startedAt: ts, lastSeen: ts, source, profiles, agentIds: [] };
    this.sessions.set(e.sid, s);
    const total = this.o.desks ?? 6, cols = this.o.cols ?? 3;
    for (const p of profiles.slice(0, this.o.perSession ?? 3)) {
      const used = new Set([...this.desks.values()].map((d) => d.view.desk.y * cols + d.view.desk.x));
      let slot = 0; while (used.has(slot)) slot++;
      if (slot >= total) { this.emit({ t: 'office.notice', level: 'warn', text: `No free desk for ${p.name} (${s.project})`, ts }); break; }
      const id = `${e.sid.slice(0, 8)}-${p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${s.agentIds.length}`;
      const desk = { x: slot % cols, y: Math.floor(slot / cols) };
      const d: Desk = { id, sid: e.sid, profile: p, view: { id, role: p.name, name: p.name, state: 'idle', desk } };
      this.desks.set(id, d); s.agentIds.push(id);
      this.emit({ t: 'agent.spawned', id, role: p.name, name: p.name, desk, tools: p.tools, sessionId: e.sid, model: p.model, ts });
    }
    this.emit({ t: 'office.notice', level: 'info', text: `Session joined: ${s.project}`, ts });
    return s;
  }
  private drop(sid: string) {
    const s = this.sessions.get(sid); if (!s) return;
    const ts = this.now();
    for (const id of s.agentIds) { this.desks.delete(id); this.emit({ t: 'agent.left', id, ts }); }
    this.sessions.delete(sid);
    this.emit({ t: 'office.notice', level: 'info', text: `Session left: ${s.project}`, ts });
    this.emit({ t: 'sessions.update', sessions: this.list(), ts });
  }
  /** Push live session activity onto its desks: main activity → first agent; running subagents → agent named like the subagent type, else first agent. */
  private project(s: SessionView, ts: number) {
    const desks = s.agentIds.map((id) => this.desks.get(id)!).filter(Boolean);
    if (!desks.length) return;
    const want = new Map<Desk, { state: AgentState; text?: string; tool?: { name: string; detail?: string } }>();
    const main = desks[0];
    want.set(main, { state: MAIN_STATE[s.state], text: s.state === 'waiting-permission' ? `Waiting for permission${s.tool ? `: ${s.tool.name}` : ''}` : undefined, tool: s.state === 'tool' ? s.tool : undefined });
    const extra: string[] = [];
    for (const sub of s.subagents.filter((x) => ACTIVE_SUB.has(x.status))) {
      const t = (sub.type ?? '').toLowerCase();
      const d = desks.find((x) => x.profile.name.toLowerCase() === t);
      if (d === main) extra.push(sub.description ?? sub.status);
      else if (d) want.set(d, { state: 'working', text: sub.description, tool: { name: sub.type ?? 'Task', detail: sub.description } });
      else extra.push(`${sub.type ?? 'subagent'}: ${sub.description ?? sub.status}`);
    }
    if (extra.length) { const m = want.get(main)!; if (m.state === 'idle' || m.state === 'done') m.state = 'working'; m.text = [m.text, `Subagents: ${extra.join('; ')}`].filter(Boolean).join(' · '); }
    for (const d of desks) {
      const w = want.get(d) ?? { state: 'idle' as AgentState };
      const key = w.tool ? `${w.tool.name}|${w.tool.detail ?? ''}` : undefined;
      if (d.callId && d.toolKey !== key) { this.emit({ t: 'tool.result', id: d.id, callId: d.callId, ok: true, summary: '', ts }); d.callId = undefined; d.toolKey = undefined; }
      if (key && d.toolKey !== key) { d.callId = `c${++this.calls}`; d.toolKey = key; this.emit({ t: 'tool.call', id: d.id, callId: d.callId, tool: w.tool!.name, inputSummary: w.tool!.detail ?? '', ts }); }
      if (w.text && w.text !== d.text) this.emit({ t: 'agent.text', id: d.id, text: w.text, ts });
      d.text = w.text;
      if (w.state !== d.view.state) {
        d.view.state = w.state;
        if (w.state === 'done') this.emit({ t: 'agent.done', id: d.id, result: s.title ?? s.prompt ?? 'Turn finished', costUsd: s.costUsd, durationMs: 0, ts });
        else this.emit({ t: 'agent.state', id: d.id, state: w.state, ts });
      }
    }
  }
}
