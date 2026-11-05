/** Vanphong run speed (tốc độ chạy). Client-only localStorage, like vp-labels. Walk speed is separate and unchanged. */
import type { Goal } from './walk';
import { WALK_SPEED } from './walk';
import { PX } from './town/map';

export const VP_RUN_SPEED_KEY = 'vp-run-speed';
export const VP_RUN_SPEED_EVENT = 'vp-run-speed-changed';

/** World m/s. Max matches prior town NPC sprint (190 plan-px/s ÷ PX). */
export const RUN_SPEED_MAX = 190 / PX; // ≈ 5.067 m/s — previous "crazy fast" run
export const RUN_SPEED_MIN = 0.1;
/** Default slower than the old sprint so the complaint is fixed out of the box. */
export const RUN_SPEED_DEFAULT = 2.5;

/** Town plan-px/s used when an NPC explicitly runs (was hardcoded 190). */
export const TOWN_RUN_SPEED_MAX = 190;

function storage(): Storage | undefined {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage; } catch { return undefined; }
}

export function clampRunSpeed(v: number): number {
  if (!Number.isFinite(v)) return RUN_SPEED_DEFAULT;
  return Math.min(RUN_SPEED_MAX, Math.max(RUN_SPEED_MIN, v));
}

export function loadRunSpeed(): number {
  try {
    const raw = storage()?.getItem(VP_RUN_SPEED_KEY);
    if (raw == null || raw === '') return RUN_SPEED_DEFAULT;
    return clampRunSpeed(Number(raw));
  } catch { return RUN_SPEED_DEFAULT; }
}

export function saveRunSpeed(v: number): void {
  const n = clampRunSpeed(v);
  const s = storage();
  if (!s) return;
  s.setItem(VP_RUN_SPEED_KEY, String(n));
  try { window.dispatchEvent(new CustomEvent(VP_RUN_SPEED_EVENT)); } catch { /* no window */ }
}

/** Ambient town run in plan-px/s from the same setting. */
export function townRunSpeed(): number {
  return Math.round(loadRunSpeed() * PX);
}

/**
 * Office walker speed for this goal.
 * - Active agent (thinking/working/talking) returning home → max run.
 * - Idle amenity / outdoor plans (cafe, massage, garden, …) → half of configurable ambient run.
 * - Visit colleague / free agent walking home → WALK_SPEED (unchanged).
 */
export function walkerSpeedFor(goal: Goal, state: string): number {
  const active = state === 'thinking' || state === 'working' || state === 'talking';
  if (goal.home && active) return RUN_SPEED_MAX;
  if (!goal.home && !goal.key.startsWith('visit:')) return loadRunSpeed() / 2;
  return WALK_SPEED;
}
