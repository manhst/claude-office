import { deckHttpBase } from './settingsApi';
import type { PromptAckState } from './types';

export type PromptPostOk = { ok: true; id: string; nonce: string; state: PromptAckState };
export type PromptPostErr = { ok: false; error: string; status: number };
/** Model/effort for this one prompt's turn; '' or absent keeps the session's own. */
export type PromptPick = { model?: string; effort?: string };
export const MODEL_CHOICES: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: 'session default' }, { value: 'opus', label: 'Opus' }, { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' }, { value: 'claude-fable-5-1', label: 'Fable 5.1' },
];
export const EFFORT_CHOICES: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: 'session default' }, { value: 'low', label: 'low' }, { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' }, { value: 'xhigh', label: 'xhigh' }, { value: 'max', label: 'max' },
];
/** POST /prompt with the UI run token. 200 means queued, not a finished turn. */
export async function postPrompt(token: string, sid: string, text: string, nonce: string, pick: PromptPick = {}): Promise<PromptPostOk | PromptPostErr> {
  const r = await fetch(`${deckHttpBase()}/prompt`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ sid, text, nonce, ...(pick.model ? { model: pick.model } : {}), ...(pick.effort ? { effort: pick.effort } : {}) }),
  });
  const j = await r.json().catch(() => ({} as any));
  if (!r.ok) return { ok: false, error: typeof j.error === 'string' ? j.error : `prompt ${r.status}`, status: r.status };
  return { ok: true, id: String(j.id ?? ''), nonce: String(j.nonce ?? nonce), state: (j.state as PromptAckState) ?? 'queued' };
}
export function newNonce(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, '').slice(0, 24);
  const a = new Uint8Array(16); c?.getRandomValues?.(a);
  return Array.from(a, (x) => x.toString(16).padStart(2, '0')).join('') || `n${Date.now().toString(36)}`;
}
