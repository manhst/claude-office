import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, lstatSync, lutimesSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { BookmarkStore } from '../src/bookmarks.js';
import { HistoryIndex } from '../src/history.js';
import { ModelReport } from '../src/modelReport.js';
import { DELETE_NOTE, SessionDeleter, dropSessionLines, logLineOf, type SessionDeleterOpts } from '../src/historyDelete.js';

const SID = '7f3c2a10-5b6e-4d21-9a8f-0c1d2e3f4a05', OTHER = '11111111-2222-4333-8444-555555555555', TEL = '99999999-8888-4777-8666-555555555555', NOW = Date.now(), OLD = (NOW - 3_600_000) / 1000;
const ts = (m: number) => new Date(NOW - 7_200_000 + m * 60_000).toISOString();
const lines = (sid: string) => [{ type: 'user', isSidechain: false, message: { role: 'user', content: `hello from ${sid}` }, timestamp: ts(0), cwd: '/w/shop', sessionId: sid, entrypoint: 'cli' },
  { type: 'assistant', isSidechain: false, message: { model: 'claude-opus-5-5', id: `m-${sid}`, role: 'assistant', content: [{ type: 'text', text: 'ok' }] }, timestamp: ts(1), cwd: '/w/shop', entrypoint: 'cli' }]
  .map((l) => JSON.stringify(l)).join('\n') + '\n';
const hl = (sid: string, display: string) => JSON.stringify({ display, pastedContents: {}, timestamp: 1, project: '/w/shop', sessionId: sid });
const LOG = [{ t: 'session.turn', turn: { sid: OTHER, turnId: '1', prompt: `about ${SID}` } }, { t: 'session.turn', turn: { sid: SID, turnId: '1', prompt: 'secret plan' } }, { t: 'agent.spawned', id: 'a', sessionId: SID },
  { t: 'prompt.status', sid: SID, nonce: 'n', state: 'queued', ts: 1 }, { t: 'agent.state', id: 'b', state: 'idle' }].map((l) => JSON.stringify(l)).join('\n') + '\n';
