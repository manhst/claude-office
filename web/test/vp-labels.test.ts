import { describe, expect, it, beforeEach } from 'vitest';
import { DEFAULT_LABELS, LABEL_ROWS, applyLabelVisibility, isLabelOn, loadLabels, monitorLabelVisible, saveLabels, type LabelPrefs } from '../src/vpLabels';

const mem = new Map<string, string>();
const fakeStore = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, v); },
  removeItem: (k: string) => { mem.delete(k); },
};

describe('vpLabels', () => {
  beforeEach(() => {
    mem.clear();
    Object.defineProperty(globalThis, 'localStorage', { value: fakeStore, configurable: true });
  });

  it('defaults: shops + pond on; amenities / rooms off; monitor = alert-only', () => {
    expect(DEFAULT_LABELS.cafe).toBe(true);
    expect(DEFAULT_LABELS.massage).toBe(true);
    expect(DEFAULT_LABELS.bbq).toBe(true);
    expect(DEFAULT_LABELS.trada).toBe(true);
    expect(DEFAULT_LABELS.pond).toBe(true);
    for (const k of ['garden', 'smoke', 'gym', 'atm', 'gate', 'pod', 'print', 'pantry', 'game', 'workroom'] as const) {
      expect(DEFAULT_LABELS[k], k).toBe(false);
    }
    expect(DEFAULT_LABELS.monitor).toBe('alert');
    expect(LABEL_ROWS.map((r) => r.key)).toContain('gate');
  });

  it('loadLabels returns defaults when empty; save/load round-trips', () => {
    expect(loadLabels()).toEqual(DEFAULT_LABELS);
    const next: LabelPrefs = { ...DEFAULT_LABELS, gate: true, monitor: 'always' };
    saveLabels(next);
    expect(loadLabels().gate).toBe(true);
    expect(loadLabels().monitor).toBe('always');
    expect(isLabelOn('gate')).toBe(true);
    expect(isLabelOn('smoke')).toBe(false);
  });

  it('monitorLabelVisible respects off / alert / always', () => {
    expect(monitorLabelVisible({ state: 'ok' }, { ...DEFAULT_LABELS, monitor: 'off' })).toBe(false);
    expect(monitorLabelVisible({ state: 'alert' }, { ...DEFAULT_LABELS, monitor: 'off' })).toBe(false);
    expect(monitorLabelVisible({ state: 'ok' }, { ...DEFAULT_LABELS, monitor: 'always' })).toBe(true);
    expect(monitorLabelVisible({ state: 'unconfigured' }, DEFAULT_LABELS)).toBe(false);
    expect(monitorLabelVisible({ state: 'checking' }, DEFAULT_LABELS)).toBe(false);
    expect(monitorLabelVisible({ state: 'ok' }, DEFAULT_LABELS)).toBe(false);
    expect(monitorLabelVisible({ state: 'alert' }, DEFAULT_LABELS)).toBe(true);
    expect(monitorLabelVisible({ state: 'error' }, DEFAULT_LABELS)).toBe(true);
  });

  it('applyLabelVisibility toggles nhan-an class (CSS2D-safe)', () => {
    const classes = new Set<string>();
    const el = {
      classList: {
        toggle: (name: string, force?: boolean) => {
          if (force) classes.add(name); else if (force === false) classes.delete(name);
          else if (classes.has(name)) classes.delete(name); else classes.add(name);
        },
        contains: (name: string) => classes.has(name),
      },
      setAttribute: (_k: string, _v: string) => {},
    } as unknown as HTMLElement;
    applyLabelVisibility(el, false);
    expect(el.classList.contains('nhan-an')).toBe(true);
    applyLabelVisibility(el, true);
    expect(el.classList.contains('nhan-an')).toBe(false);
  });
});
