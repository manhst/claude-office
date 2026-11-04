import { describe, it, expect } from 'vitest';
import { Router, extractAsks, stripAsks } from '../src/router.js';
const roles = new Set(['researcher', 'coder', 'reviewer', 'designer', 'pm']);
describe('extractAsks', () => {
  it('finds @@ASK lines, case-insensitive role, multi-line', () => {
    expect(extractAsks('Hi\n@@ASK Coder: can you sketch it?\n@@ASK reviewer:  is it safe? \nbye')).toEqual([
      { to: 'coder', text: 'can you sketch it?' }, { to: 'reviewer', text: 'is it safe?' }]);
    expect(extractAsks('mentions @@ASK inline coder: no')).toEqual([]);
    expect(stripAsks('Hi\n@@ASK coder: x')).toBe('Hi');
  });
});
describe('Router', () => {
  it('routes a valid ask with hop 1', () => {
    const r = new Router(roles).ask('researcher', { to: 'coder', text: 'q' });
    expect(r).toMatchObject({ ok: true, msg: { from: 'researcher', to: 'coder', hops: 1, chain: ['researcher'], kind: 'ask' } });
  });
  it('rejects unknown role and self', () => {
    const r = new Router(roles);
    expect(r.ask('researcher', { to: 'ceo', text: 'q' })).toMatchObject({ ok: false, reason: 'unknown_role' });
    expect(r.ask('coder', { to: 'coder', text: 'q' })).toMatchObject({ ok: false, reason: 'self' });
    expect(r.messageCount).toBe(0);
  });
  it('enforces max 3 hops', () => {
    const r = new Router(roles);
    expect(r.ask('reviewer', { to: 'designer', text: 'q' }, ['researcher', 'coder'])).toMatchObject({ ok: true, msg: { hops: 3 } });
    expect(r.ask('designer', { to: 'pm', text: 'q' }, ['researcher', 'coder', 'reviewer'])).toMatchObject({ ok: false, reason: 'hop_limit' });
  });
  it('detects loops back to an agent already on the path', () => {
    const r = new Router(roles);
    expect(r.ask('reviewer', { to: 'researcher', text: 'q' }, ['researcher', 'coder'])).toMatchObject({ ok: false, reason: 'loop' });
    expect(r.ask('coder', { to: 'researcher', text: 'q' }, ['researcher'])).toMatchObject({ ok: false, reason: 'loop' });
  });
  it('dedupes identical questions', () => {
    const r = new Router(roles);
    expect(r.ask('researcher', { to: 'coder', text: 'Same?' }).ok).toBe(true);
    expect(r.ask('researcher', { to: 'coder', text: ' same? ' })).toMatchObject({ ok: false, reason: 'duplicate' });
  });
  it('caps total messages (asks + replies)', () => {
    const r = new Router(roles, { maxHops: 3, maxMessages: 3 });
    const a = r.ask('researcher', { to: 'coder', text: '1' }); if (!a.ok) throw 0;
    expect(r.reply(a.msg, 'ans')).toMatchObject({ from: 'coder', to: 'researcher', kind: 'reply', qid: a.msg.qid });
    expect(r.ask('researcher', { to: 'coder', text: '2' }).ok).toBe(true);
    expect(r.ask('researcher', { to: 'coder', text: '3' })).toMatchObject({ ok: false, reason: 'budget' });
    expect(r.reply(a.msg, 'x')).toBeNull();
  });
});