const UID = process.getuid?.() ?? 0;
/** ages a tree (links themselves, never their targets) so it does not look freshly written */
const age = (p: string) => { const st = lstatSync(p); if (st.isSymbolicLink()) { lutimesSync(p, OLD, OLD); return; } if (st.isDirectory()) for (const n of readdirSync(p)) age(join(p, n)); utimesSync(p, OLD, OLD); };
/** w/.claude (config), w/outside (link targets), w/tmp/claude-<uid>/-w-shop/<SID> (scratchpad, 0700), w/logs (Claude Deck run logs); home = w */
function world() {
  const w = realpathSync(mkdtempSync(join(tmpdir(), 'deck-del-'))), cfg = join(w, '.claude'), pd = join(cfg, 'projects', '-w-shop'), put = (p: string, s = 'x') => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, s); };
  put(join(pd, `${SID}.jsonl`), lines(SID)); put(join(pd, `${OTHER}.jsonl`), lines(OTHER));
  put(join(pd, SID, 'subagents', 'agent-a1.jsonl'), lines(SID)); put(join(pd, SID, 'tool-results', 'r.txt'), 'abc');
  put(join(w, 'outside', 'keep.txt'), 'precious'); symlinkSync(join(w, 'outside'), join(pd, SID, 'link')); symlinkSync(join(w, 'outside', 'keep.txt'), join(pd, SID, 'filelink'));
  put(join(pd, `${SID}.orphaned-1700000000`)); put(join(pd, `${SID}.jsonl.superseded-1700000001`)); put(join(pd, `${OTHER}.orphaned-1`));
  put(join(cfg, 'file-history', SID, 'h@v1'), 'v1'); put(join(cfg, 'file-history', OTHER, 'h@v1'));
  mkdirSync(join(cfg, 'session-env', SID), { recursive: true }); mkdirSync(join(cfg, 'session-env', OTHER), { recursive: true });
  put(join(cfg, 'uploads', SID, 'a.png'), 'png');
  put(join(cfg, 'debug', `${SID}.txt`), 'dbg'); put(join(cfg, 'debug', `${OTHER}.txt`)); symlinkSync(join(cfg, 'debug', `${SID}.txt`), join(cfg, 'debug', 'latest'));
  put(join(cfg, 'todos', `${SID}-agent-${SID}.json`), '[]'); put(join(cfg, 'todos', `${OTHER}-agent-${SID}.json`));
  put(join(cfg, 'telemetry', `1p_failed_events.${SID}.${TEL}.json`), '{}'); put(join(cfg, 'telemetry', `1p_failed_events.${OTHER}.${TEL}.json`));
  put(join(cfg, 'sessions', '4242.json'), JSON.stringify({ pid: 4242, sessionId: SID, cwd: '/w/shop' }));
  const sp = join(w, 'tmp', `claude-${UID}`); put(join(sp, '-w-shop', SID, 'scratchpad', 'n.txt'), 'note'); put(join(sp, '-w-shop', OTHER, 'n.txt'));
  for (const d of [sp, join(sp, '-w-shop'), join(sp, '-w-shop', SID)]) chmodSync(d, 0o700);
  put(join(w, 'logs', 'run-2026-11-01.jsonl'), LOG); put(join(w, 'logs', 'run-2026-11-02.jsonl'), `${JSON.stringify({ t: 'agent.state', id: 'x', state: 'idle' })}\n`);
  const hist = [hl(OTHER, 'first'), hl(SID, 'mine 1'), hl(OTHER, `mentions ${SID} but is not it`), '{broken json ' + SID, hl(SID, 'mine 2'), hl(OTHER, 'last, no newline')].join('\n');
  writeFileSync(join(cfg, 'history.jsonl'), hist, { mode: 0o600 });
  age(join(cfg, 'projects')); age(join(cfg, 'session-env'));
  return { w, cfg, pd, hist };
}
/** every path under w (links not followed) with its content hash */
function tree(w: string) {
  const out: Record<string, string> = {};
  const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n), st = lstatSync(p); out[relative(w, p)] = st.isSymbolicLink() ? 'link' : st.isDirectory() ? 'dir' : createHash('sha1').update(readFileSync(p)).digest('hex'); if (st.isDirectory() && !st.isSymbolicLink()) walk(p); } };
  walk(w); return out;
}
function deleter(x: ReturnType<typeof world>, o: Partial<SessionDeleterOpts> = {}) {
  const bookmarks = new BookmarkStore(join(x.w, 'bm.json')), history = new HistoryIndex(join(x.cfg, 'projects'), { bookmarks, home: x.w, ttlMs: 3_600_000 });
  const report = new ModelReport(join(x.cfg, 'projects'), { ttlMs: 3_600_000 });
  const d = new SessionDeleter({ historyRoot: join(x.cfg, 'projects'), configDir: x.cfg, home: x.w, scratchRoots: [join(x.w, 'tmp')], uid: UID, logDir: join(x.w, 'logs'), pidAlive: () => false, bookmarks,
    locate: (sid) => history.locate(sid), forget: (sid, files) => { history.forget(sid, files); for (const f of files) report.forget(f); }, ...o });
  return { d, history, report, bookmarks };
}
const ITEMS = [
  { path: `~/.claude/projects/-w-shop/${SID}.jsonl`, kind: 'transcript', bytes: lines(SID).length },
  { path: `~/.claude/projects/-w-shop/${SID}`, kind: 'dir', bytes: expect.any(Number) },
  { path: `~/.claude/projects/-w-shop/${SID}.jsonl.superseded-1700000001`, kind: 'file', bytes: 1 },
  { path: `~/.claude/projects/-w-shop/${SID}.orphaned-1700000000`, kind: 'file', bytes: 1 },
  { path: `~/.claude/file-history/${SID}`, kind: 'dir', bytes: 2 },
  { path: `~/.claude/session-env/${SID}`, kind: 'dir', bytes: 0 },
  { path: `~/.claude/uploads/${SID}`, kind: 'dir', bytes: 3 },
  { path: `~/.claude/debug/${SID}.txt`, kind: 'file', bytes: 3 },
  { path: `~/.claude/todos/${SID}-agent-${SID}.json`, kind: 'file', bytes: 2 },
  { path: `~/.claude/telemetry/1p_failed_events.${SID}.${TEL}.json`, kind: 'file', bytes: 2 },
  { path: `~/tmp/claude-${UID}/-w-shop/${SID}`, kind: 'dir', bytes: 4 },
  { path: '~/.claude/history.jsonl', kind: 'history-lines', bytes: hl(SID, 'mine 1').length + hl(SID, 'mine 2').length + 2, lines: 2 },
  { path: '~/logs/run-2026-11-01.jsonl', kind: 'deck-data', bytes: expect.any(Number), lines: 3 },
  { path: 'Claude Deck: History index, Performance cache, bookmark', kind: 'deck-data' },
];

