import { createHash, randomBytes } from 'node:crypto';
import { lstatSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { appendFile, chmod, lstat, mkdir, open, readdir, readFile, realpath, rename, rmdir, unlink, utimes, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { redactText } from './redact.js';
import { OPENER_CAP, SESSION_UUID } from './opener.js';
import type { BookmarkStore } from './bookmarks.js';
import type { HistoryDeleteError, HistoryDeleteItem, HistoryDeleteResponse } from './types.js';

/** Shown with every delete answer (dry run too). */
export const DELETE_NOTE = "Deletes files on this machine only. Copies kept on Anthropic's servers for your organization (e.g. Claude Enterprise Compliance) are not affected.";
/** per-session entries `<claude config dir>/<name>/<sid>` (file or dir) */
export const PER_SESSION_DIRS = ['file-history', 'session-env', 'uploads', 'dev-mods'];
/** caps: history.jsonl / one Claude Deck log processed in memory (bytes), a sessions/*.json registry entry (bytes), history lock tries (×100 ms), lock stale age (ms, proper-lockfile's default) */
export const DELETE_CAP = { history: 256 * 1024 * 1024, log: 64 * 1024 * 1024, registry: 64 * 1024, lockTries: 30, lockStaleMs: 10_000 };
export interface SessionDeleterOpts {
  /** History transcript root; must be `<configDir>/projects` (same realpath), else delete is unavailable */
  historyRoot: string;
  /** the real Claude Code config dir (CLAUDE_CONFIG_DIR or ~/.claude); unset = delete unavailable */
  configDir?: string;
  /** HistoryIndex.locate: the indexed transcript file and its mtime; null = unknown sid */
  locate(sid: string): Promise<{ file: string; mtimeMs: number } | null>;
  /** sid is live in Claude Deck / was reopened via POST /history/open < 2 min ago (both need confirm) */
  isLive?(sid: string): boolean; openedRecently?(sid: string): boolean;
  /** pid is a running process (default process.kill(pid, 0)) */
  pidAlive?(pid: number): boolean;
  bookmarks?: BookmarkStore;
  /** drops Claude Deck's own data for the deleted transcripts (History index entry, model report cache) */
  forget?(sid: string, files: string[]): void;
  /** Claude Deck's run logs (run-*.jsonl): the sid's lines are removed too */
  logDir?: string;
  demo?: boolean; home?: string; now?: () => number;
  /** roots that may hold the session scratchpad `claude-<uid>/<project folder>/<sid>/` (cli: DECK_SCRATCH_ROOTS, else os.tmpdir() and /tmp) */
  scratchRoots?: string[]; uid?: number;
  /** test hook: runs after history.jsonl's new copy is written, right before the rename */
  beforeRename?(): Promise<void> | void;
}
type Reply = { status: number; body: HistoryDeleteResponse | HistoryDeleteError };
/** one planned change: a path to remove (link = remove the link itself) or a JSONL file to filter */
interface Step { item: HistoryDeleteItem; path: string; act: 'rm' | 'history' | 'log' | 'none'; dir?: boolean; link?: boolean; parent?: string }
const T = {
  demo: 'Demo mode never deletes anything.', sid: 'Invalid session id.', flag: (k: string) => `${k} must be true or false.`, plan: 'planId must be a short string.', notFound: 'Session not found in History.',
  root: 'The History folder is not the Claude Code config folder in use (<config>/projects), so nothing is deleted from here.',
  outside: (p: string) => `Refusing to delete: ${p} resolves outside the Claude Code config folder.`,
  live: 'This session is running in Claude Deck. Deleting it now removes files Claude Code is still writing. Send again with confirm: true to delete anyway.',
  running: 'A Claude Code process registered for this session is still running. Send again with confirm: true to delete anyway.',
  recent: 'This session was reopened less than 2 minutes ago and may still be running. Send again with confirm: true to delete anyway.',
  touched: 'Files of this session were written in the last 2 minutes; it may still be running in another window. Send again with confirm: true to delete anyway.',
  busy: 'Another session is being deleted; wait a moment and try again.', locked: 'Claude Code is writing its prompt history right now; try again in a moment.',
  changed: 'Files changed since the preview. Review the list again.',
  failed: (p: string, c: string) => `Could not delete ${p} (${c}). The items in "deleted" were removed.`, left: (p: string) => `${p} still exists after the delete. The items in "deleted" were removed.`,
  big: 'Too large to rewrite here; not changed.', deck: 'Claude Deck: History index, Performance cache',
};
const fail = (status: number, error: string, reason?: string, deleted?: HistoryDeleteItem[]): Reply => ({ status, body: { error, ...(reason ? { reason } : {}), ...(deleted ? { deleted } : {}) } });
class Outside extends Error { constructor(readonly at: string) { super('outside'); } }
const gone = (e: any) => e?.code === 'ENOENT';
type Match = (j: any) => boolean;
/** history.jsonl line of sid */
export const historyLineOf = (sid: string): Match => (j) => j?.sessionId === sid;
/** Claude Deck log line of sid: top-level sid / sessionId (agent.spawned, prompt.status) or turn.sid (session.turn) */
export const logLineOf = (sid: string): Match => (j) => j?.sid === sid || j?.sessionId === sid || j?.turn?.sid === sid;
/** Drops the lines of `buf` whose JSON matches (default: `sessionId` equals sid); every other byte stays as it is (a last line without '\n' too). */
export function dropSessionLines(buf: Buffer, sid: string, match: Match = historyLineOf(sid)): { out: Buffer; lines: number; bytes: number } {
  const keep: Buffer[] = [], needle = Buffer.from(sid); let lines = 0, bytes = 0;
  for (let i = 0; i < buf.length;) {
    const nl = buf.indexOf(10, i), end = nl < 0 ? buf.length : nl + 1, line = buf.subarray(i, end);
    let hit = false; if (line.indexOf(needle) >= 0) { try { hit = match(JSON.parse(line.toString('utf8'))); } catch { hit = false; } }
    if (hit) { lines++; bytes += line.length; } else keep.push(line);
    i = end;
  }
  return { out: lines ? Buffer.concat(keep) : buf, lines, bytes };
}
/** total size of a tree's files and links (never follows links) */
async function du(p: string): Promise<number> {
  const st = await lstat(p).catch(() => null); if (!st) return 0;
  if (!st.isDirectory()) return st.size;
  let n = 0; for (const c of await readdir(p).catch(() => [] as string[])) n += await du(join(p, c));
  return n;
}
/** newest mtime in a tree (never follows links) */
async function newest(p: string): Promise<number> {
  const st = await lstat(p).catch(() => null); if (!st) return 0;
  let m = st.mtimeMs; if (st.isDirectory()) for (const c of await readdir(p).catch(() => [] as string[])) m = Math.max(m, await newest(join(p, c)));
  return m;
}
/** removes a link itself (a Windows dir link/junction via rmdir, which never touches the target) */
const unlinkLink = (p: string) => unlink(p).catch((e) => (gone(e) ? undefined : rmdir(p)));
/** bottom-up removal with lstat: every dir is re-checked to be a real dir before it is read; links inside are removed as links; entries that vanish meanwhile are fine */
async function rmTree(p: string): Promise<void> {
  const st = await lstat(p).catch((e) => (gone(e) ? null : Promise.reject(e))); if (!st) return;
  if (!st.isDirectory() || st.isSymbolicLink()) throw Object.assign(new Error('no longer a directory'), { code: 'ENOTDIR' });
  for (const c of await readdir(p).catch((e) => (gone(e) ? [] as string[] : Promise.reject(e)))) {
    const q = join(p, c), s = await lstat(q).catch((e) => (gone(e) ? null : Promise.reject(e))); if (!s) continue;
    if (s.isDirectory()) await rmTree(q); else if (s.isSymbolicLink()) await unlinkLink(q); else await unlink(q).catch((e) => (gone(e) ? undefined : Promise.reject(e)));
  }
  await rmdir(p).catch((e) => (gone(e) ? undefined : Promise.reject(e)));
}
/** sync: read, filter, write temp (same dir, same mode), rename. Sync so Claude Deck's own logger (appendFileSync per event) cannot interleave. */
function rewriteSync(f: string, sid: string, match: Match) {
  const st = lstatSync(f); if (!st.isFile()) return 0;
  const r = dropSessionLines(readFileSync(f), sid, match); if (!r.lines) return 0;
  const mode = st.mode & 0o777, tmp = join(dirname(f), `.${basename(f)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  try { writeFileSync(tmp, r.out, { flag: 'wx', mode }); renameSync(tmp, f); } catch (e) { try { unlinkSync(tmp); } catch { /* not created */ } throw e; }
  return r.lines;
}
/** History "Delete from this machine" (POST /history/delete). The sid (UUID-shaped) is only a lookup key. Paths are built from the Claude config dir (which must be the
 *  History root's parent, same realpath), each `projects/<dir>` holding `<sid>.jsonl`, and the sid; each parent must resolve (realpath) inside the config dir, re-checked
 *  right before its removal. Nothing is followed: links are removed as links. history.jsonl is rewritten under Claude Code's history lock (temp + rename, same mode),
 *  then appends that landed on the old file are carried over. Claude Deck's run logs lose the sid's lines. dryRun lists only and returns planId. A session that looks
 *  alive needs confirm (checked again right before removing). One delete at a time. Server-side copies are out of reach (DELETE_NOTE). */
export class SessionDeleter {
  private busy = false; private home: string;
  constructor(private opts: SessionDeleterOpts) { this.home = resolve(opts.home ?? homedir()); }
  /** home-relative, redacted */
  private show(p: string) { const h = this.home; return redactText(p === h ? '~' : p.startsWith(h + sep) ? `~/${p.slice(h.length + 1).split(sep).join('/')}` : p, 600); }
  /** a path for an error reason: home-relative, else no path at all */
  private label(p: string, kind = 'an item') { const s = this.show(p); return s.startsWith('~') ? s : kind; }
  private log(what: string, e: unknown) { console.error(`[deck] history delete: ${what}: ${redactText(String((e as Error)?.message ?? e), 500)}`); }
  async delete(raw: unknown): Promise<Reply> {
    const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    if (this.opts.demo) return fail(409, 'unavailable', T.demo);
    const sid = typeof b.sid === 'string' ? b.sid : '';
    if (!SESSION_UUID.test(sid)) return fail(400, 'bad-sid', T.sid);
    for (const k of ['dryRun', 'confirm']) if (b[k] !== undefined && typeof b[k] !== 'boolean') return fail(400, 'bad-flag', T.flag(k));
    if (b.planId !== undefined && (typeof b.planId !== 'string' || b.planId.length > 128)) return fail(400, 'bad-plan', T.plan);
    const hr = resolve(this.opts.historyRoot), cfg = this.opts.configDir && resolve(this.opts.configDir);
    if (!cfg || basename(hr) !== 'projects') return fail(409, 'unavailable', T.root);
    const R = await realpath(cfg).catch(() => null), RP = await realpath(dirname(hr)).catch(() => null); if (!R || R !== RP) return fail(409, 'unavailable', T.root);
    const loc = await this.opts.locate(sid); if (!loc) return fail(404, 'not-found', T.notFound);
    const file = resolve(loc.file), folder = basename(dirname(file));
    if (dirname(dirname(file)) !== hr || basename(file) !== `${sid}.jsonl` || folder === '.' || folder === '..' || /[\\/]/.test(folder)) return fail(409, 'unsafe-path', T.outside(this.label(file, 'the transcript')));
    const dry = b.dryRun === true, confirm = b.confirm === true;
    if (!dry && !confirm) { const why = await this.alive(cfg, sid, [folder]); if (why) return fail(409, 'confirm-required', why); }
    if (!dry && this.busy) return fail(409, 'busy', T.busy);
    if (!dry) this.busy = true;
    try {
      let plan: { steps: Step[]; folders: string[]; transcripts: string[] };
      try { plan = await this.plan(cfg, R, sid); } catch (e) { if (e instanceof Outside) return fail(409, 'unsafe-path', T.outside(this.label(e.at, 'a folder'))); throw e; }
      const { steps, folders, transcripts } = plan, marked = !!this.opts.bookmarks?.get(sid);
      const items = [...steps.map((s) => s.item), { path: `${T.deck}${marked ? ', bookmark' : ''}`, kind: 'deck-data' as const }];
      const planId = createHash('sha256').update(JSON.stringify(items.map((i) => [i.kind, i.path, !!i.skipped]))).digest('base64url').slice(0, 22);
      if (dry) return { status: 200, body: { sid, dryRun: true, items, deleted: false, note: DELETE_NOTE, planId } };
      if (b.planId !== undefined && b.planId !== planId) return fail(409, 'changed', T.changed);
      if (!confirm) { const why = await this.alive(cfg, sid, folders); if (why) return fail(409, 'confirm-required', why); } // again, right before removing anything
      const done: HistoryDeleteItem[] = [], hist = steps.find((s) => s.act === 'history');
      let release: (() => Promise<void>) | undefined;
      if (hist) { try { release = await this.lockHistory(hist.path); } catch (e: any) { if (e?.code === 'ELOCKED') return fail(409, 'busy', T.locked); this.log('history lock', e); return fail(500, 'delete-failed', T.failed('~/…/history.jsonl', String(e?.code ?? 'error')), []); } }
      try {
        // the transcripts go last, so a failure part-way leaves the session in History to retry
        const order = [...steps.filter((s) => s.act === 'rm' && s.item.kind !== 'transcript'), ...steps.filter((s) => s.act === 'log'), ...steps.filter((s) => s.act === 'history'), ...steps.filter((s) => s.item.kind === 'transcript')];
        for (const s of order) {
          try {
            if (s.parent && !(await this.inside(R, s.parent))) continue; // parent vanished: nothing left to delete there
            if (s.act === 'rm') { if (s.link || !s.dir) await (s.link ? unlinkLink(s.path) : unlink(s.path).catch((e) => (gone(e) ? undefined : Promise.reject(e)))); else await rmTree(s.path); }
            else if (s.act === 'log') rewriteSync(s.path, sid, logLineOf(sid));
            else if (s.act === 'history') await this.rewriteHistory(s.path, sid);
            done.push(s.item);
          } catch (e: any) {
            if (e instanceof Outside) return fail(409, 'unsafe-path', T.outside(this.label(e.at, 'a folder')), done);
            this.log(s.path, e); return fail(500, 'delete-failed', T.failed(this.label(s.path), String(e?.code ?? 'error')), done);
          }
        }
      } finally { await release?.(); }
      for (const s of steps) if (s.act === 'rm' && (await lstat(s.path).then(() => true, () => false))) return fail(500, 'delete-failed', T.left(this.label(s.path)), done);
      try { this.opts.bookmarks?.delete(sid); } catch (e) { this.log('bookmark', e); }
      this.opts.forget?.(sid, transcripts);
      return { status: 200, body: { sid, dryRun: false, items, deleted: true, note: DELETE_NOTE, planId } };
    } finally { if (!dry) this.busy = false; }
  }
  /** realpath of dir inside R (true), missing (false), else throws Outside */
  private async inside(R: string, dir: string) {
    const r = await realpath(dir).catch((e) => (gone(e) || e?.code === 'ENOTDIR' ? null : Promise.reject(e)));
    if (r && r !== R && !r.startsWith(R + sep)) throw new Outside(dir);
    return !!r;
  }
  /** why the session may still be running (needs confirm), or null */
  private async alive(cfg: string, sid: string, folders: string[]): Promise<string | null> {
    if (this.opts.isLive?.(sid)) return T.live;
    if (this.opts.openedRecently?.(sid)) return T.recent;
    const alive = this.opts.pidAlive ?? ((pid: number) => { try { process.kill(pid, 0); return true; } catch (e: any) { return e?.code === 'EPERM'; } });
    const reg = join(cfg, 'sessions');
    for (const n of await readdir(reg).catch(() => [] as string[])) {
      if (!/^\d{1,10}\.json$/.test(n)) continue;
      const f = join(reg, n), st = await lstat(f).catch(() => null); if (!st?.isFile() || st.size > DELETE_CAP.registry) continue;
      let j: any; try { j = JSON.parse(await readFile(f, 'utf8')); } catch { continue; }
      if (j?.sessionId === sid && Number.isInteger(j.pid) && j.pid > 0 && alive(j.pid)) return T.running;
    }
    const now = this.opts.now?.() ?? Date.now();
    let m = await newest(join(cfg, 'session-env', sid));
    for (const d of folders) m = Math.max(m, ...(await Promise.all([lstat(join(cfg, 'projects', d, `${sid}.jsonl`)).then((s) => s.mtimeMs, () => 0), newest(join(cfg, 'projects', d, sid))])));
    return now - m < OPENER_CAP.liveMs ? T.touched : null;
  }
  /** what exists for sid, in display order. Throws Outside when a parent dir resolves outside the config dir. */
  private async plan(cfg: string, R: string, sid: string) {
    const steps: Step[] = [], folders: string[] = [], transcripts: string[] = [], tail: Step[] = [];
    const at = async (p: string, kind?: HistoryDeleteItem['kind']): Promise<Step | null> => {
      const st = await lstat(p).catch(() => null); if (!st) return null;
      const dir = st.isDirectory(), link = st.isSymbolicLink();
      return { item: { path: this.show(p), kind: kind ?? (dir ? 'dir' : 'file'), bytes: dir ? await du(p) : st.size }, path: p, act: 'rm', dir, link, parent: dirname(p) };
    };
    const pr = join(cfg, 'projects'); await this.inside(R, pr);
    for (const folder of (await readdir(pr).catch(() => [] as string[])).sort()) {
      const pd = join(pr, folder), t = await lstat(join(pd, `${sid}.jsonl`)).catch(() => null); if (!t || t.isDirectory()) continue;
      await this.inside(R, pd); folders.push(folder);
      const s = await at(join(pd, `${sid}.jsonl`), 'transcript'); if (s) { steps.push(s); transcripts.push(s.path); }
      const d = await at(join(pd, sid)); if (d) tail.push(d);
      for (const n of (await readdir(pd)).sort()) if (n.startsWith(`${sid}.orphaned-`) || n.startsWith(`${sid}.jsonl.superseded-`)) { const x = await at(join(pd, n)); if (x) tail.push(x); }
    }
    steps.push(...tail);
    const add = async (p: string) => { const s = await at(p); if (s) steps.push(s); };
    for (const d of PER_SESSION_DIRS) if (await this.inside(R, join(cfg, d))) await add(join(cfg, d, sid));
    if (await this.inside(R, join(cfg, 'debug'))) await add(join(cfg, 'debug', `${sid}.txt`));
    for (const [d, ok] of [['todos', (n: string) => n.startsWith(`${sid}-`) && n.endsWith('.json')], ['telemetry', (n: string) => n.endsWith('.json') && n.split('.').slice(1, -1).includes(sid)]] as const)
      if (await this.inside(R, join(cfg, d))) for (const n of (await readdir(join(cfg, d))).sort()) if (ok(n)) await add(join(cfg, d, n));
    for (const f of folders) steps.push(...(await this.scratch(f, sid)));
    const hf = join(cfg, 'history.jsonl'), hs = await lstat(hf).catch(() => null);
    if (hs?.isFile()) {
      if (hs.size > DELETE_CAP.history) steps.push({ item: { path: this.show(hf), kind: 'history-lines', bytes: hs.size, skipped: T.big }, path: hf, act: 'none' });
      else { const r = dropSessionLines(await readFile(hf), sid); if (r.lines) steps.push({ item: { path: this.show(hf), kind: 'history-lines', bytes: r.bytes, lines: r.lines }, path: hf, act: 'history', parent: cfg }); }
    }
    steps.push(...(await this.logs(sid)));
    return { steps, folders, transcripts };
  }
  /** Claude Deck run logs with lines of sid (the current one too: JsonlLog opens the file per event with appendFileSync, and rewriteSync cannot interleave with it) */
  private async logs(sid: string): Promise<Step[]> {
    const dir = this.opts.logDir; if (!dir) return [];
    const out: Step[] = [];
    for (const n of (await readdir(dir).catch(() => [] as string[])).sort()) {
      if (!/^run-[\w.-]+\.jsonl$/.test(n)) continue;
      const f = join(dir, n), st = await lstat(f).catch(() => null); if (!st?.isFile()) continue;
      if (st.size > DELETE_CAP.log) { out.push({ item: { path: this.show(f), kind: 'deck-data', bytes: st.size, skipped: T.big }, path: f, act: 'none' }); continue; }
      const r = dropSessionLines(await readFile(f), sid, logLineOf(sid)); if (!r.lines) continue;
      out.push({ item: { path: this.show(f), kind: 'deck-data', bytes: r.bytes, lines: r.lines }, path: f, act: 'log' });
    }
    return out;
  }
  /** the session scratchpad `<root>/claude-<uid>/<folder>/<sid>/`: only real dirs (no links) owned by this user and not group/other-writable */
  private async scratch(folder: string, sid: string): Promise<Step[]> {
    const uid = this.opts.uid ?? process.getuid?.(); if (uid === undefined) return [];
    const out: Step[] = [], seen = new Set<string>(), mine = async (p: string) => { const s = await lstat(p).catch(() => null); return !!s?.isDirectory() && s.uid === uid && (s.mode & 0o022) === 0; };
    for (const b of this.opts.scratchRoots ?? []) {
      const rb = await realpath(b).catch(() => null); if (!rb) continue;
      const d = join(rb, `claude-${uid}`), p = join(d, folder, sid);
      if (seen.has(p) || !(await mine(d)) || !(await mine(join(d, folder))) || !(await mine(p))) continue;
      seen.add(p); out.push({ item: { path: this.show(p), kind: 'dir', bytes: await du(p) }, path: p, act: 'rm', dir: true, link: false });
    }
    return out;
  }
  /** Claude Code's history lock (proper-lockfile layout: a `<file>.lock` dir, stale after 10 s, refreshed while held). ELOCKED when another holder keeps it. */
  private async lockHistory(f: string): Promise<() => Promise<void>> {
    const l = `${f}.lock`;
    for (let t = 0; ; t++) {
      try { await mkdir(l); break; } catch (e: any) {
        if (e?.code !== 'EEXIST') throw e;
        const st = await lstat(l).catch(() => null);
        if (st?.isDirectory() && Date.now() - st.mtimeMs > DELETE_CAP.lockStaleMs && t < DELETE_CAP.lockTries) { await rmdir(l).catch(() => {}); continue; }
        if (t >= DELETE_CAP.lockTries) throw Object.assign(new Error('history.jsonl is locked'), { code: 'ELOCKED' });
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    const keep = setInterval(() => { const d = new Date(); void utimes(l, d, d).catch(() => {}); }, DELETE_CAP.lockStaleMs / 2); keep.unref();
    return async () => { clearInterval(keep); await rmdir(l).catch(() => {}); };
  }
  /** history.jsonl without this session's lines: temp file in the same dir (same mode) + rename. An fd stays on the old file, so anything appended to it before
   *  writers see the new one is carried over (filtered, whole lines) until it stops growing. */
  private async rewriteHistory(f: string, sid: string) {
    const fh = await open(f, 'r');
    try {
      const st = await fh.stat(); if (!st.isFile()) return;
      const buf = Buffer.alloc(st.size); await fh.read(buf, 0, st.size, 0);
      const r = dropSessionLines(buf, sid); if (!r.lines) return;
      const mode = st.mode & 0o777, tmp = join(dirname(f), `.history.jsonl.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
      try {
        await writeFile(tmp, r.out, { flag: 'wx', mode }); await chmod(tmp, mode);
        await this.opts.beforeRename?.();
        const cur = await lstat(f); if (!cur.isFile() || cur.ino !== st.ino) throw Object.assign(new Error('history.jsonl was replaced meanwhile'), { code: 'ECHANGED' });
        await rename(tmp, f);
      } catch (e) { await unlink(tmp).catch(() => {}); throw e; }
      let off = st.size, rest = Buffer.alloc(0);
      for (let calm = 0; calm < 3;) { // drain the old inode: appends that raced the rename
        const n = (await fh.stat()).size - off;
        if (n <= 0) { calm++; await new Promise((res) => setTimeout(res, 20)); continue; }
        calm = 0; const c = Buffer.alloc(n); await fh.read(c, 0, n, off); off += n;
        const all = Buffer.concat([rest, c]), cut = all.lastIndexOf(10) + 1; rest = all.subarray(cut);
        const keep = dropSessionLines(all.subarray(0, cut), sid).out; if (keep.length) await appendFile(f, keep);
      }
      if (rest.length) await appendFile(f, dropSessionLines(rest, sid).out);
    } finally { await fh.close(); }
  }
}
