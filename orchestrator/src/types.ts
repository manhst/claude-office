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

/** Claude config tab (GET /claude-config). Where an MCP server entry lives: user = ~/.claude.json mcpServers; local = ~/.claude.json
 *  projects[path].mcpServers; project = <path>/.mcp.json; settings = ~/.claude/settings.json mcpServers (NOT loaded by Claude Code: read-only, clone it to use it). */
export type McpScope = 'user' | 'local' | 'project' | 'settings';
/** env var / header. value is omitted (masked:true) when key or value looks secret; POST /claude-config/mcp/reveal returns it. */
export interface McpPair { key: string; value?: string; masked?: boolean }
export interface McpServerView {
  name: string; scope: McpScope;
  /** project path for local/project scope */
  project?: string;
  /** file the entry lives in */
  file: string;
  /** type as stored ('' when absent = stdio) */
  type: string; command?: string; args?: string[]; url?: string;
  env: McpPair[]; headers: McpPair[];
  /** other keys of the entry (oauth, timeout…): kept as they are on edit/clone, not editable here */
  extraKeys: string[];
  /** project scope: approval from projects[path].enabledMcpjsonServers / disabledMcpjsonServers */
  approval?: 'enabled' | 'disabled' | 'pending';
  /** a same-named entry in a scope that wins for this project (local > project > user) */
  shadowedBy?: { scope: McpScope; project?: string };
  /** e.g. unknown type, command not found, missing url */
  warnings: string[];
  /** hash of the stored entry; edits/deletes send it back and get 409 if the file changed meanwhile */
  hash: string;
  readOnly: boolean;
}
export interface ClaudeProjectView { path: string; exists: boolean; localServers: number; hasMcpJson: boolean; trusted: boolean; allowedTools: number; lastSessionId?: string; lastCost?: number }
export interface ClaudeConfigView {
  files: { claudeJson: string; settings: string }; readAt: number;
  /** false in --demo or when the claude CLI is missing (then cli.error says why): the UI is read-only */
  writable: boolean; cli: { path?: string; version?: string; error?: string };
  servers: McpServerView[]; projects: ClaudeProjectView[];
}
export interface McpRef { scope: McpScope; project?: string; name: string }
/** keep:true = reuse the stored value of this key from `original` (edit) or `cloneFrom` (clone), so secrets never round-trip through the browser. */
export interface McpPairInput { key: string; value?: string; keep?: boolean }
export interface McpServerInput { type: string; command?: string; args?: string[]; url?: string; env?: McpPairInput[]; headers?: McpPairInput[] }
/** POST /claude-config/mcp/save. original: edit that entry (hash must still match, else 409; target may differ = move/rename).
 *  cloneFrom: new entry copied from another (keep values + extra keys come from it). Neither: new entry (409 if the name exists in the target scope).
 *  target.scope must be user | local | project; local/project need target.project (a known project path). */
export interface McpSaveRequest { target: McpRef; server: McpServerInput; original?: McpRef & { hash: string }; cloneFrom?: McpRef;
  /** project scope writes <project>/.mcp.json (usually committed): kept or secret-looking env/header values there need this, else 400 {error:'confirm-required', reason} */
  confirmProjectSecrets?: boolean }
export interface McpDeleteRequest extends McpRef { hash: string }
export interface McpRevealRequest extends McpRef { field: 'env' | 'headers'; key: string }
export interface McpRevealResponse { value: string }
/** POST /claude-config/mcp/test: a stored entry (ref), or an unsaved draft (server; keep values from `from`; runs in `project` or the home dir). */
export type McpTestRequest = ({ ref: McpRef } | { server: McpServerInput; from?: McpRef; project?: string }) & {
  /** required to start a project-scope (.mcp.json) server that Claude Code hasn't approved or whose project isn't trusted; else 400 {error:'confirm-required', reason} */
  confirm?: boolean };
export interface McpTestResult { ok: boolean; ms: number; server?: { name?: string; version?: string }; tools?: string[]; error?: string; stderr?: string }
/** Error body of the /claude-config routes. confirm-required: resend with the named confirm flag after asking the user (reason says what will happen). */
export interface McpErrorResponse { error: string; reason?: string; backup?: string }
/** Reply of save/delete: the fresh view, plus the backup file written before the change. */
export interface McpWriteResponse { ok: true; view: ClaudeConfigView; backup?: string }

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
