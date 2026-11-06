import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { PromptAck, PromptAckState } from './types.js';

export const PROMPT_MAX = 4000;
export const QUEUE_TTL_MS = 45_000;
export const CLAIM_TTL_MS = 180_000;
const NONCE_RE = /^[\w-]{8,64}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

export function sanitizePrompt(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return;
  const t = raw.replace(/\r\n?/g, '\n').replace(/[\0-\x08\x0B-\x1F\x7F]/g, '').trim();
  if (!t) return;
  return t.length > PROMPT_MAX ? `${t.slice(0, PROMPT_MAX)}…` : t;
}
export function validNonce(v: unknown): v is string { return typeof v === 'string' && NONCE_RE.test(v); }
export function validInboxToken(v: unknown): v is string { return typeof v === 'string' && TOKEN_RE.test(v); }

export interface InboxJob {
  id: string; sid: string; nonce: string; text: string;
  state: PromptAckState; enqueuedAt: number; expiresAt: number;
  claimedAt?: number; reason?: string;
}
export type EnqueueOk = { ok: true; id: string; nonce: string; state: PromptAckState };
export type EnqueueErr = { ok: false; error: string; status: number };
export type InboxOpts = { now?: () => number; onStatus?: (a: PromptAck) => void };

function tokenEq(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** In-memory per-sid prompt queue. Not persisted. Text never appears on WS acks. */
export class PromptInbox {
  private tokens = new Map<string, string>();
  private jobs = new Map<string, InboxJob>(); // id → job
  private active = new Map<string, string>(); // sid → job id (queued|claimed)
  private seen = new Map<string, { id: string; state: PromptAckState }>(); // sid|nonce
  constructor(private o: InboxOpts = {}) {}
  private now() { return this.o.now?.() ?? Date.now(); }
  private emit(job: InboxJob) {
    this.o.onStatus?.({ t: 'prompt.status', sid: job.sid, nonce: job.nonce, state: job.state, reason: job.reason, ts: this.now() });
  }
  ensureToken(sid: string): string {
    let t = this.tokens.get(sid);
    if (!t) { t = randomBytes(24).toString('base64url'); this.tokens.set(sid, t); }
    return t;
  }
  tokenFor(sid: string): string | undefined { return this.tokens.get(sid); }
  auth(sid: string, token: string | undefined): boolean {
    const want = this.tokens.get(sid);
    return !!want && validInboxToken(token) && tokenEq(want, token!);
  }
  view(): PromptAck[] {
    this.expire();
    return [...this.jobs.values()].filter((j) => j.state === 'queued' || j.state === 'claimed').map((j) => ({
      t: 'prompt.status' as const, sid: j.sid, nonce: j.nonce, state: j.state, reason: j.reason, ts: j.enqueuedAt,
    }));
  }
  enqueue(sid: string, text: unknown, nonce: unknown, live: { exists: boolean; canSubmit: boolean }): EnqueueOk | EnqueueErr {
    this.expire();
    if (!live.exists) return { ok: false, error: 'no-session', status: 404 };
    if (!live.canSubmit) return { ok: false, error: 'unsupported', status: 409 };
    const body = sanitizePrompt(text); if (!body) return { ok: false, error: 'empty', status: 400 };
    if (!validNonce(nonce)) return { ok: false, error: 'bad-nonce', status: 400 };
    const seenKey = `${sid}|${nonce}`;
    const prev = this.seen.get(seenKey);
    if (prev) {
      const job = this.jobs.get(prev.id);
      if (job && (job.state === 'queued' || job.state === 'claimed')) return { ok: true, id: job.id, nonce, state: job.state };
      return { ok: false, error: 'duplicate', status: 409 };
    }
    const curId = this.active.get(sid);
    if (curId) {
      const cur = this.jobs.get(curId);
      if (cur && (cur.state === 'queued' || cur.state === 'claimed')) return { ok: false, error: 'queued', status: 409 };
    }
    const id = randomBytes(12).toString('base64url');
    const now = this.now();
    const job: InboxJob = { id, sid, nonce, text: body, state: 'queued', enqueuedAt: now, expiresAt: now + QUEUE_TTL_MS };
    this.jobs.set(id, job); this.active.set(sid, id); this.seen.set(seenKey, { id, state: 'queued' });
    while (this.seen.size > 200) this.seen.delete(this.seen.keys().next().value!);
    this.emit(job);
    return { ok: true, id, nonce, state: 'queued' };
  }
  claim(sid: string, token: string | undefined): { ok: 'unauthorized' } | { ok: 'empty' } | { ok: true; id: string; text: string } {
    this.expire();
    if (!this.auth(sid, token)) return { ok: 'unauthorized' };
    const id = this.active.get(sid); if (!id) return { ok: 'empty' };
    const job = this.jobs.get(id); if (!job || job.state !== 'queued') return { ok: 'empty' };
    job.state = 'claimed'; job.claimedAt = this.now(); job.expiresAt = job.claimedAt + CLAIM_TTL_MS;
    this.seen.set(`${sid}|${job.nonce}`, { id, state: 'claimed' });
    this.emit(job);
    return { ok: true, id: job.id, text: job.text };
  }
  ack(sid: string, token: string | undefined, id: string, state: PromptAckState, reason?: string): 'unauthorized' | boolean {
    if (!this.auth(sid, token)) return 'unauthorized';
    if (state !== 'delivered' && state !== 'rejected' && state !== 'unsupported' && state !== 'dropped') return false;
    const job = this.jobs.get(id);
    if (!job || job.sid !== sid || (job.state !== 'queued' && job.state !== 'claimed')) return false;
    job.state = state === 'dropped' ? 'rejected' : state;
    job.reason = reason ? String(reason).slice(0, 240) : (state === 'dropped' ? 'dropped' : undefined);
    if (this.active.get(sid) === id) this.active.delete(sid);
    this.seen.set(`${sid}|${job.nonce}`, { id, state: job.state });
    this.emit(job);
    this.jobs.delete(id); // text leaves memory after ack
    return true;
  }
  expire(now = this.now()): PromptAck[] {
    const out: PromptAck[] = [];
    for (const job of [...this.jobs.values()]) {
      if (job.state !== 'queued' && job.state !== 'claimed') continue;
      if (job.expiresAt > now) continue;
      job.state = 'expired'; job.reason = 'expired';
      if (this.active.get(job.sid) === job.id) this.active.delete(job.sid);
      this.seen.set(`${job.sid}|${job.nonce}`, { id: job.id, state: 'expired' });
      this.emit(job);
      out.push({ t: 'prompt.status', sid: job.sid, nonce: job.nonce, state: 'expired', reason: 'expired', ts: now });
      this.jobs.delete(job.id);
    }
    return out;
  }
  retain(live: Set<string>): void {
    for (const sid of [...this.tokens.keys()]) if (!live.has(sid)) this.drop(sid);
  }
  drop(sid: string): void {
    const id = this.active.get(sid);
    if (id) {
      const job = this.jobs.get(id);
      if (job && (job.state === 'queued' || job.state === 'claimed')) {
        job.state = 'session-ended'; job.reason = 'session-ended';
        this.seen.set(`${sid}|${job.nonce}`, { id, state: 'session-ended' });
        this.emit(job);
      }
      this.jobs.delete(id); this.active.delete(sid);
    }
    this.tokens.delete(sid);
  }
}
