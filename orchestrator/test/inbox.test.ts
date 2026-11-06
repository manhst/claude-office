import { describe, it, expect } from 'vitest';
import { PromptInbox, sanitizePrompt, validNonce, QUEUE_TTL_MS, CLAIM_TTL_MS, PROMPT_MAX } from '../src/inbox.js';

describe('sanitizePrompt', () => {
  it('keeps newlines, strips other controls, caps length', () => {
    expect(sanitizePrompt('  hi\r\nthere\0\x1b ')).toBe('hi\nthere');
    expect(sanitizePrompt('   ')).toBeUndefined();
    expect(sanitizePrompt(1)).toBeUndefined();
    expect(sanitizePrompt('x'.repeat(PROMPT_MAX + 10))!.endsWith('…')).toBe(true);
  });
  it('nonce shape', () => {
    expect(validNonce('abc')).toBe(false);
    expect(validNonce('n'.repeat(24))).toBe(true);
  });
});

describe('PromptInbox', () => {
  const live = { exists: true, canSubmit: true };
  it('enqueues, claims at most once, acks without keeping text', () => {
    const ev: any[] = [];
    const box = new PromptInbox({ onStatus: (a) => ev.push(a) });
    const tok = box.ensureToken('s1');
    expect(box.enqueue('s1', 'hello', 'nonce-aaaa-bbbb-cccc-01', live)).toMatchObject({ ok: true, state: 'queued' });
    expect(ev.at(-1)).toMatchObject({ t: 'prompt.status', sid: 's1', state: 'queued' });
    expect(JSON.stringify(ev)).not.toContain('hello');
    expect(box.enqueue('s1', 'hello', 'nonce-aaaa-bbbb-cccc-01', live)).toMatchObject({ ok: true, state: 'queued' }); // idempotent
    expect(box.enqueue('s1', 'other', 'nonce-aaaa-bbbb-cccc-02', live)).toMatchObject({ ok: false, error: 'queued', status: 409 });
    const a = box.claim('s1', tok); expect(a).toMatchObject({ ok: true, text: 'hello' });
    expect(box.claim('s1', tok)).toEqual({ ok: 'empty' }); // at-most-once
    expect(box.claim('s1', 'nope')).toEqual({ ok: 'unauthorized' });
    expect(box.ack('s1', tok, (a as any).id, 'delivered')).toBe(true);
    expect(ev.at(-1)).toMatchObject({ state: 'delivered' });
    expect(JSON.stringify(ev.at(-1))).not.toContain('hello');
    expect(box.enqueue('s1', 'hello', 'nonce-aaaa-bbbb-cccc-01', live)).toMatchObject({ ok: false, error: 'duplicate', status: 409 });
  });
  it('rejects missing session, unsupported, empty, bad nonce', () => {
    const box = new PromptInbox();
    expect(box.enqueue('gone', 'x', 'nonce-aaaa-bbbb-cccc-01', { exists: false, canSubmit: true })).toMatchObject({ error: 'no-session', status: 404 });
    expect(box.enqueue('s1', 'x', 'nonce-aaaa-bbbb-cccc-01', { exists: true, canSubmit: false })).toMatchObject({ error: 'unsupported', status: 409 });
    expect(box.enqueue('s1', '  ', 'nonce-aaaa-bbbb-cccc-01', live)).toMatchObject({ error: 'empty', status: 400 });
    expect(box.enqueue('s1', 'x', 'bad', live)).toMatchObject({ error: 'bad-nonce', status: 400 });
  });
  it('expires queued then claimed; drop marks session-ended', () => {
    let now = 1_000;
    const ev: any[] = [];
    const box = new PromptInbox({ now: () => now, onStatus: (a) => ev.push(a) });
    const tok = box.ensureToken('s1');
    box.enqueue('s1', 'x', 'nonce-aaaa-bbbb-cccc-01', live);
    now += QUEUE_TTL_MS + 1; box.expire();
    expect(ev.at(-1).state).toBe('expired');
    expect(box.claim('s1', tok)).toEqual({ ok: 'empty' });
    box.enqueue('s1', 'y', 'nonce-aaaa-bbbb-cccc-02', live);
    const c = box.claim('s1', tok) as { ok: true; id: string };
    now += CLAIM_TTL_MS + 1; box.expire();
    expect(ev.at(-1).state).toBe('expired');
    box.enqueue('s1', 'z', 'nonce-aaaa-bbbb-cccc-03', live);
    box.drop('s1');
    expect(ev.at(-1).state).toBe('session-ended');
    expect(box.claim('s1', tok)).toEqual({ ok: 'unauthorized' });
    expect(c.id).toBeTruthy();
  });
  it('Esc/drop ack is rejected, not a finished turn', () => {
    const box = new PromptInbox();
    const tok = box.ensureToken('s1');
    const q = box.enqueue('s1', 'go', 'nonce-aaaa-bbbb-cccc-09', live) as { ok: true; id: string };
    box.claim('s1', tok);
    expect(box.ack('s1', tok, q.id, 'dropped', 'session is stopped')).toBe(true);
    expect(box.view()).toEqual([]);
  });
});
