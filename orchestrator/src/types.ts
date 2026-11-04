export type AgentState = 'idle' | 'thinking' | 'working' | 'talking' | 'done' | 'error';
export interface AgentView { id: string; role: string; name: string; state: AgentState; desk: { x: number; y: number } }
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
  | { t: 'office.snapshot'; agents: AgentView[] }
);
export interface RoleDef { role: string; name: string; tools: string[]; systemPrompt: string }
export const ASK_PROTOCOL = ' Colleagues: researcher, coder, reviewer. To ask one, write a line `@@ASK <role>: <question>` and end your turn; the reply arrives as your next message.';
export const ROLES: Record<string, RoleDef> = {
  researcher: { role: 'researcher', name: 'Researcher', tools: ['WebSearch', 'WebFetch', 'Read'], systemPrompt: 'You are the Researcher in a virtual office.' + ASK_PROTOCOL },
  coder: { role: 'coder', name: 'Coder', tools: ['Read', 'Edit', 'Write', 'Bash(npm test:*)', 'Bash(git diff:*)'], systemPrompt: 'You are the Coder in a virtual office.' + ASK_PROTOCOL },
  reviewer: { role: 'reviewer', name: 'Reviewer', tools: ['Read', 'Grep', 'Glob'], systemPrompt: 'You are the Reviewer in a virtual office.' + ASK_PROTOCOL },
};
