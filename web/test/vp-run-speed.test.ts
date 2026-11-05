import { describe, it, expect, beforeEach } from 'vitest';
import {
  RUN_SPEED_DEFAULT, RUN_SPEED_MAX, RUN_SPEED_MIN, TOWN_RUN_SPEED_MAX,
  clampRunSpeed, loadRunSpeed, saveRunSpeed, townRunSpeed, walkerSpeedFor,
} from '../src/vpRunSpeed';
import { WALK_SPEED } from '../src/walk';
import { PX } from '../src/town/map';
import type { Goal } from '../src/walk';

const mem = new Map<string, string>();
const home: Goal = { key: 'home', to: [0, 0, 0], home: true, face: 0 };
const visit: Goal = { key: 'visit:b', to: [1, 0, 0], home: false, face: 0 };
const cafe: Goal = { key: 'coffee:0', to: [-8, 0, -7], home: false, face: 0 };

describe('vpRunSpeed', () => {
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

  it('defaults slower than max; clamp respects min/max', () => {
    expect(RUN_SPEED_DEFAULT).toBeLessThan(RUN_SPEED_MAX);
    expect(RUN_SPEED_DEFAULT).toBeGreaterThanOrEqual(RUN_SPEED_MIN);
    expect(loadRunSpeed()).toBe(RUN_SPEED_DEFAULT);
    expect(TOWN_RUN_SPEED_MAX).toBe(190);
    expect(RUN_SPEED_MAX).toBeCloseTo(190 / PX, 5);
    expect(clampRunSpeed(0)).toBe(RUN_SPEED_MIN);
    expect(clampRunSpeed(99)).toBe(RUN_SPEED_MAX);
  });

  it('save/load round-trip; townRunSpeed scales by PX', () => {
    saveRunSpeed(3.2);
    expect(loadRunSpeed()).toBeCloseTo(3.2, 5);
    expect(townRunSpeed()).toBe(Math.round(3.2 * PX));
  });

  it('walkerSpeedFor: active desk return = max; amenity = setting; visit/home free = walk', () => {
    saveRunSpeed(2.8);
    expect(walkerSpeedFor(home, 'working')).toBe(RUN_SPEED_MAX);
    expect(walkerSpeedFor(home, 'thinking')).toBe(RUN_SPEED_MAX);
    expect(walkerSpeedFor(home, 'talking')).toBe(RUN_SPEED_MAX);
    expect(walkerSpeedFor(home, 'idle')).toBe(WALK_SPEED);
    expect(walkerSpeedFor(home, 'done')).toBe(WALK_SPEED);
    expect(walkerSpeedFor(visit, 'working')).toBe(WALK_SPEED);
    expect(walkerSpeedFor(cafe, 'idle')).toBeCloseTo(2.8, 5);
    expect(walkerSpeedFor(cafe, 'done')).toBeCloseTo(2.8, 5);
    expect(WALK_SPEED).toBe(1.6);
  });
});
