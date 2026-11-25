import { describe, it, expect, vi, afterEach } from 'vitest';
import { deleteSession, HistoryHttpError } from '../src/historyApi';
import { fmtBytes, deleteItemSize, deleteTotal, deletedText, deleteErrorText, deleteStepError, deleteKind, isDeleteChanged, dropSession, DELETE_KINDS, DELETE_NOTE, isOpenConfirm } from '../src/history';
import type { HistoryDeleteItem, HistoryHit, HistoryListResponse } from '../src/types';

const env = () => { vi.stubGlobal('sessionStorage', { getItem: () => '127.0.0.1:7777' }); vi.stubGlobal('location', { port: '7777', host: '127.0.0.1:7777' }); };
afterEach(() => vi.unstubAllGlobals());
const items: HistoryDeleteItem[] = [
  { path: '~/.claude/projects/-p/s1.jsonl', kind: 'transcript', bytes: 1_200_000 }, { path: '~/.claude/projects/-p/s1', kind: 'dir', bytes: 300_000 },
  { path: '~/.claude/history.jsonl', kind: 'history-lines', lines: 3 }, { path: 'Claude Deck bookmark', kind: 'deck-data' },
];

describe('"Delete from this machine" API', () => {
  it('deleteSession: POST JSON {sid, dryRun?, confirm?} to /history/delete, token only in the header', async () => {
    env(); const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ sid: 's1', dryRun: true, items, deleted: false, note: DELETE_NOTE }) })); vi.stubGlobal('fetch', fetch);
    expect((await deleteSession('tok', { sid: 's1', dryRun: true })).items).toHaveLength(4);
    await deleteSession('tok', { sid: 's1', planId: 'p1' }); await deleteSession('tok', { sid: 's1', confirm: true, planId: 'p1' });
    const calls = fetch.mock.calls as unknown as Array<[string, { method: string; headers: Record<string, string>; body: string }]>;
    for (const [u, init] of calls) { expect(u).toBe('http://127.0.0.1:7777/history/delete'); expect(u).not.toContain('tok'); expect(init.method).toBe('POST'); expect(init.headers.authorization).toBe('Bearer tok'); expect(init.headers['content-type']).toBe('application/json'); expect(init.body).not.toContain('tok'); }
    expect(calls.map(([, i]) => JSON.parse(i.body))).toEqual([{ sid: 's1', dryRun: true }, { sid: 's1', planId: 'p1' }, { sid: 's1', confirm: true, planId: 'p1' }]);
  });
  it('failures keep the server {error, reason}; confirm-required is recognised', async () => {
    env();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ error: 'confirm-required', reason: 'This session is live in Claude Deck.' }) })));
    const e = await deleteSession('t', { sid: 's' }).catch((x) => x) as HistoryHttpError;
    expect(e).toBeInstanceOf(HistoryHttpError); expect(e).toMatchObject({ status: 409, error: 'confirm-required' }); expect(isOpenConfirm(e.error)).toBe(true);
    expect(deleteErrorText(e.status, e.error, e.reason)).toBe('This session is live in Claude Deck.');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ error: 'changed', reason: 'Files changed since the preview. Review the list again.' }) })));
    const c = await deleteSession('t', { sid: 's', planId: 'p' }).catch((x) => x) as HistoryHttpError; expect(isDeleteChanged(c.error)).toBe(true); expect(isOpenConfirm(c.error)).toBe(false); expect(c.deleted).toBeUndefined();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: 'delete-failed', reason: 'EACCES on ~/.claude/x', deleted: [items[0], { bogus: 1 }, null, 'x'] }) })));
    const f = await deleteSession('t', { sid: 's' }).catch((x) => x) as HistoryHttpError; // partial: well-formed items only
    expect(f).toMatchObject({ status: 500, error: 'delete-failed' }); expect(f.deleted).toEqual([items[0]]); expect(deleteStepError(false, f.status, f.error, f.reason)).toBe('Delete failed: EACCES on ~/.claude/x');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => { throw new SyntaxError('html'); } }))); // old orchestrator
    const o = await deleteSession('t', { sid: 's', dryRun: true }).catch((x) => x) as HistoryHttpError;
    expect(o.error).toBeUndefined(); expect(deleteErrorText(o.status, o.error)).toMatch(/doesn't support deleting/);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(deleteSession('t', { sid: 's' })).rejects.toMatchObject({ status: 0 });
  });
  it('error texts without a reason', () => {
    expect(deleteErrorText(503, 'unavailable')).toMatch(/demo or read-only/); expect(deleteErrorText(409, 'busy')).toMatch(/another delete.*prompt history/);
    expect(deleteErrorText(409, 'busy', "Claude Code is writing its prompt history right now; try again in a moment.")).toMatch(/^Claude Code is writing/); expect(deleteErrorText(409, 'changed')).toMatch(/Review the list again/);
    expect(deleteErrorText(404, 'not-found')).toMatch(/already be deleted/); expect(deleteErrorText(0)).toMatch(/reach/); expect(deleteErrorText(401)).toMatch(/ui-url\.txt/);
    expect(deleteErrorText(-1)).toMatch(/can't be read/); expect(deleteErrorText(500)).toBe('HTTP 500.'); expect(deleteErrorText(400, 'bad-sid')).toBe('bad-sid.');
    expect(deleteStepError(true, 0)).toMatch(/^Preview failed: .*reach/); expect(deleteStepError(false, 500, 'delete-failed')).toBe('Delete failed: delete-failed.');
    expect(deleteErrorText(503, 'unavailable', 'Read-only in --demo.')).toBe('Read-only in --demo.'); // the server's reason wins
  });
});

