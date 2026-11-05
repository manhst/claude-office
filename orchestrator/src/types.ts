// Wire schema shared with the web UI (web/src/types.ts re-exports these types).
export type AgentState = 'idle' | 'thinking' | 'working' | 'talking' | 'done' | 'error';
export interface AgentView { id: string; role: string; name: string; state: AgentState; desk: { x: number; y: number } }

/** Agent profile loaded from markdown on this PC. source: A = .claude/agents, B = CLAUDE.md, C = default placeholder. */
export type ProfileSource = 'agents' | 'claude-md' | 'default';
export interface AgentProfile { name: string; description: string; tools: string[]; model?: string; body: string; file?: string; scope?: 'project' | 'user' }

/** Session state as reported by the `office` mod. */
export type SessionState = 'idle' | 'thinking' | 'tool' | 'waiting-permission' | 'done';
export interface SubagentInfo { id?: string; type?: string; description?: string; status: string }
export interface SessionView {
  sid: string; project: string; cwd: string; title?: string; transcript?: string; state: SessionState;
  tool?: { name: string; detail?: string; ts: number }; subagents: SubagentInfo[]; prompt?: string; costUsd?: number;
  startedAt: number; lastSeen: number; source: ProfileSource; profiles: AgentProfile[];
  /** office agent ids (desks) that belong to this session, same order as profiles (may be shorter when desks run out) */
  agentIds: string[];
}

/** IT Ops monitor (Prometheus HTTP API). mode demo = labelled fake alerts, only with --demo and no endpoint. */
export interface ItOpsAlert { name: string; detail?: string; value?: string }
export interface ItOpsStatus { mode: 'prometheus' | 'demo' | 'unconfigured'; state: 'unconfigured' | 'checking' | 'ok' | 'alert' | 'error'; endpoint?: string; query?: string; alerts: ItOpsAlert[]; error?: string; checkedAt?: number }

/** Claude account usage (esp-claude payload). pct = percent used (0-100); resets_at as the engine gives it (ISO string or epoch). */
export interface UsageWindow { pct: number; resets_at: string | number | null }
export interface UsageReading { source: 'claude-code' | 'demo'; ts: number; five_hour: UsageWindow | null; seven_day: UsageWindow | null; context_pct: number | null; cost_usd: number | null }

type Base = { ts: number };
export type OfficeEvent = Base & (
  | { t: 'agent.spawned'; id: string; role: string; name: string; desk: { x: number; y: number }; tools: string[]; sessionId?: string; model?: string }
  | { t: 'agent.state'; id: string; state: AgentState }
  | { t: 'agent.text'; id: string; text: string; partial?: boolean }
  | { t: 'tool.call'; id: string; callId: string; tool: string; inputSummary: string }
  | { t: 'tool.result'; id: string; callId: string; ok: boolean; summary: string }
  | { t: 'agent.message'; from: string; to: string; text: string; kind?: 'ask' | 'reply'; hops?: number; qid?: string }
  | { t: 'office.notice'; level: 'info' | 'warn'; text: string; id?: string }
  | { t: 'agent.done'; id: string; result: string; costUsd?: number; durationMs: number }
  | { t: 'agent.error'; id: string; error: string }
  | { t: 'agent.left'; id: string }
  | { t: 'sessions.update'; sessions: SessionView[] }
  | { t: 'itops.status'; status: ItOpsStatus }
  | { t: 'usage.update'; usage: UsageReading }
  | { t: 'office.snapshot'; agents: AgentView[]; sessions?: SessionView[]; itops?: ItOpsStatus; usage?: UsageReading | null }
);
