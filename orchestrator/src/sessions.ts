import { basename } from 'node:path';
import { redactText } from './redact.js';
import { loadProfiles } from './profiles.js';
import type { AgentProfile, AgentState, AgentView, OfficeEvent, ProfileSource, SessionState, SessionView, SubagentInfo, TurnStatus, TurnStep, TurnView } from './types.js';

/** One event POSTed by the `office` mod (see mod/office/register.ts). Every field except type+sid is optional and merged. */
export interface ModEvent {
  type: 'start' | 'heartbeat' | 'state' | 'tool' | 'subagents' | 'prompt' | 'end' | 'turn';
  sid: string; project?: string; cwd?: string; root?: string; title?: string; transcript?: string;
  state?: SessionState; tool?: { name?: string; detail?: string } | null; subagents?: SubagentInfo[]; prompt?: string; costUsd?: number;
  turn?: ModTurn;
}
/** A `turn` event's turn: phase start (also live progress) or end of a main-loop turn or a subagent run (agentId). */
export interface ModTurn { id: string; phase: 'start' | 'end'; agentId?: string; agentType?: string; prompt?: string; steps?: TurnStep[]; answer?: string; reason?: Exclude<TurnStatus, 'running'>; durationMs?: number }
const TYPES = new Set(['start', 'heartbeat', 'state', 'tool', 'subagents', 'prompt', 'end', 'turn']);
const STATES = new Set(['idle', 'thinking', 'tool', 'waiting-permission', 'done']);
const REASONS = new Set(['answer', 'aborted', 'refusal', 'error']);
/** Turn caps (the mod caps the same; these hold for any local poster). */
export const TURN_LIMITS = { prompt: 4000, text: 4000, answer: 12_000, steps: 60 };
const str = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? redactText(v.trim().replace(/\s+/g, ' '), n) : undefined);
/** Like str but keeps newlines and indentation (prompt, assistant text): only control chars go, CRLF → LF, blank edges trimmed. */
const multi = (v: unknown, n: number) => { if (typeof v !== 'string') return undefined; const t = v.replace(/\r\n?/g, '\n').replace(/[\0-\x08\x0B-\x1F\x7F]/g, '').replace(/^\s*\n/, '').trimEnd(); return t.trim() ? redactText(t, n) : undefined; };
const ident = (v: unknown) => (typeof v === 'string' ? v.replace(/[^\w-]/g, '').slice(0, 64) : '');
function parseTurn(t: any): ModTurn | null {
  if (!t || typeof t !== 'object' || (t.phase !== 'start' && t.phase !== 'end')) return null;
  const id = ident(t.id); if (!id) return null;
  const r: ModTurn = { id, phase: t.phase };
  const agentId = ident(t.agentId); if (agentId) r.agentId = agentId;
  const agentType = str(t.agentType, 60); if (agentType) r.agentType = agentType;
  const prompt = multi(t.prompt, TURN_LIMITS.prompt); if (prompt) r.prompt = prompt;
  const answer = multi(t.answer, TURN_LIMITS.answer); if (answer) r.answer = answer;
  if (REASONS.has(t.reason)) r.reason = t.reason;
  if (typeof t.durationMs === 'number' && Number.isFinite(t.durationMs) && t.durationMs >= 0) r.durationMs = Math.round(t.durationMs);
  if (Array.isArray(t.steps)) r.steps = t.steps.slice(-TURN_LIMITS.steps).flatMap((x: any): TurnStep[] => {
    if (x?.kind === 'text') { const text = multi(x.text, TURN_LIMITS.text); return text ? [{ kind: 'text', text }] : []; }
    if (x?.kind !== 'tool') return [];
    const st: TurnStep = { kind: 'tool', name: str(x.name, 40) ?? 'tool' }; const detail = str(x.detail, 120); if (detail) st.detail = detail; if (x.isError === true) st.isError = true;
    return [st];
  });
  return r;
}
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
    id: str(s.id ?? s.agentId, 64), name: str(s.name, 60), type: str(s.type ?? s.agentType, 60),
    description: str(s.description, 120), status: str(s.status, 20) ?? 'running' }));
  if (typeof p.costUsd === 'number' && Number.isFinite(p.costUsd)) e.costUsd = p.costUsd;
  if (p.type === 'turn') { const t = parseTurn(p.turn); if (!t) return null; e.turn = t; }
  return e;
}

