/** Persist the map:info split as a map fraction (default 80:20). Client-only localStorage. */
export const VP_SPLIT_KEY = 'vp-split';
export const DEFAULT_SPLIT = 0.8;
export const MIN_MAP_PX = 320;
export const MIN_SIDE_PX = 220;

function storage(): Storage | undefined {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage; } catch { return undefined; }
}

/** Clamp a map fraction so both panes keep a usable width. */
export function clampSplit(ratio: number, totalPx: number): number {
  const r = Number.isFinite(ratio) ? ratio : DEFAULT_SPLIT;
  if (!(totalPx > 0)) return Math.min(0.82, Math.max(0.45, r));
  const minMap = Math.min(MIN_MAP_PX, totalPx * 0.55);
  const minSide = Math.min(MIN_SIDE_PX, totalPx * 0.35);
  const map = Math.min(totalPx - minSide, Math.max(minMap, r * totalPx));
  return map / totalPx;
}

export function splitFromPointer(clientX: number, left: number, width: number): number {
  if (!(width > 0)) return DEFAULT_SPLIT;
  return clampSplit((clientX - left) / width, width);
}

export function loadSplit(): number {
  try {
    const raw = storage()?.getItem(VP_SPLIT_KEY);
    if (raw == null || raw === '') return DEFAULT_SPLIT;
    const n = Number(raw);
    return Number.isFinite(n) ? clampSplit(n, 0) : DEFAULT_SPLIT;
  } catch { return DEFAULT_SPLIT; }
}

export function saveSplit(ratio: number): number {
  const next = clampSplit(ratio, 0);
  storage()?.setItem(VP_SPLIT_KEY, String(next));
  return next;
}
