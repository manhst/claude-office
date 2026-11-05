import { describe, it, expect, beforeEach } from 'vitest';
import { reduce, initialState, upsertTurn, turnKey, MAX_TURNS, type OfficeState } from '../src/reducer';
import { turnLines, fmtDuration, multiSession, turnsSig, isLongPrompt, type TurnLine } from '../src/turnLines';
import { DEFAULT_COLLAPSE, loadCollapse, setCollapse } from '../src/collapse';
import type { OfficeEvent, TurnView } from '../src/types';

const ev = (s: OfficeState, ...es: OfficeEvent[]) => es.reduce((st, e) => reduce(st, { type: 'event', e }), s);
const turn = (p: Partial<TurnView> = {}): TurnView => ({ sid: 's1', turnId: 't1', project: 'shop-api', steps: [], status: 'running', startedAt: 1000, ...p });
const T = (t: TurnView, ts = 5): OfficeEvent => ({ t: 'session.turn', turn: t, ts });
const kinds = (ls: TurnLine[]) => ls.map((l) => l.k);

describe('reducer: session.turn', () => {
  it('upserts by sid+turnId+agentRunId (latest replaces), keeps order by startedAt, does not log', () => {
    let s = ev(initialState(), T(turn({ prompt: 'fix it' })));
    expect(s.turns).toHaveLength(1); expect(s.log).toHaveLength(0);
    s = ev(s, T(turn({ steps: [{ kind: 'text', text: 'on it' }] })));
    expect(s.turns).toHaveLength(1); expect(s.turns[0].steps).toHaveLength(1);
    s = ev(s, T(turn({ agentRunId: 'ag1', who: 'web-dev', startedAt: 1500 })), T(turn({ sid: 's2', startedAt: 500 })));
    expect(s.turns.map((t) => `${t.sid}:${t.agentRunId ?? ''}`)).toEqual(['s2:', 's1:', 's1:ag1']);
    s = ev(s, T(turn({ status: 'answer', answer: 'done', endedAt: 3000 })));
    expect(s.turns).toHaveLength(3); expect(s.turns[1]).toMatchObject({ status: 'answer', answer: 'done' });
    expect(turnKey(turn())).not.toBe(turnKey(turn({ agentRunId: 'x' })));
  });
  it('caps at MAX_TURNS keeping the newest', () => {
    let s = initialState();
    for (let i = 0; i < MAX_TURNS + 5; i++) s = ev(s, T(turn({ turnId: `t${i}`, startedAt: i })));
    expect(s.turns).toHaveLength(MAX_TURNS); expect(s.turns[0].turnId).toBe('t5'); expect(s.turns.at(-1)!.turnId).toBe(`t${MAX_TURNS + 4}`);
    expect(upsertTurn([], turn(), 1)).toHaveLength(1);
  });
  it('snapshot replaces turns (missing → empty, duplicates folded, junk dropped); bad session.turn ignored', () => {
    let s = ev(initialState(), T(turn({ turnId: 'old' })));
    s = ev(s, { t: 'office.snapshot', agents: [], turns: [turn({ turnId: 'b', startedAt: 9 }), turn({ turnId: 'a', startedAt: 2 }), turn({ turnId: 'a', startedAt: 2, status: 'answer' }), { nope: 1 } as any], ts: 9 });
    expect(s.turns.map((t) => t.turnId)).toEqual(['a', 'b']); expect(s.turns[0].status).toBe('answer');
    s = ev(s, { t: 'office.snapshot', agents: [], ts: 10 });
    expect(s.turns).toEqual([]);
    const before = s; s = ev(s, { t: 'session.turn', turn: { sid: 's1' } as any, ts: 11 });
    expect(s).toBe(before);
  });
  it('is pure', () => {
    const s0 = ev(initialState(), T(turn())); const frozen = JSON.stringify(s0);
    ev(s0, T(turn({ status: 'answer' })), T(turn({ turnId: 't2', startedAt: 0 }))); expect(JSON.stringify(s0)).toBe(frozen);
  });
});

