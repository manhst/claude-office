import { officeHttpBase } from './settingsApi';
import type { PromptAckState } from './types';

export type PromptPostOk = { ok: true; id: string; nonce: string; state: PromptAckState };
export type PromptPostErr = { ok: false; error: string; status: number };
/** POST /prompt with the UI run token. 200 means queued, not a finished turn. */
export async function postPrompt(token: string, sid: string, text: string, nonce: string): Promise<PromptPostOk | PromptPostErr> {
  const r = await fetch(`${officeHttpBase()}/prompt`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ sid, text, nonce }),
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
