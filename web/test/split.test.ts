import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULT_SPLIT, MIN_MAP_PX, MIN_SIDE_PX, VP_SPLIT_KEY, clampSplit, loadSplit, saveSplit, splitFromPointer } from '../src/split';

describe('clampSplit', () => {
  it('keeps the default 80:20 when there is room', () => {
    expect(clampSplit(DEFAULT_SPLIT, 1200)).toBeCloseTo(0.8);
    expect(clampSplit(0.8, 1600)).toBeCloseTo(0.8);
  });
  it('enforces min map and min side widths', () => {
    const wide = 1200;
    expect(clampSplit(0.05, wide) * wide).toBeGreaterThanOrEqual(MIN_MAP_PX - 0.5);
    expect((1 - clampSplit(0.99, wide)) * wide).toBeGreaterThanOrEqual(MIN_SIDE_PX - 0.5);
  });
  it('falls back when the ratio is not a number', () => {
    expect(clampSplit(Number.NaN, 0)).toBe(DEFAULT_SPLIT);
  });
});

describe('splitFromPointer', () => {
  it('maps a pointer x inside the main pane to a clamped fraction', () => {
    expect(splitFromPointer(100, 0, 1000)).toBeCloseTo(clampSplit(0.1, 1000));
    expect(splitFromPointer(800, 0, 1000)).toBeCloseTo(clampSplit(0.8, 1000));
    expect(splitFromPointer(0, 0, 0)).toBe(DEFAULT_SPLIT);
  });
});

describe('split persistence', () => {
  const mem = new Map<string, string>();
  beforeEach(() => {
    mem.clear();
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (k: string) => mem.get(k) ?? null,
        setItem: (k: string, v: string) => { mem.set(k, v); },
        removeItem: (k: string) => { mem.delete(k); },
      },
      configurable: true,
    });
  });
  it('defaults to 80:20 and persists a chosen ratio', () => {
    expect(loadSplit()).toBe(DEFAULT_SPLIT);
    expect(saveSplit(0.65)).toBeCloseTo(clampSplit(0.65, 0));
    expect(mem.get(VP_SPLIT_KEY)).toBeTruthy();
    expect(loadSplit()).toBeCloseTo(clampSplit(0.65, 0));
  });
  it('ignores garbage in localStorage', () => {
    mem.set(VP_SPLIT_KEY, 'nope');
    expect(loadSplit()).toBe(DEFAULT_SPLIT);
  });
});