describe('delete list formatting', () => {
  it('fmtBytes', () => {
    expect([0, -5, NaN, 1, 512, 1023, 1024, 1536, 10 * 1024, 1_500_000, 12 * 1024 ** 2, 1.25 * 1024 ** 3].map(fmtBytes))
      .toEqual(['0 B', '0 B', '0 B', '1 B', '512 B', '1023 B', '1 KB', '1.5 KB', '10 KB', '1.4 MB', '12 MB', '1.3 GB']);
  });
  it('item size, kinds, total and status', () => {
    expect(items.map(deleteItemSize)).toEqual(['1.1 MB', '293 KB', '3 lines', '']);
    expect(deleteItemSize({ path: 'x', kind: 'history-lines', lines: 1, bytes: 80 })).toBe('1 line · 80 B');
    expect(items.map((i) => DELETE_KINDS[i.kind])).toEqual(['transcript', 'folder', 'prompt history', 'Claude Deck data']);
    expect(deleteTotal(items)).toEqual({ n: 4, bytes: 1_500_000, skipped: 0 }); expect(deleteTotal([])).toEqual({ n: 0, bytes: 0, skipped: 0 });
    const sk = [...items, { path: '~/.claude/projects/-p/s1.jsonl.orphaned-1', kind: 'file', bytes: 9e9, skipped: 'too large' } as HistoryDeleteItem];
    expect(deleteTotal(sk)).toEqual({ n: 4, bytes: 1_500_000, skipped: 1 }); expect(deletedText({ items: sk })).toBe('Deleted 4 items (1.4 MB) from this machine.');
    expect(deleteKind({ path: '~/deck/orchestrator/logs/run-2026-11-23.jsonl', kind: 'deck-data', lines: 12 })).toBe('Claude Deck log lines');
    expect(deleteKind({ path: 'C:\\deck\\logs\\run-1.jsonl', kind: 'deck-data' })).toBe('Claude Deck log lines');
    expect(deleteKind({ path: 'Claude Deck bookmark', kind: 'deck-data' })).toBe('Claude Deck data'); expect(deleteKind(items[1])).toBe('folder');
    expect(deletedText({ items })).toBe('Deleted 4 items (1.4 MB) from this machine.');
    expect(deletedText({ items: [{ path: 'a', kind: 'file', bytes: 2048 }] })).toBe('Deleted 1 item (2 KB) from this machine.');
    expect(DELETE_NOTE).toBe("Deletes files on this machine only. Copies kept on Anthropic's servers for your organization (e.g. Claude Enterprise Compliance) are not affected.");
  });
  it('dropSession removes the row and adjusts total + bookmark count', () => {
    const hit = (sid: string, bm = false): HistoryHit => ({ sid, project: '/p', projectName: 'p', title: sid, startedAt: 0, endedAt: 0, prompts: 1, messages: 1, auto: false, subagents: 0, bytes: 1, ...(bm ? { bookmark: { at: 1 } } : {}) });
    const d: HistoryListResponse = { total: 10, offset: 0, sessions: [hit('a'), hit('b', true), hit('c')], projects: [], autoHidden: 0, scannedAt: 0, bookmarked: 2 };
    const r = dropSession(d, 'b'); expect(r.sessions.map((x) => x.sid)).toEqual(['a', 'c']); expect(r).toMatchObject({ total: 9, bookmarked: 1 }); expect(d.sessions).toHaveLength(3);
    expect(dropSession(d, 'a')).toMatchObject({ total: 9, bookmarked: 2 }); expect(dropSession(d, 'zz')).toBe(d);
  });
});
