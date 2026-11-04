import type { SessionView } from './types';
/** Pure helpers for the sessions panel (unit-tested). */
export const SOURCE_LABEL: Record<SessionView['source'], string> = { agents: '.claude/agents', 'claude-md': 'CLAUDE.md', default: 'default devs' };
export const STATE_LABEL: Record<SessionView['state'], string> = { idle: 'idle', thinking: 'thinking', tool: 'running tool', 'waiting-permission': 'waiting for permission', done: 'done' };
/** Panel colour key reuses the office state palette. */
export const STATE_KEY: Record<SessionView['state'], string> = { idle: 'idle', thinking: 'thinking', tool: 'working', 'waiting-permission': 'talking', done: 'done' };
export function activeSubagents(s: SessionView) { return s.subagents.filter((x) => x.status === 'running' || x.status === 'pending' || x.status === 'waiting'); }
/** Keep the selection valid: selected sid if still active, else first session, else undefined. */
export function pickSelected(sessions: SessionView[], sid: string | undefined) { return sessions.find((s) => s.sid === sid)?.sid ?? sessions[0]?.sid; }
export function agoLabel(ts: number, now: number) { const s = Math.max(0, Math.round((now - ts) / 1000)); return s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`; }
