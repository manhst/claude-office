// Wire schema shared with the web UI (web/src/types.ts re-exports these types).
export type AgentState = 'idle' | 'thinking' | 'working' | 'talking' | 'done' | 'error';
export interface AgentView { id: string; role: string; name: string; state: AgentState; desk: { x: number; y: number } }

/** Agent profile loaded from markdown on this PC. source: A = .claude/agents, B = CLAUDE.md, C = default placeholder. */
export type ProfileSource = 'agents' | 'claude-md' | 'default';
export interface AgentProfile { name: string; description: string; tools: string[]; model?: string; body: string; file?: string; scope?: 'project' | 'user' }

/** Session state as reported by the `office` mod. */
export type SessionState = 'idle' | 'thinking' | 'tool' | 'waiting-permission' | 'done';
export interface SubagentInfo { id?: string; name?: string; type?: string; description?: string; status: string }
export interface SessionView {
  sid: string; project: string; cwd: string; title?: string; transcript?: string; state: SessionState;
  tool?: { name: string; detail?: string; ts: number }; subagents: SubagentInfo[]; prompt?: string; costUsd?: number;
  startedAt: number; lastSeen: number; source: ProfileSource; profiles: AgentProfile[];
  /** office agent ids (desks) that belong to this session, same order as profiles (may be shorter when desks run out) */
  agentIds: string[];
  /** Current Claude Code model string from `$.session.model()` when the mod could read one. */
  model?: string;
  /** True when this session's office mod reported `typeof $.prompt.submit === 'function'`. */
  canSubmit?: boolean;
}
/** Composer ack: queued for the live session, not a finished turn. Never carries prompt text. */
export type PromptAckState = 'queued' | 'claimed' | 'delivered' | 'rejected' | 'expired' | 'unsupported' | 'session-ended' | 'dropped';
export interface PromptAck { t: 'prompt.status'; sid: string; nonce: string; state: PromptAckState; reason?: string; ts: number }

/** IT Ops monitor (Prometheus HTTP API). mode demo = labelled fake alerts, only with --demo and no endpoint. */
export interface ItOpsAlert { name: string; detail?: string; value?: string }
export interface ItOpsStatus { mode: 'prometheus' | 'demo' | 'unconfigured'; state: 'unconfigured' | 'checking' | 'ok' | 'alert' | 'error'; endpoint?: string; query?: string; alerts: ItOpsAlert[]; error?: string; checkedAt?: number }

/** Claude account usage (esp-claude payload). pct = percent used (0-100); resets_at as the engine gives it (ISO string or epoch). */
export interface UsageWindow { pct: number; resets_at: string | number | null }
export interface UsageReading { source: 'claude-code' | 'demo'; ts: number; five_hour: UsageWindow | null; seven_day: UsageWindow | null; context_pct: number | null; cost_usd: number | null }

/** One CLI transcript line of a turn: assistant text (newlines kept) or a tool call (summary only, like the mod's tool detail). */
export type TurnStep = { kind: 'text'; text: string } | { kind: 'tool'; name: string; detail?: string; isError?: boolean };
/** How a turn ended; 'running' until its turn.complete arrives. */
export type TurnStatus = 'running' | 'answer' | 'aborted' | 'refusal' | 'error';
/** One prompt → response exchange, as the Claude Code CLI shows it. Main loop: who absent. Subagent run: who = its type, agentRunId = engine agent id. */
export interface TurnView {
  sid: string; turnId: string; project: string; who?: string; agentRunId?: string;
  /** office desk id this turn is shown on (lead desk for the main loop, name-matched desk for a subagent), when one exists */
  deskId?: string;
  prompt?: string; steps: TurnStep[]; answer?: string; status: TurnStatus; startedAt: number; endedAt?: number; durationMs?: number;
}

/** Past Claude Code session from `<claude config>/projects/<dir>/<sid>.jsonl` (History tab, GET /history). Times are epoch ms. */
export interface HistorySession {
  sid: string;
  /** working directory: first `cwd` in the transcript, else decoded from the folder name */
  project: string;
  /** short label: basename of project, '~' for the home dir */
  projectName: string;
  gitBranch?: string;
  /** custom title > AI title > first prompt line */
  title: string;
  firstPrompt?: string;
  startedAt: number; endedAt: number;
  /** real user prompts (no tool results, no meta/hook lines) */
  prompts: number;
  /** user prompts + assistant text blocks */
  messages: number;
  costUsd?: number; model?: string; version?: string;
  /** cli | claude-vscode | claude-desktop | sdk-cli … */
  entrypoint?: string;
  /** automation (entrypoint sdk-cli); hidden unless GET /history?auto=1 */
  auto: boolean;
  /** subagent transcripts under <dir>/<sid>/subagents/ */
  subagents: number;
  bytes: number;
  /** set when the user bookmarked this sid (stored in orchestrator/.run/history-bookmarks.json) */
  bookmark?: HistoryBookmark;
}
/** User bookmark on a past session. note: optional short label (≤200 chars). */
export interface HistoryBookmark { at: number; note?: string }
/** A list row: the session plus, when q is set, a redacted snippet around the first match and the match count. */
export interface HistoryHit extends HistorySession { snippet?: string; hits?: number }
/** Project facet: counts over sessions matching q + auto filter, ignoring the project filter. */
export interface HistoryProject { project: string; projectName: string; sessions: number; lastAt: number }
export interface HistoryListResponse { total: number; offset: number; sessions: HistoryHit[]; projects: HistoryProject[]; autoHidden: number; scannedAt: number;
  /** bookmarked sessions matching q + project (auto ones included), for the "Bookmarked (N)" filter */
  bookmarked: number }
/** One transcript line: a user prompt, an assistant text block, or a tool call summary (never tool inputs/results in full). */
export type HistoryItem = { role: 'user' | 'assistant'; text: string; ts?: number } | { role: 'tool'; name: string; detail?: string; ts?: number };
export interface HistoryDetailResponse { session: HistorySession; items: HistoryItem[]; truncated: boolean }
/** POST /history/bookmark body: on=true adds/updates (note replaces the old one), on=false removes. Reply: HistoryBookmarkResponse. */
export interface HistoryBookmarkRequest { sid: string; on: boolean; note?: string }
export interface HistoryBookmarkResponse { sid: string; bookmark: HistoryBookmark | null }

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
  /** a turn started, gained steps or ended; upsert by sid+turnId+agentRunId; each event is the full merged view */
  | { t: 'session.turn'; turn: TurnView }
  | PromptAck
  | { t: 'office.snapshot'; agents: AgentView[]; sessions?: SessionView[]; itops?: ItOpsStatus; usage?: UsageReading | null; turns?: TurnView[]; prompts?: PromptAck[] }
);
