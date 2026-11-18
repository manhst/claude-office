import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BookmarkStore, cleanNote, BOOKMARK_CAP } from '../src/bookmarks.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'office-bm-'));
const logs = () => { const out: string[] = []; return Object.assign((l: string) => { out.push(l); }, { out }); };
const posix = process.platform !== 'win32';
describe('bookmark notes', () => {
  it('strips control chars, trims, caps at 200, empty → none', () => {
    expect(cleanNote('  ship\nit\t now\0 ')).toBe('ship it  now');
    expect(cleanNote('x'.repeat(500))!.length).toBe(BOOKMARK_CAP.note);
    expect(cleanNote(`${'x'.repeat(199)}🎉`)).toBe('x'.repeat(199)); // no half surrogate pair
    for (const v of ['', '  \n\t ', '\x01\x02', 5, null, undefined]) expect(cleanNote(v)).toBeUndefined();
  });
});
describe('BookmarkStore', () => {
  it('adds, re-notes keeping the first at, clears the note, deletes idempotently; saves atomically with mode 600', () => {
    const dir = tmp(), path = join(dir, 'sub', 'bm.json'), s = new BookmarkStore(path);
    expect(s.size).toBe(0); expect(existsSync(path)).toBe(false);
    expect(s.set('a-1', ' first ', 1000)).toEqual({ at: 1000, note: 'first' });
    expect(s.set('a-1', 'second', 2000)).toEqual({ at: 1000, note: 'second' });
    expect(s.set('a-1', '', 3000)).toEqual({ at: 1000 });
    expect(s.set('b-2', undefined, 4000)).toEqual({ at: 4000 });
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ version: 1, bookmarks: { 'a-1': { at: 1000 }, 'b-2': { at: 4000 } } });
    expect(readdirSync(join(dir, 'sub'))).toEqual(['bm.json']); // no tmp file left behind
    if (posix) expect(statSync(path).mode & 0o777).toBe(0o600);
    s.delete('b-2'); s.delete('b-2'); s.delete('never');
    expect(new BookmarkStore(path).get('a-1')).toEqual({ at: 1000 }); expect(new BookmarkStore(path).get('b-2')).toBeUndefined();
  });
  it('loads valid entries, drops invalid ones (original copied to .bak, one log line)', () => {
    const dir = tmp(), path = join(dir, 'bm.json'), log = logs();
    const file = { version: 1, bookmarks: { ok: { at: 5, note: '  hi\n' }, '../x': { at: 1 }, s2: { at: 'x' }, s3: { at: null }, s4: { at: 1, note: 7 }, s5: null, s6: { at: 9 } } };
    writeFileSync(path, JSON.stringify(file));
    const s = new BookmarkStore(path, log);
    expect([s.size, s.get('ok'), s.get('s6')]).toEqual([2, { at: 5, note: 'hi' }, { at: 9 }]);
    expect(log.out).toHaveLength(1); expect(log.out[0]).toContain('ignored 5 invalid');
    expect(JSON.parse(readFileSync(`${path}.bak`, 'utf8'))).toEqual(file); expect(existsSync(path)).toBe(true);
  });
  it('a corrupt or wrong-shape file → empty store, file moved to .bak, one log line; a missing file is silent', () => {
    for (const bad of ['not json{', '{"version":2,"bookmarks":{}}', '{"version":1,"bookmarks":[]}', '[]']) {
      const dir = tmp(), path = join(dir, 'bm.json'), log = logs(); writeFileSync(path, bad);
      const s = new BookmarkStore(path, log);
      expect(s.size).toBe(0); expect(log.out).toHaveLength(1); expect(readFileSync(`${path}.bak`, 'utf8')).toBe(bad); expect(existsSync(path)).toBe(false);
      s.set('n-1', 'x', 1); expect(JSON.parse(readFileSync(path, 'utf8')).bookmarks).toEqual({ 'n-1': { at: 1, note: 'x' } });
    }
    const log = logs(); expect(new BookmarkStore(join(tmp(), 'none.json'), log).size).toBe(0); expect(log.out).toEqual([]);
  });
  it('memory-only without a path; caps the count; a failed save leaves the store unchanged', () => {
    const m = new BookmarkStore();
    for (let i = 0; i < BOOKMARK_CAP.count; i++) expect(m.set(`s${i}`)).not.toBe('full');
    expect(m.set('one-more')).toBe('full'); expect(m.set('s1', 're-note')).toMatchObject({ note: 're-note' }); // updates still work when full
    const dir = tmp(); writeFileSync(join(dir, 'file'), 'x');
    const broken = new BookmarkStore(join(dir, 'file', 'bm.json'), () => {}); // parent is a file: every save throws
    expect(() => broken.set('a-1', 'n')).toThrow(); expect(broken.get('a-1')).toBeUndefined();
  });
});
