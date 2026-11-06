import type { SessionView, SubagentInfo } from './types';
/** Pure helpers for the sessions panel (unit-tested). */
export const SOURCE_LABEL: Record<SessionView['source'], string> = { agents: '.claude/agents', 'claude-md': 'CLAUDE.md', default: 'default devs' };
export const STATE_LABEL: Record<SessionView['state'], string> = { idle: 'idle', thinking: 'thinking', tool: 'running tool', 'waiting-permission': 'waiting for permission', done: 'done' };
/** Panel colour key reuses the office state palette. */
export const STATE_KEY: Record<SessionView['state'], string> = { idle: 'idle', thinking: 'thinking', tool: 'working', 'waiting-permission': 'talking', done: 'done' };
export function activeSubagents(s: SessionView) { return s.subagents.filter((x) => x.status === 'running' || x.status === 'pending' || x.status === 'waiting'); }
/** Keep the selection valid: selected sid if still active, else first session, else undefined. */
export function pickSelected(sessions: SessionView[], sid: string | undefined) { return sessions.find((s) => s.sid === sid)?.sid ?? sessions[0]?.sid; }
export function agoLabel(ts: number, now: number) { const s = Math.max(0, Math.round((now - ts) / 1000)); return s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`; }

export type DumpRow = {
  key: string;
  label: string;
  value?: string;
  mono?: boolean;
  /** Nested lines under this row (e.g. each subagent field). */
  lines?: string[];
};

function present(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === 'string') return v.length > 0;
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

function fmtTs(ts: number, now: number): string {
  try {
    const abs = new Date(ts).toLocaleString([], { hour12: false });
    return `${abs} (${agoLabel(ts, now)})`;
  } catch { return String(ts); }
}

/** One subagent as compact CLI-ish lines (skip empty fields; no profile markdown). */
export function formatSubagent(a: SubagentInfo, i: number): string[] {
  const bits: string[] = [];
  const head = [a.type, a.name, a.id].filter((x) => present(x));
  bits.push(`#${i + 1} ${head.length ? head.join(' · ') : 'agent'} [${a.status}]`);
  if (present(a.description)) bits.push(`  desc: ${a.description}`);
  if (present(a.id) && !head.includes(a.id)) bits.push(`  id: ${a.id}`);
  if (present(a.name) && a.type && a.name !== a.type) bits.push(`  name: ${a.name}`);
  return bits;
}

/**
 * CLI-like dump of every SessionView field we have (skip empty/undefined).
 * Does NOT include profile markdown bodies — only a short profiles/agentIds count when useful.
 */
export function sessionDumpRows(x: SessionView, now: number): DumpRow[] {
  const rows: DumpRow[] = [];
  const push = (key: string, label: string, value: unknown, o: { mono?: boolean; lines?: string[] } = {}) => {
    if (o.lines) { rows.push({ key, label, mono: o.mono, lines: o.lines }); return; }
    if (!present(value)) return;
    rows.push({ key, label, value: typeof value === 'number' && key === 'costUsd' ? `$${value.toFixed(3)}` : String(value), mono: o.mono });
  };

  push('sid', 'sid', x.sid, { mono: true });
  push('project', 'project', x.project);
  push('cwd', 'cwd', x.cwd, { mono: true });
  push('title', 'title', x.title);
  push('transcript', 'transcript', x.transcript, { mono: true });
  push('state', 'state', STATE_LABEL[x.state] ?? x.state);
  if (x.tool) {
    const parts = [x.tool.name, x.tool.detail].filter(present);
    const when = x.tool.ts ? ` @ ${fmtTs(x.tool.ts, now)}` : '';
    push('tool', 'tool', `${parts.join(' · ')}${when}`, { mono: true });
  }
  push('prompt', 'prompt', x.prompt);
  push('costUsd', 'cost', x.costUsd);
  if (present(x.startedAt) && x.startedAt > 0) push('startedAt', 'started', fmtTs(x.startedAt, now), { mono: true });
  if (present(x.lastSeen) && x.lastSeen > 0) push('lastSeen', 'lastSeen', fmtTs(x.lastSeen, now), { mono: true });
  push('source', 'source', SOURCE_LABEL[x.source] ?? x.source);
  push('model', 'model', x.model, { mono: true });
  if (typeof x.canSubmit === 'boolean') push('canSubmit', 'canSubmit', x.canSubmit ? 'yes ($.prompt.submit)' : 'no');

  if (x.subagents.length) {
    const lines = x.subagents.flatMap((a, i) => formatSubagent(a, i));
    rows.push({ key: 'subagents', label: `subagents (${x.subagents.length})`, lines, mono: true });
  }
  // Short counts only — never dump profile markdown bodies / agentId maps.
  if (x.profiles?.length) push('profiles', 'profiles', `${x.profiles.length} loaded (bodies hidden)`);
  if (x.agentIds?.length) push('agentIds', 'desks', `${x.agentIds.length}: ${x.agentIds.join(', ')}`, { mono: true });

  return rows;
}