describe('dropSessionLines', () => {
  it('drops only lines whose JSON sessionId is the sid; other bytes stay identical (CRLF, bad JSON, no final newline)', () => {
    const b = Buffer.from(`${hl(OTHER, 'a')}\r\n${hl(SID, 'b')}\n{"sessionId":"${SID}"}\nnot json ${SID}\n${hl(OTHER, 'é')}`);
    const r = dropSessionLines(b, SID);
    expect(r.lines).toBe(2); expect(r.out.toString()).toBe(`${hl(OTHER, 'a')}\r\nnot json ${SID}\n${hl(OTHER, 'é')}`);
    expect(r.bytes).toBe(b.length - r.out.length); expect(dropSessionLines(b, '00000000-0000-4000-8000-000000000000').out).toBe(b);
  });
  it('Claude Deck log lines: sid, sessionId or turn.sid; a mention in another session\'s text stays', () => {
    const r = dropSessionLines(Buffer.from(LOG), SID, logLineOf(SID));
    expect(r.lines).toBe(3); expect(r.out.toString().split('\n').filter(Boolean).map((l) => JSON.parse(l).t)).toEqual(['session.turn', 'agent.state']);
  });
});

describe('SessionDeleter', () => {
  it('dry run lists exactly the local items with a planId and changes nothing', async () => {
    const x = world(), { d, bookmarks, history } = deleter(x); await history.refresh(); bookmarks.set(SID, 'n');
    const before = tree(x.w), r: any = await d.delete({ sid: SID, dryRun: true });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ sid: SID, dryRun: true, deleted: false, note: DELETE_NOTE, items: ITEMS, planId: expect.stringMatching(/^[\w-]{22}$/) });
    expect(tree(x.w)).toEqual(before); expect(bookmarks.get(SID)).toBeTruthy(); expect((await history.list()).sessions.map((s) => s.sid)).toContain(SID);
    expect((await d.delete({ sid: SID, dryRun: true })).body).toMatchObject({ planId: r.body.planId }); // stable
  });
  it('deletes the items, keeps everything else byte-identical, removes links (not targets) and drops Claude Deck data', async () => {
    const x = world(), { d, bookmarks, history, report } = deleter(x); await history.refresh(); bookmarks.set(SID, 'n'); bookmarks.set(OTHER);
    expect((await report.report({ days: 0 })).sessions).toBe(2);
    const before = tree(x.w), planId = ((await d.delete({ sid: SID, dryRun: true })).body as any).planId, r = await d.delete({ sid: SID, planId });
    expect(r).toEqual({ status: 200, body: { sid: SID, dryRun: false, deleted: true, note: DELETE_NOTE, items: ITEMS, planId } });
    const after = tree(x.w), gone = Object.keys(before).filter((k) => !(k in after)).sort();
    expect(gone.every((k) => k.includes(SID) && !k.includes(OTHER))).toBe(true);
    for (const k of Object.keys(after)) if (!['.claude/history.jsonl', 'bm.json', 'logs/run-2026-11-01.jsonl'].includes(k)) expect(after[k]).toBe(before[k]); // nothing else changed
    expect(readFileSync(join(x.w, 'outside', 'keep.txt'), 'utf8')).toBe('precious'); expect(lstatSync(join(x.cfg, 'debug', 'latest')).isSymbolicLink()).toBe(true);
    expect(existsSync(join(x.pd, `${SID}.jsonl`))).toBe(false); expect(existsSync(join(x.pd, SID))).toBe(false); expect(existsSync(join(x.cfg, 'session-env', SID))).toBe(false);
    expect(readFileSync(join(x.cfg, 'history.jsonl'), 'utf8')).toBe([hl(OTHER, 'first'), hl(OTHER, `mentions ${SID} but is not it`), '{broken json ' + SID, hl(OTHER, 'last, no newline')].join('\n'));
    expect(statSync(join(x.cfg, 'history.jsonl')).mode & 0o777).toBe(0o600); expect(readdirSync(x.cfg).filter((n) => n.endsWith('.tmp') || n.endsWith('.lock'))).toEqual([]);
    expect(readFileSync(join(x.w, 'logs', 'run-2026-11-01.jsonl'), 'utf8')).toBe(LOG.split('\n').filter((l, i) => i === 0 || i === 4 || i === 5).join('\n'));
    expect(bookmarks.get(SID)).toBeUndefined(); expect(bookmarks.get(OTHER)).toBeTruthy();
    expect((await history.list()).sessions.map((s) => s.sid)).toEqual([OTHER]); // at once, without a rescan
    expect((await report.report({ days: 0 })).sessions).toBe(1);
    expect((await d.delete({ sid: SID })).status).toBe(404);
  });
  it('every projects/<dir>/<sid>.jsonl copy goes; history.jsonl is not rewritten when it has no line of the session', async () => {
    const x = world(), pb = join(x.cfg, 'projects', '-w-blog'); mkdirSync(join(pb, SID), { recursive: true }); writeFileSync(join(pb, `${SID}.jsonl`), lines(SID)); age(pb);
    writeFileSync(join(x.cfg, 'history.jsonl'), `${hl(OTHER, 'a')}\n`); utimesSync(join(x.cfg, 'history.jsonl'), OLD, OLD);
    const r: any = await deleter(x).d.delete({ sid: SID });
    expect(r.status).toBe(200); expect(r.body.items.filter((i: any) => i.kind === 'transcript').map((i: any) => i.path)).toEqual([`~/.claude/projects/-w-blog/${SID}.jsonl`, `~/.claude/projects/-w-shop/${SID}.jsonl`]);
    expect(r.body.items.some((i: any) => i.kind === 'history-lines')).toBe(false); expect(statSync(join(x.cfg, 'history.jsonl')).mtimeMs).toBe(OLD * 1000);
    expect(existsSync(join(pb, `${SID}.jsonl`)) || existsSync(join(pb, SID)) || existsSync(join(x.pd, `${SID}.jsonl`))).toBe(false);
  });
  it('a live, reopened, registered (pid alive) or recently written session needs confirm; dry run never does', async () => {
    const x = world(), cr = (reason: RegExp) => ({ status: 409, body: { error: 'confirm-required', reason: expect.stringMatching(reason) } });
    expect(await deleter(x, { isLive: () => true }).d.delete({ sid: SID })).toMatchObject(cr(/running in Claude Deck/));
    expect((await deleter(x, { isLive: () => true }).d.delete({ sid: SID, dryRun: true })).status).toBe(200);
    expect(await deleter(x, { openedRecently: () => true }).d.delete({ sid: SID })).toMatchObject(cr(/reopened/));
    const pids: number[] = []; expect(await deleter(x, { pidAlive: (p) => { pids.push(p); return true; } }).d.delete({ sid: SID })).toMatchObject(cr(/process registered/)); expect(pids).toEqual([4242]);
    for (const p of [join(x.pd, `${SID}.jsonl`), join(x.pd, SID, 'subagents', 'agent-a1.jsonl'), join(x.cfg, 'session-env', SID)]) {
      utimesSync(p, new Date(), new Date()); expect(await deleter(x).d.delete({ sid: SID })).toMatchObject(cr(/last 2 minutes/)); utimesSync(p, OLD, OLD);
    }
    expect(existsSync(join(x.pd, `${SID}.jsonl`))).toBe(true);
    expect(await deleter(x, { isLive: () => true, pidAlive: () => true }).d.delete({ sid: SID, confirm: true })).toMatchObject({ status: 200, body: { deleted: true } });
  });
  it('liveness is checked again right before removing (a session that comes alive while planning)', async () => {
    const x = world(); let n = 0;
    expect(await deleter(x, { isLive: () => n++ > 0 }).d.delete({ sid: SID })).toMatchObject({ status: 409, body: { error: 'confirm-required' } });
    expect(n).toBe(2); expect(existsSync(join(x.pd, `${SID}.jsonl`))).toBe(true);
  });
  it('a planId from an older preview gets 409 changed', async () => {
    const x = world(), { d } = deleter(x), planId = ((await d.delete({ sid: SID, dryRun: true })).body as any).planId;
    writeFileSync(join(x.cfg, 'uploads', `${SID}-not-it`), 'x'); mkdirSync(join(x.cfg, 'dev-mods', SID), { recursive: true });
    expect(await d.delete({ sid: SID, planId })).toEqual({ status: 409, body: { error: 'changed', reason: 'Files changed since the preview. Review the list again.' } });
    expect(existsSync(join(x.pd, `${SID}.jsonl`))).toBe(true);
    expect((await d.delete({ sid: SID, planId: 5 })).body).toMatchObject({ error: 'bad-plan' });
  });
  it('history.jsonl: an append that lands between the rewrite and the rename is kept (other sessions) or dropped (this one)', async () => {
    const x = world(), extra = `${hl(OTHER, 'appended late')}\n${hl(SID, 'mine late')}\n${hl(OTHER, 'appended later')}\n`;
    const r = await deleter(x, { beforeRename: () => { appendFileSync(join(x.cfg, 'history.jsonl'), `\n${extra}`); } }).d.delete({ sid: SID });
    expect(r.status).toBe(200);
    expect(readFileSync(join(x.cfg, 'history.jsonl'), 'utf8')).toBe([hl(OTHER, 'first'), hl(OTHER, `mentions ${SID} but is not it`), '{broken json ' + SID, hl(OTHER, 'last, no newline'), hl(OTHER, 'appended late'), hl(OTHER, 'appended later'), ''].join('\n'));
  });
  it('history.jsonl lock: a held lock answers busy before anything is deleted; a stale one is taken over and released', async () => {
    const x = world(), l = join(x.cfg, 'history.jsonl.lock'); mkdirSync(l); const before = tree(x.w);
    expect(await deleter(x).d.delete({ sid: SID })).toMatchObject({ status: 409, body: { error: 'busy', reason: expect.stringMatching(/prompt history/) } });
    expect(tree(x.w)).toEqual(before);
    utimesSync(l, OLD, OLD); expect((await deleter(x).d.delete({ sid: SID })).status).toBe(200); expect(existsSync(l)).toBe(false);
  }, 10000);
  it('a part-way failure reports what was deleted, no absolute path, and keeps the transcript', async () => {
    const x = world(), u = join(x.cfg, 'uploads', SID); chmodSync(u, 0o500);
    try {
      const r: any = await deleter(x).d.delete({ sid: SID });
      expect(r.status).toBe(500); expect(r.body).toMatchObject({ error: 'delete-failed', reason: expect.stringContaining(`~/.claude/uploads/${SID}`) });
      expect(r.body.reason).not.toContain(x.w); expect(r.body.deleted.map((i: any) => i.path)).toContain(`~/.claude/file-history/${SID}`);
      expect(r.body.deleted.some((i: any) => i.kind === 'transcript')).toBe(false); expect(existsSync(join(x.pd, `${SID}.jsonl`))).toBe(true);
    } finally { chmodSync(u, 0o700); }
  });
  it('refuses bad input, unknown sids, demo, a History root that is not the config dir and paths outside the config dir', async () => {
    const x = world(), { d } = deleter(x); mkdirSync(join(x.w, 'other', 'projects'), { recursive: true }); const before = tree(x.w);
    for (const sid of ['../x', 'abc', `${SID}/..`, 42]) expect((await d.delete({ sid })).body).toMatchObject({ error: 'bad-sid' });
    expect((await d.delete({ sid: SID, confirm: 'yes' })).body).toMatchObject({ error: 'bad-flag' });
    expect((await d.delete({ sid: SID, dryRun: 1 })).body).toMatchObject({ error: 'bad-flag' });
    expect(await d.delete({ sid: '22222222-2222-4222-8222-222222222222' })).toMatchObject({ status: 404, body: { error: 'not-found' } });
    expect(await deleter(x, { demo: true }).d.delete({ sid: SID })).toMatchObject({ status: 409, body: { error: 'unavailable' } });
    expect(await deleter(x, { configDir: undefined }).d.delete({ sid: SID, dryRun: true })).toMatchObject({ status: 409, body: { error: 'unavailable' } });
    expect(await deleter(x, { configDir: join(x.w, 'outside') }).d.delete({ sid: SID, dryRun: true })).toMatchObject({ status: 409, body: { error: 'unavailable' } });
    expect(await deleter(x, { historyRoot: join(x.w, 'other', 'projects') }).d.delete({ sid: SID, dryRun: true })).toMatchObject({ status: 409, body: { error: 'unavailable' } });
    for (const file of [join(x.w, 'outside', 'p', `${SID}.jsonl`), join(x.pd, `${OTHER}.jsonl`), join(x.cfg, 'projects', `${SID}.jsonl`), join(x.cfg, `${SID}.jsonl`)])
      expect(await deleter(x, { locate: async () => ({ file, mtimeMs: 0 }) }).d.delete({ sid: SID, confirm: true })).toMatchObject({ status: 409, body: { error: 'unsafe-path' } });
    expect(tree(x.w)).toEqual(before);
  });
  it('a project folder or per-session parent that is a symlink out of the config dir is refused; nothing is deleted', async () => {
    const x = world(), ext = join(x.w, 'outside', 'proj');
    mkdirSync(ext); writeFileSync(join(ext, `${SID}.jsonl`), lines(SID)); utimesSync(join(ext, `${SID}.jsonl`), OLD, OLD); symlinkSync(ext, join(x.cfg, 'projects', '-w-ext'));
    const before = tree(x.w), r = await deleter(x).d.delete({ sid: SID, confirm: true });
    expect(r).toMatchObject({ status: 409, body: { error: 'unsafe-path', reason: expect.stringContaining('~/.claude/projects/-w-ext') } });
    const y = world(); mkdirSync(join(y.w, 'outside', 'up', SID), { recursive: true }); symlinkSync(join(y.w, 'outside', 'up'), join(y.cfg, 'dev-mods'));
    const b2 = tree(y.w), r2 = await deleter(y).d.delete({ sid: SID });
    expect(r2.body).toMatchObject({ error: 'unsafe-path', reason: expect.stringContaining('~/.claude/dev-mods') });
    expect(tree(x.w)).toEqual(before); expect(tree(y.w)).toEqual(b2);
  });
  it('a symlinked session entry is removed as a link; a linked, shared or group-writable scratchpad is skipped', async () => {
    const x = world(), tgt = join(x.w, 'outside', 'fh');
    mkdirSync(tgt); writeFileSync(join(tgt, 'f'), 'keep'); mkdirSync(join(x.cfg, 'dev-mods')); symlinkSync(tgt, join(x.cfg, 'dev-mods', SID));
    const r: any = await deleter(x).d.delete({ sid: SID });
    expect(r.status).toBe(200); expect(r.body.items).toContainEqual({ path: `~/.claude/dev-mods/${SID}`, kind: 'file', bytes: expect.any(Number) });
    expect(existsSync(join(x.cfg, 'dev-mods', SID))).toBe(false); expect(readFileSync(join(tgt, 'f'), 'utf8')).toBe('keep');
    const y = world(), sy = join(y.w, 'tmp', `claude-${UID}`, '-w-shop'), alt = join(y.w, 'outside', 'sp');
    mkdirSync(alt); writeFileSync(join(alt, 'n'), 'keep'); rmSync(join(sy, SID), { recursive: true }); symlinkSync(alt, join(sy, SID));
    const r2: any = await deleter(y).d.delete({ sid: SID });
    expect(r2.body.items.some((i: any) => i.path.includes('tmp/claude-'))).toBe(false); expect(lstatSync(join(sy, SID)).isSymbolicLink()).toBe(true); expect(readFileSync(join(alt, 'n'), 'utf8')).toBe('keep');
    const z = world(); chmodSync(join(z.w, 'tmp', `claude-${UID}`, '-w-shop'), 0o775);
    expect(((await deleter(z).d.delete({ sid: SID, dryRun: true })).body as any).items.some((i: any) => i.path.includes('tmp/claude-'))).toBe(false);
  });
  it('one delete at a time', async () => {
    const x = world(), { d } = deleter(x);
    const [a, b] = await Promise.all([d.delete({ sid: SID }), d.delete({ sid: OTHER })]);
    expect([a.status, b.status].sort()).toEqual([200, 409]); expect([a, b].find((r) => r.status === 409)!.body).toMatchObject({ error: 'busy' });
  });
});

describe('forget during a scan', () => {
  it('HistoryIndex and ModelReport skip a forgotten transcript (even one a scan still lists) until a scan no longer finds it', async () => {
    const x = world(), f = join(x.pd, `${SID}.jsonl`), { history, report } = deleter(x);
    await history.refresh(); await report.refresh();
    history.forget(SID, [f]); report.forget(f); // the file is still on disk, as for a scan that listed it before the delete
    await history.refresh(); await report.refresh();
    expect((await history.list()).sessions.map((s) => s.sid)).toEqual([OTHER]); expect((await report.report({ days: 0 })).sessions).toBe(1);
    rmSync(f); await history.refresh(); await report.refresh(); // a full scan without it: forgotten no more
    writeFileSync(f, lines(SID)); await history.refresh(); await report.refresh();
    expect((await history.list()).sessions.map((s) => s.sid).sort()).toEqual([SID, OTHER].sort()); expect((await report.report({ days: 0, fresh: true })).sessions).toBe(2);
  });
});
