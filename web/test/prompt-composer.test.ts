import { describe, it, expect, vi, afterEach } from 'vitest';
import { reduce, initialState } from '../src/reducer';
import { capabilityNote, composerBusy, statusNote } from '../src/composerCopy';
import { postPrompt, newNonce } from '../src/submitPrompt';
import type { OfficeEvent, PromptAck, SessionView } from '../src/types';

const sess = (p: Partial<SessionView> = {}): SessionView => ({
  sid: 's1', project: 'p', cwd: '/p', state: 'idle', subagents: [], startedAt: 1, lastSeen: 1, source: 'default', profiles: [], agentIds: [], ...p,
});
const ev = (...es: OfficeEvent[]) => es.reduce((s, e) => reduce(s, { type: 'event', e }), initialState());

describe('composer copy', () => {
  it('is truthful: no fake setters, busy only while queued/claimed', () => {
    expect(capabilityNote()).toMatch(/Select a live session/);
    expect(capabilityNote(sess())).toMatch(/cannot submit/);
    expect(capabilityNote(sess({ canSubmit: true }))).toMatch(/as you/);
    expect(capabilityNote(sess({ canSubmit: true }))).not.toMatch(/dropdown|permission mode/i);
    expect(composerBusy({ t: 'prompt.status', sid: 's1', nonce: 'n', state: 'queued', ts: 1 })).toBe(true);
    expect(composerBusy({ t: 'prompt.status', sid: 's1', nonce: 'n', state: 'delivered', ts: 1 })).toBe(false);
    expect(statusNote({ t: 'prompt.status', sid: 's1', nonce: 'n', state: 'delivered', ts: 1 })).toMatch(/not finished/i);
  });
});

describe('reducer: prompt.status', () => {
  it('stores acks per sid without logging and without treating delivered as a turn', () => {
    const a: PromptAck = { t: 'prompt.status', sid: 's1', nonce: 'n1', state: 'queued', ts: 2 };
    let s = ev(a);
    expect(s.prompts.s1).toMatchObject({ state: 'queued', nonce: 'n1' });
    expect(s.log).toHaveLength(0);
    expect(s.turns).toHaveLength(0);
    s = ev(a, { t: 'prompt.status', sid: 's1', nonce: 'n1', state: 'delivered', ts: 3 });
    expect(s.prompts.s1.state).toBe('delivered');
    expect(s.turns).toHaveLength(0);
    s = reduce(s, { type: 'event', e: { t: 'office.snapshot', agents: [], sessions: [sess({ canSubmit: true })], prompts: [{ t: 'prompt.status', sid: 's1', nonce: 'n2', state: 'claimed', ts: 4 }], ts: 5 } });
    expect(s.prompts.s1).toMatchObject({ state: 'claimed', nonce: 'n2' });
    expect(s.sessions[0].canSubmit).toBe(true);
  });
  it('ignores older acks', () => {
    const s = ev(
      { t: 'prompt.status', sid: 's1', nonce: 'n', state: 'delivered', ts: 9 },
      { t: 'prompt.status', sid: 's1', nonce: 'n', state: 'queued', ts: 1 },
    );
    expect(s.prompts.s1.state).toBe('delivered');
  });
});

describe('postPrompt', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  it('posts Bearer run token JSON and treats 200 as queued not a turn', async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, id: 'j1', nonce: 'n', state: 'queued' }) }));
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('sessionStorage', { getItem: () => '127.0.0.1:7777' });
    vi.stubGlobal('location', { port: '7777', host: '127.0.0.1:7777' });
    const r = await postPrompt('run-tok', 's1', 'hello', 'nonce-aaaa-bbbb-cccc-01');
    expect(r).toEqual({ ok: true, id: 'j1', nonce: 'n', state: 'queued' });
    const call = fetch.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string }];
    expect(call[0]).toBe('http://127.0.0.1:7777/prompt');
    expect(call[1].headers.authorization).toBe('Bearer run-tok');
    expect(JSON.parse(call[1].body)).toEqual({ sid: 's1', text: 'hello', nonce: 'nonce-aaaa-bbbb-cccc-01' });
  });
  it('maps 409 queued/unsupported', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ error: 'queued' }) })));
    vi.stubGlobal('sessionStorage', { getItem: () => null });
    vi.stubGlobal('location', { port: '5173', host: '127.0.0.1:5173' });
    const r = await postPrompt('t', 's1', 'x', 'nonce-aaaa-bbbb-cccc-01');
    expect(r).toEqual({ ok: false, error: 'queued', status: 409 });
  });
  it('newNonce is id-shaped', () => { expect(newNonce().length).toBeGreaterThanOrEqual(8); });
});
