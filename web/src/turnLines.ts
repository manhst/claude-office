import type { TurnView } from './types';

/** One CLI-style display line of a turn (Responses panel). Rendering only: no clipping, the server caps sizes. */
export type TurnLine =
  | { k: 'head'; ts: number; project?: string; who?: string }
  | { k: 'prompt'; text: string; long?: boolean }
  | { k: 'text'; text: string }
  | { k: 'tool'; name: string; detail?: string; isError?: boolean }
  | { k: 'tool-error' }
  | { k: 'answer'; text: string }
  | { k: 'working'; secs?: number }
  | { k: 'interrupted' }
  | { k: 'fail'; text: string }
  | { k: 'duration'; text: string };

/** Subagent prompts longer than this collapse behind a toggle. */
export const PROMPT_LINES = 3, PROMPT_CHARS = 240;
export const isLongPrompt = (p: string) => p.split('\n').length > PROMPT_LINES || p.length > PROMPT_CHARS;
/** CLI-like duration: 12.3s, 2m 5s, 1h 4m. */
export function fmtDuration(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${Math.floor(s % 60)}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}
/** Show the project in turn headers only when turns come from more than one session/project. */
export const multiSession = (turns: TurnView[]) => new Set(turns.map((t) => t.sid)).size > 1 || new Set(turns.map((t) => t.project)).size > 1;
/** Changes whenever visible turn content changes (drives auto-scroll; ignores the ticking clock). */
export const turnsSig = (turns: TurnView[]) => turns.map((t) => `${t.sid}/${t.turnId}/${t.agentRunId ?? ''}:${t.status}:${t.steps?.length ?? 0}:${t.answer?.length ?? 0}`).join('|');
const norm = (s: string) => s.trim().replace(/…$/, '').trimEnd();

/** Pure: TurnView → CLI transcript lines (head, `> prompt`, ● steps, answer unless it repeats the last text step, status). */
export function turnLines(t: TurnView, o: { multi?: boolean; now?: number } = {}): TurnLine[] {
  const out: TurnLine[] = [{ k: 'head', ts: t.startedAt, project: o.multi ? t.project : undefined, who: t.who || undefined }];
  if (t.prompt?.trim()) out.push({ k: 'prompt', text: t.prompt, long: !!t.who && isLongPrompt(t.prompt) });
  const steps = (Array.isArray(t.steps) ? t.steps : []).filter((x) => x && typeof x === 'object');
  const ans = typeof t.answer === 'string' && t.answer.trim() ? t.answer : undefined;
  let lastText = -1; steps.forEach((x, i) => { if (x.kind === 'text' && typeof x.text === 'string' && x.text.trim()) lastText = i; });
  // the answer is usually the last text block: print it once, in place, keeping the longer copy (either may be a clipped prefix)
  const lt = lastText >= 0 ? (steps[lastText] as { text: string }).text : '', a = ans ? norm(ans) : '', b = norm(lt);
  const inPlace = a && b && (a.startsWith(b) || b.startsWith(a)) ? lastText : -1;
  steps.forEach((x, i) => {
    if (x.kind === 'text') { if (i === inPlace) out.push({ k: 'answer', text: ans!.length >= lt.length ? ans! : lt }); else if (typeof x.text === 'string' && x.text.trim()) out.push({ k: 'text', text: x.text }); }
    else if (x.kind === 'tool') { out.push({ k: 'tool', name: x.name || 'tool', detail: x.detail || undefined, isError: x.isError || undefined }); if (x.isError) out.push({ k: 'tool-error' }); }
  });
  if (ans && inPlace < 0) out.push({ k: 'answer', text: ans });
  if (t.status === 'running') { out.push({ k: 'working', secs: o.now != null ? Math.max(0, Math.floor((o.now - t.startedAt) / 1000)) : undefined }); return out; }
  if (t.status === 'aborted') out.push({ k: 'interrupted' });
  else if (t.status === 'refusal') out.push({ k: 'fail', text: 'Refused' });
  else if (t.status === 'error') out.push({ k: 'fail', text: 'Error' });
  const ms = t.durationMs ?? (t.endedAt != null ? t.endedAt - t.startedAt : undefined);
  if (ms != null && Number.isFinite(ms)) out.push({ k: 'duration', text: `(${fmtDuration(ms)})` });
  return out;
}
