import type { OfficeEvent } from './types';

/** Soft cap for sidebar display only — keep answers readable; secrets already redacted upstream. */
export const RESPONSE_DISPLAY_MAX = 2000;

export type ResponseKind = 'text' | 'done' | 'tool' | 'error';

export type ResponseItem = {
  key: string;
  ts: number;
  kind: ResponseKind;
  agentId: string;
  /** Display body (may be soft-truncated for huge strings). */
  body: string;
  ok?: boolean;
  costUsd?: number;
  tool?: string;
};

export function clipResponse(s: string, max = RESPONSE_DISPLAY_MAX): string {
  if (s.length <= max) return s;
  return s.slice(0, max).trimEnd() + `…(+${s.length - max})`;
}

/** Pick answer-like events from the office log (newest last in source order). */
export function pickResponseEvents(log: OfficeEvent[]): OfficeEvent[] {
  return log.filter((e) => {
    if (e.t === 'agent.text') return !!(e.text && e.text.trim());
    if (e.t === 'agent.done') return !!(e.result && e.result.trim());
    if (e.t === 'agent.error') return !!(e.error && e.error.trim());
    if (e.t === 'tool.result') return !!(e.summary && e.summary.trim());
    return false;
  });
}

export function describeResponse(
  e: OfficeEvent,
  nameOf: (id: string) => string,
): ResponseItem | null {
  if (e.t === 'agent.text') {
    return { key: `text-${e.ts}-${e.id}`, ts: e.ts, kind: 'text', agentId: e.id, body: clipResponse(e.text) };
  }
  if (e.t === 'agent.done') {
    const cost = e.costUsd != null ? ` ($${e.costUsd.toFixed(3)})` : '';
    return {
      key: `done-${e.ts}-${e.id}`,
      ts: e.ts,
      kind: 'done',
      agentId: e.id,
      body: clipResponse(`${e.result}${cost}`),
      costUsd: e.costUsd,
    };
  }
  if (e.t === 'agent.error') {
    return { key: `err-${e.ts}-${e.id}`, ts: e.ts, kind: 'error', agentId: e.id, body: clipResponse(e.error) };
  }
  if (e.t === 'tool.result' && e.summary.trim()) {
    return {
      key: `tool-${e.ts}-${e.id}-${e.callId}`,
      ts: e.ts,
      kind: 'tool',
      agentId: e.id,
      body: clipResponse(e.summary),
      ok: e.ok,
    };
  }
  return null;
}

/** Newest first, same window size as Events. */
export function listResponses(
  log: OfficeEvent[],
  nameOf: (id: string) => string,
  limit = 60,
): ResponseItem[] {
  const items: ResponseItem[] = [];
  for (const e of pickResponseEvents(log)) {
    const d = describeResponse(e, nameOf);
    if (d) {
      d.body = `${nameOf(d.agentId)}: ${d.body}`;
      items.push(d);
    }
  }
  return items.slice(-limit).reverse();
}