const ACTIVE_SUB = new Set(['running', 'pending', 'waiting']);
const MAIN_STATE: Record<SessionState, AgentState> = { idle: 'idle', thinking: 'thinking', tool: 'working', 'waiting-permission': 'talking', done: 'done' };
const norm = (v?: string) => (v ?? '').trim().toLowerCase();
const copyTurn = (t: TurnView): TurnView => ({ ...t, steps: t.steps.map((x) => ({ ...x })) });
interface Desk { id: string; sid: string; profile: AgentProfile; view: AgentView; text?: string; callId?: string; toolKey?: string }
export interface TrackerOpts { staleMs?: number; desks?: number; cols?: number; perSession?: number; userAgentsDir?: string; now?: () => number; turns?: number;
  load?: (root: string, userDir?: string) => { source: ProfileSource; profiles: AgentProfile[] } }

/** Keeps the list of active Claude Code sessions and projects their activity onto office desks (agents). */
export class SessionTracker {
  private sessions = new Map<string, SessionView>();
  private desks = new Map<string, Desk>();
  private listeners: Array<(e: OfficeEvent) => void> = [];
  /** Recent turns across sessions, oldest first; kept after their session leaves. */
  private turns: TurnView[] = [];
  private calls = 0;
  constructor(private o: TrackerOpts = {}) {}
  private now() { return (this.o.now ?? Date.now)(); }
  on(fn: (e: OfficeEvent) => void) { this.listeners.push(fn); }
  private emit(e: OfficeEvent) { for (const l of this.listeners) l(e); }
  list(): SessionView[] { return [...this.sessions.values()].map((s) => ({ ...s, subagents: [...s.subagents], agentIds: [...s.agentIds] })); }
  snapshot(): OfficeEvent { return { t: 'office.snapshot', agents: [...this.desks.values()].map((d) => ({ ...d.view, desk: { ...d.view.desk } })), sessions: this.list(), turns: this.turns.map(copyTurn), ts: this.now() }; }

