import { describe, it, expect, vi } from 'vitest';
import { migrateKeys, migrateStorage, migrateValues, migrateLabelsValue, migrateLooksValue, lookId, LEGACY_LOCAL_KEYS, LEGACY_SESSION_KEYS, LEGACY_LABEL_KEYS, VALUE_MIGRATIONS } from '../src/storageMigrate';
import { TAB_KEY, OPENER_KEY } from '../src/history';
import { COLLAPSE_KEY } from '../src/collapse';
import { SPLIT_KEY } from '../src/splitPrefs';
import { LABELS_KEY } from '../src/officeLabels';
import { RUN_SPEED_KEY } from '../src/officeRunSpeed';
import { DEFAULT_LABELS, loadLabels } from '../src/officeLabels';
import { loadLooks, LOOKS_KEY } from '../src/town/looks';
import { PRESETS } from '../src/town/Avatar';

const mem = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};
describe('storage key migration (office.* / vp-* → deck.*)', () => {
  it('copies old values when the new key is absent, removes the old key, and is idempotent', () => {
    const local = mem({ 'office.tab': 'history', 'vp-labels': '{"cafe":false}', 'office.vp.night': '1', 'vp-prompt-pick': '{"model":"opus"}', other: 'x' });
    const session = mem({ 'office.token': 't0k', 'office.ws': '127.0.0.1:7777' });
    expect(migrateStorage(local, session).sort()).toEqual(['deck.labels', 'deck.night', 'deck.promptPick', 'deck.tab', 'deck.token', 'deck.ws']);
    expect(Object.fromEntries(local.m)).toEqual({ 'deck.tab': 'history', 'deck.labels': '{"cafe":false}', 'deck.night': '1', 'deck.promptPick': '{"model":"opus"}', other: 'x' });
    expect(Object.fromEntries(session.m)).toEqual({ 'deck.token': 't0k', 'deck.ws': '127.0.0.1:7777' });
    expect(migrateStorage(local, session)).toEqual([]);
  });
  it('never overwrites a value already stored under the new key', () => {
    const local = mem({ 'vp-split': '0.5', 'deck.split': '0.7' });
    expect(migrateKeys(local, LEGACY_LOCAL_KEYS)).toEqual([]);
    expect(Object.fromEntries(local.m)).toEqual({ 'deck.split': '0.7' });
  });
  it('survives missing or throwing storage', () => {
    const bad = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => {} };
    expect(migrateStorage(undefined, undefined)).toEqual([]);
    expect(migrateKeys(bad, LEGACY_SESSION_KEYS)).toEqual([]);
  });
  it('targets the keys the app reads', () => {
    expect(Object.values(LEGACY_LOCAL_KEYS)).toEqual(expect.arrayContaining([TAB_KEY, OPENER_KEY, COLLAPSE_KEY, SPLIT_KEY, LABELS_KEY, RUN_SPEED_KEY]));
  });
});
describe('storage value migration (Vietnamese keys / ids → English)', () => {
  it('rewrites old structure keys in deck.labels and preset ids in deck.looks, and is idempotent', () => {
    const local = mem({
      [LABELS_KEY]: JSON.stringify({ cafe: false, trada: false, bia: true, monitor: 'always' }),
      [LOOKS_KEY]: JSON.stringify({ 'agent:coder': { name: 'Hùng', look: 'nam_03' }, 'npc:npc-2': { look: 'nu_10' }, 'npc:dog': { name: 'Rex' } }),
    });
    expect(migrateValues(local).sort()).toEqual([LABELS_KEY, LOOKS_KEY]);
    expect(JSON.parse(local.m.get(LABELS_KEY)!)).toEqual({ cafe: false, 'iced-tea': false, 'beer-stall': true, monitor: 'always' });
    expect(JSON.parse(local.m.get(LOOKS_KEY)!)).toEqual({ 'agent:coder': { name: 'Hùng', look: 'male_03' }, 'npc:npc-2': { look: 'female_10' }, 'npc:dog': { name: 'Rex' } });
    const after = Object.fromEntries(local.m);
    expect(migrateValues(local)).toEqual([]); expect(Object.fromEntries(local.m)).toEqual(after);
  });
  it('the app reads the migrated values', () => {
    const local = mem({ [LABELS_KEY]: JSON.stringify({ trada: false, bia: false }), [LOOKS_KEY]: JSON.stringify({ 'agent:a': { look: 'nu_04' } }) });
    migrateValues(local);
    vi.stubGlobal('localStorage', local);
    try { expect(loadLabels()).toMatchObject({ 'iced-tea': false, 'beer-stall': false, cafe: DEFAULT_LABELS.cafe }); } finally { vi.unstubAllGlobals(); }
    expect(loadLooks(local)).toEqual({ 'agent:a': { name: undefined, look: 'female_04' } });
  });
  it('a value already under the new key wins; old keys go away', () => {
    expect(JSON.parse(migrateLabelsValue(JSON.stringify({ trada: true, 'iced-tea': false, 'xem-nuong': false }))!)).toEqual({ 'iced-tea': false, bbq: false });
    expect(migrateLabelsValue(JSON.stringify({ cafe: true }))).toBeUndefined();
    expect(migrateLooksValue(JSON.stringify({ a: { look: 'male_01' }, b: { look: 'nam_99x' } }))).toBeUndefined();
  });
  it('never throws on bad JSON, odd shapes or throwing storage, and leaves them alone', () => {
    for (const raw of ['{', 'null', '[1,2]', '"x"', '5']) {
      const local = mem({ [LABELS_KEY]: raw, [LOOKS_KEY]: raw });
      expect(migrateValues(local)).toEqual([]); expect(local.m.get(LABELS_KEY)).toBe(raw); expect(local.m.get(LOOKS_KEY)).toBe(raw);
    }
    expect(migrateLooksValue(JSON.stringify({ a: null, b: 5, c: { look: 7 } }))).toBeUndefined();
    const bad = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => {} };
    expect(migrateValues(bad)).toEqual([]); expect(migrateValues(undefined)).toEqual([]);
  });
  it('runs after the key migration, so legacy vp-labels values are rewritten too', () => {
    const local = mem({ 'vp-labels': JSON.stringify({ trada: true }), 'office.looks': JSON.stringify({ 'agent:x': { look: 'nam_05' } }) });
    expect(migrateStorage(local, mem()).sort()).toEqual(['deck.labels', 'deck.labels', 'deck.looks', 'deck.looks']);
    expect(JSON.parse(local.m.get('deck.labels')!)).toEqual({ 'iced-tea': true });
    expect(JSON.parse(local.m.get('deck.looks')!)).toEqual({ 'agent:x': { look: 'male_05' } });
  });
  it('maps to keys and ids the app knows', () => {
    expect(Object.keys(VALUE_MIGRATIONS).sort()).toEqual([LABELS_KEY, LOOKS_KEY].sort());
    for (const k of Object.values(LEGACY_LABEL_KEYS)) expect(DEFAULT_LABELS).toHaveProperty(k);
    for (const g of ['nam', 'nu']) for (let i = 1; i <= 10; i++) { const id = lookId(`${g}_${String(i).padStart(2, '0')}`); expect(PRESETS.some((p) => p.id === id)).toBe(true); }
    expect(lookId('male_01')).toBe('male_01'); expect(lookId('xnam_01')).toBe('xnam_01');
  });
});