describe('turnLines (CLI rendering)', () => {
  it('prompt, text + tool steps, tool error, answer appended when it differs, duration', () => {
    const ls = turnLines(turn({ prompt: 'run tests', status: 'answer', durationMs: 12_300, answer: 'All green.\n\n- 3 passed',
      steps: [{ kind: 'text', text: 'Running tests.' }, { kind: 'tool', name: 'Bash', detail: 'npm test', isError: true }, { kind: 'tool', name: 'Read' }] }));
    expect(kinds(ls)).toEqual(['head', 'prompt', 'text', 'tool', 'tool-error', 'tool', 'answer', 'duration']);
    expect(ls[3]).toMatchObject({ name: 'Bash', detail: 'npm test', isError: true }); expect(ls[5]).toMatchObject({ name: 'Read', detail: undefined });
    expect(ls.at(-2)).toMatchObject({ text: 'All green.\n\n- 3 passed' }); expect(ls.at(-1)).toMatchObject({ text: '(12.3s)' });
  });
  it('does not print the answer twice when it is the last text step (exact or clipped prefix), keeps the full copy', () => {
    const full = 'x'.repeat(5000);
    for (const last of [full, full.slice(0, 2000) + '…']) {
      const ls = turnLines(turn({ status: 'answer', answer: full, steps: [{ kind: 'text', text: 'first' }, { kind: 'tool', name: 'Grep' }, { kind: 'text', text: last }] }));
      expect(kinds(ls)).toEqual(['head', 'text', 'tool', 'answer']); expect((ls[3] as any).text).toBe(full);
    }
    const tailTool = turnLines(turn({ status: 'answer', answer: 'Done', steps: [{ kind: 'text', text: 'Done' }, { kind: 'tool', name: 'Edit' }] }));
    expect(kinds(tailTool)).toEqual(['head', 'answer', 'tool']);
  });
  it('status lines: running Working…(elapsed), aborted Interrupted, refusal/error red, unknown end → duration only', () => {
    expect(turnLines(turn({ startedAt: 1000 }), { now: 6500 }).at(-1)).toEqual({ k: 'working', secs: 5 });
    expect(kinds(turnLines(turn({ status: 'aborted', endedAt: 2000 })))).toEqual(['head', 'interrupted', 'duration']);
    expect(turnLines(turn({ status: 'refusal' })).at(-1)).toEqual({ k: 'fail', text: 'Refused' });
    expect(turnLines(turn({ status: 'error', answer: 'API Error: 529' })).slice(-2)).toEqual([{ k: 'answer', text: 'API Error: 529' }, { k: 'fail', text: 'Error' }]);
    expect(kinds(turnLines(turn({ status: 'weird' as any, durationMs: 61_000 })))).toEqual(['head', 'duration']);
  });
  it('subagent label + long prompt collapsible; main-loop prompt never collapses; project only when multi-session', () => {
    const long = 'Implement it.\n1. a\n2. b\n3. c';
    const sub = turnLines(turn({ who: 'web-dev', agentRunId: 'ag1', prompt: long }), { multi: true });
    expect(sub[0]).toEqual({ k: 'head', ts: 1000, project: 'shop-api', who: 'web-dev' }); expect(sub[1]).toEqual({ k: 'prompt', text: long, long: true });
    expect(turnLines(turn({ prompt: long }))[1]).toEqual({ k: 'prompt', text: long, long: false });
    expect(turnLines(turn())[0]).toEqual({ k: 'head', ts: 1000, project: undefined, who: undefined });
    expect(isLongPrompt('short')).toBe(false); expect(isLongPrompt('y'.repeat(300))).toBe(true);
    expect(multiSession([turn(), turn({ turnId: 't2' })])).toBe(false); expect(multiSession([turn(), turn({ sid: 's2' })])).toBe(true);
  });
  it('finished turns do not depend on the clock (only running ones show elapsed)', () => {
    for (const st of ['answer', 'aborted', 'refusal', 'error'] as const) {
      const t = turn({ status: st, durationMs: 1500, answer: 'ok' });
      expect(turnLines(t, { now: 2_000 })).toEqual(turnLines(t, { now: 99_000 })); expect(turnLines(t, { now: 2_000 })).toEqual(turnLines(t));
    }
    expect(turnLines(turn(), { now: 2_000 })).not.toEqual(turnLines(turn(), { now: 9_000 }));
  });
  it('tolerates junk steps; fmtDuration; sig changes with content only', () => {
    expect(kinds(turnLines(turn({ steps: [null as any, { kind: 'text', text: '  ' }, { kind: 'bogus' } as any] })))).toEqual(['head', 'working']);
    expect([fmtDuration(12_345), fmtDuration(125_000), fmtDuration(3_720_000)]).toEqual(['12.3s', '2m 5s', '1h 2m']);
    const a = turnsSig([turn()]); expect(turnsSig([turn()])).toBe(a); expect(turnsSig([turn({ steps: [{ kind: 'tool', name: 'Read' }] })])).not.toBe(a);
  });
});

describe('collapse prefs include responses', () => {
  const mem = new Map<string, string>();
  beforeEach(() => {
    mem.clear();
    Object.defineProperty(globalThis, 'localStorage', {
      value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); } },
      configurable: true,
    });
  });
  it('defaults responses expanded; persists toggle', () => {
    expect(DEFAULT_COLLAPSE.responses).toBe(false);
    expect(loadCollapse().responses).toBe(false);
    setCollapse('responses', true);
    expect(loadCollapse().responses).toBe(true);
    expect(loadCollapse().events).toBe(false);
  });
});
