import type { AgentState, OfficeEvent } from './types';
export type ConnStatus = 'no-token' | 'connecting' | 'open' | 'reconnecting';
export interface ToolChip { callId: string; name: string; summary: string; ok?: boolean; ts: number }
export interface AgentUI { id: string; role: string; name: string; state: AgentState; desk: { x: number; y: number }; tools: string[]; text?: string; textTs?: number; tool?: ToolChip; result?: string; costUsd?: number; error?: string }
export interface MessageUI { from: string; to: string; text: string; kind: 'ask' | 'reply'; ts: number }
export interface OfficeState { conn: ConnStatus; retries: number; agents: Record<string, AgentUI>; order: string[]; messages: MessageUI[]; log: OfficeEvent[]; notices: { text: string; ts: number }[] }
export type Action = { type: 'event'; e: OfficeEvent } | { type: 'conn'; status: ConnStatus; retries?: number };
export const MAX_LOG = 200, MAX_MSG = 30, BUBBLE_MAX = 140;
export const initialState = (conn: ConnStatus = 'connecting'): OfficeState => ({ conn, retries: 0, agents: {}, order: [], messages: [], log: [], notices: [] });
export const truncate = (s: string, n = BUBBLE_MAX) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const push = <T,>(arr: T[], x: T, max: number) => (arr.length >= max ? [...arr.slice(arr.length - max + 1), x] : [...arr, x]);
function patch(s: OfficeState, id: string, p: Partial<AgentUI>): OfficeState {
  const a = s.agents[id]; if (!a) return s;
  return { ...s, agents: { ...s.agents, [id]: { ...a, ...p } } };
}
/** Pure: (state, action) → new state. Unknown agents/events are ignored rather than throwing. */
export function reduce(s: OfficeState, act: Action): OfficeState {
  if (act.type === 'conn') return { ...s, conn: act.status, retries: act.retries ?? (act.status === 'open' ? 0 : s.retries) };
  const e = act.e;
  if (!e || typeof e !== 'object' || typeof (e as any).t !== 'string') return s;
  const logged = e.t === 'office.snapshot' ? s : { ...s, log: push(s.log, e, MAX_LOG) };
  switch (e.t) {
    case 'office.snapshot': {
      const agents: Record<string, AgentUI> = {};
      for (const v of e.agents) agents[v.id] = { ...s.agents[v.id], tools: s.agents[v.id]?.tools ?? [], id: v.id, role: v.role, name: v.name, state: v.state, desk: v.desk };
      return { ...s, agents, order: e.agents.map((v) => v.id) };
    }
    case 'agent.spawned': {
      const prev = logged.agents[e.id];
      return { ...logged, agents: { ...logged.agents, [e.id]: { ...prev, id: e.id, role: e.role, name: e.name, desk: e.desk, tools: e.tools, state: prev?.state ?? 'idle' } },
        order: logged.order.includes(e.id) ? logged.order : [...logged.order, e.id] };
    }
    case 'agent.state': return patch(logged, e.id, { state: e.state });
    case 'agent.text': return patch(logged, e.id, { text: truncate(e.text), textTs: e.ts });
    case 'tool.call': return patch(logged, e.id, { tool: { callId: e.callId, name: e.tool, summary: truncate(e.inputSummary, 80), ts: e.ts } });
    case 'tool.result': {
      const a = logged.agents[e.id];
      if (!a?.tool || a.tool.callId !== e.callId) return logged;
      return patch(logged, e.id, { tool: { ...a.tool, ok: e.ok } });
    }
    case 'agent.message': return { ...logged, messages: push(logged.messages, { from: e.from, to: e.to, text: truncate(e.text, 100), kind: e.kind ?? 'ask', ts: e.ts }, MAX_MSG) };
    case 'agent.done': return patch(logged, e.id, { state: 'done', result: truncate(e.result, 200), costUsd: e.costUsd, tool: undefined });
    case 'agent.error': return patch(logged, e.id, { state: 'error', error: truncate(e.error, 200) });
    case 'office.notice': return { ...logged, notices: push(logged.notices, { text: e.text, ts: e.ts }, 10) };
    default: return logged;
  }
}
