export const STATE_COLORS: Record<string, string> = { idle: '#94a3b8', thinking: '#a78bfa', working: '#f59e0b', talking: '#38bdf8', done: '#22c55e', error: '#ef4444' };
export const BUBBLE_MS = 12000, DESK_COLS = 3, DESK_COUNT = 6;
export type Vec3 = [number, number, number];
/** 3D: desk grid cell → world position (x right, z toward camera), centred on origin. */
export const DESK_SPACING = { x: 4.2, z: 4 };
export function deskWorld(d: { x: number; y: number }): Vec3 {
  return [(d.x - (DESK_COLS - 1) / 2) * DESK_SPACING.x, 0, (d.y - 0.5) * DESK_SPACING.z];
}
export const allDesks = (): { x: number; y: number }[] => Array.from({ length: DESK_COUNT }, (_, i) => ({ x: i % DESK_COLS, y: Math.floor(i / DESK_COLS) }));
/** Avatar sits on the camera side of its desk, facing the monitor (+z = toward camera). */
export const SEAT_OFFSET: Vec3 = [0, 0, 0.95];
export const DOOR: Vec3 = [0, 0, -7];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
