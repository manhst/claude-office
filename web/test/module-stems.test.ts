import { describe, it, expect } from 'vitest';
import { SplitGutter } from '../src/SplitGutter';
import { loadSplit } from '../src/splitPrefs';

const EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

/** Basename without the last extension; `split.test.ts` → `split.test`. */
export function moduleStem(path: string): string {
  const base = path.replace(/\\/g, '/').split('/').pop() ?? path;
  const dot = base.lastIndexOf('.');
  return dot < 0 ? base : base.slice(0, dot);
}

/**
 * Same-directory files whose stems collide case-insensitively.
 * Vite extensionless imports (`./Split`) fold Split.tsx and split.ts together on Windows.
 */
export function siblingStemCollisions(files: string[]): string[][] {
  const groups = new Map<string, string[]>();
  for (const f of files) {
    const norm = f.replace(/\\/g, '/');
    const base = norm.split('/').pop() ?? norm;
    const dot = base.lastIndexOf('.');
    const ext = (dot < 0 ? '' : base.slice(dot)).toLowerCase();
    if (!EXTS.has(ext)) continue;
    const i = norm.lastIndexOf('/');
    const dir = (i < 0 ? '' : norm.slice(0, i)).toLowerCase();
    const key = `${dir}\0${moduleStem(norm).toLowerCase()}`;
    const arr = groups.get(key) ?? [];
    arr.push(norm);
    groups.set(key, arr);
  }
  return [...groups.values()].filter((g) => g.length > 1).map((g) => g.sort()).sort((a, b) => a[0].localeCompare(b[0]));
}

describe('module stems (Windows/Vite)', () => {
  it('treats Split.tsx + split.ts and ResponseLog.tsx + responseLog.ts as collisions, distinct helper names as safe', () => {
    expect(siblingStemCollisions(['web/src/Split.tsx', 'web/src/split.ts'])).toEqual([['web/src/Split.tsx', 'web/src/split.ts']]);
    expect(siblingStemCollisions(['web/src/ResponseLog.tsx', 'web/src/responseLog.ts'])).toEqual([['web/src/ResponseLog.tsx', 'web/src/responseLog.ts']]);
    expect(siblingStemCollisions(['web/src/SplitGutter.tsx', 'web/src/splitPrefs.ts', 'web/src/ResponseLog.tsx', 'web/src/listResponses.ts'])).toEqual([]);
    expect(siblingStemCollisions(['web/src/split.ts', 'web/test/split.test.ts'])).toEqual([]);
  });

  it('loads SplitGutter and splitPrefs as separate modules', () => {
    expect(typeof SplitGutter).toBe('function');
    expect(typeof loadSplit).toBe('function');
  });
});
