import type { AgentUI, OfficeState } from './reducer';
import type { AgentState, SessionView, SubagentInfo, TurnView } from './types';

/** Shown when the payload has no current prompt / tool / description. */
export const TASK_UNAVAILABLE = 'unavailable';

const BUSY_SUB = /^(running|pending|waiting)$/i;
const norm = (v?: string) => (v ?? '').trim().toLowerCase();

/** Desk AgentState → UI label. `talking` is the office mapping of waiting-permission. */
export const AGENT_STATE_LABEL: Record<AgentState, string> = {
  idle: 'idle', thinking: 'thinking', working: 'working', talking: 'waiting', done: 'done', error: 'error',
};

export type AgentRow = {
  key: string;
  kind: 'desk' | 'subagent';
  name: string;
  role?: string;
  id?: string;
  model?: string;
  type?: string;
  /** Palette key shared with STATE_COLORS (idle/thinking/working/talking/done/error). */
  statusKey: string;
  /** Human label from the payload (raw subagent status if unknown). */
  statusLabel: string;
  working: boolean;
  /** Current tool / prompt / description, or `unavailable`. */
  task: string;
  children: AgentRow[];
};

export function matchesDesk(profileName: string, sub: SubagentInfo): boolean {
  const pname = norm(profileName);
  if (!pname) return false;
  if (norm(sub.type) === pname || norm(sub.name) === pname) return true;
  const desc = norm(sub.description);
  return !!desc && (desc === pname || desc.includes(pname) || pname.includes(desc));
}

/** Map a raw `$.agent.list()` status string; unknown values are shown as-is, never invented. */
export function subagentStatus(status: string): { key: string; label: string; working: boolean } {
  const raw = (status ?? '').trim();
  const s = raw.toLowerCase();
  if (s === 'running') return { key: 'working', label: 'working', working: true };
  if (s === 'pending') return { key: 'thinking', label: 'pending', working: true };
  if (s === 'waiting') return { key: 'talking', label: 'waiting', working: true };
  if (s === 'completed' || s === 'done') return { key: 'done', label: 'done', working: false };
  if (s === 'error' || s === 'failed') return { key: 'error', label: raw || s, working: false };
  if (s === 'idle') return { key: 'idle', label: 'idle', working: false };
  return { key: BUSY_SUB.test(raw) ? 'working' : 'idle', label: raw || 'unknown', working: BUSY_SUB.test(raw) };
}

function lastStepTask(t: TurnView): string | undefined {
  const last = t.steps.at(-1);
  if (!last) return;
  if (last.kind === 'tool') return [last.name, last.detail].filter(Boolean).join(' · ') || undefined;
  if (last.text.trim()) return last.text;
}

function liveTurn(turns: TurnView[], sid: string, deskId?: string, agentRunId?: string, who?: string): TurnView | undefined {
  const running = (t: TurnView) => t.sid === sid && t.status === 'running';
  if (agentRunId) {
    for (let i = turns.length - 1; i >= 0; i--) if (running(turns[i]) && turns[i].agentRunId === agentRunId) return turns[i];
  }
  if (who) {
    for (let i = turns.length - 1; i >= 0; i--) if (running(turns[i]) && turns[i].agentRunId && turns[i].who && norm(turns[i].who) === norm(who)) return turns[i];
  }
  if (agentRunId || who) return;
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (!running(t) || t.agentRunId) continue;
    if (deskId && t.deskId && t.deskId !== deskId) continue;
    return t;
  }
}

function deskBusy(state: AgentState) {
  return state === 'working' || state === 'thinking' || state === 'talking';
}

function deskTask(a: AgentUI, session: SessionView, lead: boolean, turns: TurnView[]): string {
  if (!deskBusy(a.state)) return TASK_UNAVAILABLE;
  if (a.state === 'working' && a.tool) {
    const bits = [a.tool.name, a.tool.summary].filter((x) => x && x.length);
    if (bits.length) return bits.join(' · ');
  }
  if (a.text) return a.text;
  if (a.state === 'talking') {
    if (session.tool) return `Waiting for permission: ${[session.tool.name, session.tool.detail].filter(Boolean).join(' · ')}`;
    return 'Waiting for permission';
  }
  if (lead && session.tool) {
    const bits = [session.tool.name, session.tool.detail].filter(Boolean);
    if (bits.length) return bits.join(' · ');
  }
  if (lead && a.state === 'thinking' && session.prompt) return session.prompt;
  const turn = liveTurn(turns, session.sid, a.id);
  const fromTurn = turn && (lastStepTask(turn) || turn.prompt);
  return fromTurn || TASK_UNAVAILABLE;
}

function subTask(sub: SubagentInfo, session: SessionView, turns: TurnView[]): string {
  if (sub.description?.trim()) return sub.description.trim();
  const who = sub.type || sub.name;
  const turn = (sub.id || who) ? liveTurn(turns, session.sid, undefined, sub.id, who) : undefined;
  const fromTurn = turn && (lastStepTask(turn) || turn.prompt);
  return fromTurn || TASK_UNAVAILABLE;
}

function subRow(sub: SubagentInfo, i: number, session: SessionView, turns: TurnView[]): AgentRow {
  const st = subagentStatus(sub.status);
  const name = (sub.type || sub.name || 'subagent').trim();
  return {
    key: `sub:${sub.id ?? `${name}-${i}`}`,
    kind: 'subagent',
    name,
    id: sub.id,
    type: sub.type,
    role: sub.name && sub.name !== sub.type ? sub.name : undefined,
    statusKey: st.key,
    statusLabel: st.label,
    working: st.working,
    task: subTask(sub, session, turns),
    children: [],
  };
}

function deskRow(a: AgentUI, session: SessionView, lead: boolean, turns: TurnView[], children: AgentRow[]): AgentRow {
  return {
    key: `desk:${a.id}`,
    kind: 'desk',
    name: a.name,
    role: a.role !== a.name ? a.role : undefined,
    id: a.id,
    model: a.model,
    statusKey: a.state,
    statusLabel: AGENT_STATE_LABEL[a.state] ?? a.state,
    working: deskBusy(a.state),
    task: deskTask(a, session, lead, turns),
    children,
  };
}

/**
 * Current desks + subagents for one session (selection-scoped).
 * Subagents nest under the desk whose profile name matches type/name/description;
 * unmatched subagents stay as session-level rows (no invented parent).
 */
export function sessionAgentTree(s: OfficeState, sid: string | undefined): AgentRow[] {
  const session = s.sessions.find((x) => x.sid === sid);
  if (!session) return [];
  const desks = session.agentIds.map((id) => s.agents[id]).filter((a): a is AgentUI => !!a);
  const kids: AgentRow[][] = desks.map(() => []);
  const leftover: AgentRow[] = [];
  session.subagents.forEach((sub, i) => {
    const row = subRow(sub, i, session, s.turns);
    const di = desks.findIndex((d) => matchesDesk(d.role || d.name, sub));
    if (di >= 0) kids[di].push(row);
    else leftover.push(row);
  });
  if (!desks.length) return leftover;
  return [...desks.map((a, i) => deskRow(a, session, i === 0, s.turns, kids[i])), ...leftover];
}

export function countAgents(rows: AgentRow[]): number {
  return rows.reduce((n, r) => n + 1 + countAgents(r.children), 0);
}
