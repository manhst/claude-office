import { chmodSync, copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { HISTORY_SID } from './history.js';
import type { HistoryBookmark } from './types.js';

/** Note length (chars) and bookmark count caps. */
export const BOOKMARK_CAP = { note: 200, count: 5000 };
/** Bookmark note as stored: control chars → space, trimmed, ≤200 chars; empty or not a string → undefined. */
export function cleanNote(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  let t = v.replace(/[\0-\x1F\x7F-\x9F]+/g, ' ').trim().slice(0, BOOKMARK_CAP.note);
  if (/[\uD800-\uDBFF]$/.test(t)) t = t.slice(0, -1);
  return t.trimEnd() || undefined;
}
/** User bookmarks on past sessions, `{version:1, bookmarks:{<sid>:{at, note?}}}` at `path` (saved per change: tmp file + rename, mode 600), or in memory
 *  only when path is unset (demo). Kept for sids that left the index. */
export class BookmarkStore {
  private map = new Map<string, HistoryBookmark>();
  constructor(readonly path?: string, log: (line: string) => void = (l) => console.error(l)) { if (path) this.load(path, log); }
  get size() { return this.map.size; }
  get(sid: string): HistoryBookmark | undefined { return this.map.get(sid); }
  /** Adds (at = now) or re-notes a bookmark (the first `at` stays); an absent/empty note clears it. 'full' at 5000 bookmarks. Throws (unchanged) when the save fails. */
  set(sid: string, note?: unknown, now = Date.now()): HistoryBookmark | 'full' {
    const prev = this.map.get(sid); if (!prev && this.map.size >= BOOKMARK_CAP.count) return 'full';
    const n = cleanNote(note), next: HistoryBookmark = n ? { at: prev?.at ?? now, note: n } : { at: prev?.at ?? now };
    if (prev && prev.note === next.note) return prev;
    this.commit(sid, next, prev); return next;
  }
  /** Removes a bookmark; unknown sids are a no-op. */
  delete(sid: string) { const prev = this.map.get(sid); if (prev) this.commit(sid, undefined, prev); }
  private commit(sid: string, next: HistoryBookmark | undefined, prev: HistoryBookmark | undefined) {
    if (next) this.map.set(sid, next); else this.map.delete(sid);
    try { this.save(); } catch (e) { if (prev) this.map.set(sid, prev); else this.map.delete(sid); throw e; }
  }
  private save() {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ version: 1, bookmarks: Object.fromEntries(this.map) }, null, 2)}\n`, { mode: 0o600 }); chmodSync(tmp, 0o600);
    renameSync(tmp, this.path);
  }
  /** Bad file shape → start empty, file moved to `.bak`; bad entries are dropped, original copied to `.bak`. One log line either way. */
  private load(path: string, log: (line: string) => void) {
    let raw: string;
    try { raw = readFileSync(path, 'utf8'); } catch (e: any) { if (e?.code !== 'ENOENT') log(`[deck] bookmarks: cannot read ${path} (${e?.code ?? e}); starting empty`); return; }
    let j: any; try { j = JSON.parse(raw); } catch { j = undefined; }
    const bm = j?.version === 1 && j.bookmarks && typeof j.bookmarks === 'object' && !Array.isArray(j.bookmarks) ? j.bookmarks : undefined;
    if (!bm) { try { renameSync(path, `${path}.bak`); } catch { /* keep going empty */ } log(`[deck] bookmarks: ${path} is not a valid bookmarks file; moved to ${path}.bak, starting empty`); return; }
    let bad = 0;
    for (const [sid, b] of Object.entries<any>(bm)) {
      if (!HISTORY_SID.test(sid) || !b || typeof b !== 'object' || typeof b.at !== 'number' || !Number.isFinite(b.at) || (b.note !== undefined && typeof b.note !== 'string') || this.map.size >= BOOKMARK_CAP.count) { bad++; continue; }
      const note = cleanNote(b.note); this.map.set(sid, note ? { at: b.at, note } : { at: b.at });
    }
    if (bad) { try { copyFileSync(path, `${path}.bak`); chmodSync(`${path}.bak`, 0o600); } catch { /* best effort */ } log(`[deck] bookmarks: ignored ${bad} invalid entr${bad === 1 ? 'y' : 'ies'} in ${path} (original copied to .bak)`); }
  }
}