  ingest(raw: unknown): boolean {
    const e = parseModEvent(raw); if (!e) return false;
    const ts = this.now();
    if (e.type === 'end') { this.drop(e.sid); return true; }
    if (e.turn) { this.turn(e.sid, e.turn, ts); return true; }
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

  /** Upsert a turn by sid+turnId+agentId (end keeps the start's prompt/startedAt) and emit the merged view; ring of the last `turns` (40). */
  private turn(sid: string, m: ModTurn, ts: number) {
    const s = this.sessions.get(sid); if (s) s.lastSeen = ts;
    let t = this.turns.find((x) => x.sid === sid && x.turnId === m.id && (x.agentRunId ?? '') === (m.agentId ?? ''));
    if (!t) {
      if (!m.agentId) this.abort((x) => x.sid === sid && !x.agentRunId, ts); // a new main turn: the previous one is not running any more
      t = { sid, turnId: m.id, project: s?.project ?? sid, steps: [], status: 'running', startedAt: m.phase === 'end' && m.durationMs ? ts - m.durationMs : ts };
      if (m.agentId) t.agentRunId = m.agentId;
      this.turns.push(t);
      while (this.turns.length > (this.o.turns ?? 40)) { const i = this.turns.findIndex((x) => x.status !== 'running'); this.turns.splice(i < 0 ? 0 : i, 1); } // oldest ended first
    }
    if (m.phase === 'start' && t.status !== 'running') return; // late progress after the end
    if (m.agentType) t.who = m.agentType; if (m.prompt && !t.prompt) t.prompt = m.prompt; if (s) t.project = s.project;
    if (m.steps?.length) t.steps = m.steps;
    if (!t.deskId && s) t.deskId = m.agentId ? (t.who ? s.agentIds.find((id) => norm(this.desks.get(id)?.profile.name) === norm(t!.who)) : undefined) : s.agentIds[0];
    if (m.phase === 'end') { t.status = m.reason ?? 'answer'; t.endedAt = ts; if (m.answer) t.answer = m.answer; if (m.durationMs != null) t.durationMs = m.durationMs; }
    this.emit({ t: 'session.turn', turn: copyTurn(t), ts });
  }
  /** Mark matching running turns aborted (session gone, or superseded) and emit each. */
  private abort(pick: (t: TurnView) => boolean, ts: number) {
    for (const t of this.turns) if (t.status === 'running' && pick(t)) { t.status = 'aborted'; t.endedAt = ts; this.emit({ t: 'session.turn', turn: copyTurn(t), ts }); }
  }
  private create(e: ModEvent, ts: number): SessionView {
    const root = e.root || e.cwd || '';
    const { source, profiles } = (this.o.load ?? loadProfiles)(root, this.o.userAgentsDir);
    const s: SessionView = { sid: e.sid, project: e.project || basename(root) || e.sid, cwd: e.cwd || root, state: 'idle', subagents: [],
      startedAt: ts, lastSeen: ts, source, profiles, agentIds: [] };
    this.sessions.set(e.sid, s);
    const total = this.o.desks ?? 6, cols = this.o.cols ?? 3;
    for (const p of profiles.slice(0, this.o.perSession ?? 6)) {
      const used = new Set([...this.desks.values()].map((d) => d.view.desk.y * cols + d.view.desk.x));
      let slot = 0; while (used.has(slot)) slot++;
      if (slot >= total) { this.emit({ t: 'office.notice', level: 'warn', text: `No free desk for ${p.name} (${s.project})`, ts }); break; }
      const id = `${e.sid}-${p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${s.agentIds.length}`;
      const desk = { x: slot % cols, y: Math.floor(slot / cols) };
      const d: Desk = { id, sid: e.sid, profile: p, view: { id, role: p.name, name: p.name, state: 'idle', desk } };
      this.desks.set(id, d); s.agentIds.push(id);
      this.emit({ t: 'agent.spawned', id, role: p.name, name: p.name, desk, tools: p.tools, sessionId: e.sid, model: p.model, ts });
    }
    this.emit({ t: 'office.notice', level: 'info', text: `Session joined: ${s.project}`, ts });
    return s;
  }
  private drop(sid: string) {
    const ts = this.now();
    this.abort((t) => t.sid === sid, ts); // a killed terminal never sends turn.complete
    const s = this.sessions.get(sid); if (!s) return;
    for (const id of s.agentIds) { this.desks.delete(id); this.emit({ t: 'agent.left', id, ts }); }
    this.sessions.delete(sid);
    this.emit({ t: 'office.notice', level: 'info', text: `Session left: ${s.project}`, ts });
    this.emit({ t: 'sessions.update', sessions: this.list(), ts });
  }
  /** Push live session activity onto desks: busy subagents claim distinct desks (name match, else free); main turn on lead / first free. */
  private project(s: SessionView, ts: number) {
    const desks = s.agentIds.map((id) => this.desks.get(id)!).filter(Boolean);
    if (!desks.length) return;
    const want = new Map<Desk, { state: AgentState; text?: string; tool?: { name: string; detail?: string } }>();
    const lead = desks[0];
    const busy = s.subagents.filter((x) => ACTIVE_SUB.has(x.status));
    const claimed = new Set<Desk>();
    const placed = new Set<number>();
    const leftover: string[] = [];
    const matches = (d: Desk, sub: SubagentInfo) => {
      const pname = norm(d.profile.name);
      if (!pname) return false;
      if (norm(sub.type) === pname || norm(sub.name) === pname) return true;
      const desc = norm(sub.description);
      return !!desc && (desc === pname || desc.includes(pname) || pname.includes(desc));
    };
    const assign = (d: Desk, sub: SubagentInfo) => {
      claimed.add(d);
      want.set(d, {
        state: 'working',
        text: sub.description,
        tool: { name: sub.type ?? sub.name ?? 'Task', detail: sub.description },
      });
    };
    busy.forEach((sub, i) => {
      const d = desks.find((x) => !claimed.has(x) && matches(x, sub));
      if (!d) return;
      assign(d, sub);
      placed.add(i);
    });
    busy.forEach((sub, i) => {
      if (placed.has(i)) return;
      // Next free desk in profile order (stable); leftover text only when none remain.
      const free = desks.find((x) => !claimed.has(x));
      if (!free) {
        leftover.push(`${sub.type ?? sub.name ?? 'subagent'}: ${sub.description ?? sub.status}`);
        return;
      }
      assign(free, sub);
      placed.add(i);
    });
    // Main turn stays on the lead desk when free; if a subagent already claimed it, only fold tool/permission text in.
    // Busy sub desks alone keep the office looking active when state is done (esp pendingDone) — do not park "working" on a random idle desk.
    let mainState = MAIN_STATE[s.state];
    if (busy.length > 0 && s.state === 'done') mainState = 'working';
    const mainWant = {
      state: mainState,
      text: s.state === 'waiting-permission' ? `Waiting for permission${s.tool ? `: ${s.tool.name}` : ''}` : undefined,
      tool: s.state === 'tool' ? s.tool : undefined,
    };
    if (!claimed.has(lead)) want.set(lead, mainWant);
    else if (s.state === 'tool' || s.state === 'waiting-permission') {
      const cur = want.get(lead)!;
      if (mainWant.tool) cur.tool = mainWant.tool;
      if (mainWant.text) cur.text = [cur.text, mainWant.text].filter(Boolean).join(' · ');
    }
    if (leftover.length) {
      const m = want.get(lead) ?? { state: 'working' as AgentState };
      if (m.state === 'idle' || m.state === 'done') m.state = 'working';
      m.text = [m.text, `Subagents: ${leftover.join('; ')}`].filter(Boolean).join(' · ');
      want.set(lead, m);
    }
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
