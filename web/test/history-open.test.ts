import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchOpeners, openSession, HistoryHttpError } from '../src/historyApi';
import { loadOpener, saveOpener, OPENER_KEY, pickOpener, openerHint, openedText, openErrorText, isOpenConfirm, resumeCommand, permissionHint, OPEN_SLOW_MS, shOnlyPath, SH_ONLY_NOTE } from '../src/history';
import type { HistoryOpener } from '../src/types';

const iterm: HistoryOpener = { id: 'iterm', label: 'iTerm', kind: 'terminal', resumes: true };
const cursor: HistoryOpener = { id: 'cursor', label: 'Cursor', kind: 'editor', resumes: false };
const vscode: HistoryOpener = { id: 'vscode', label: 'VS Code', kind: 'editor', resumes: true };
const env = () => { vi.stubGlobal('sessionStorage', { getItem: () => '127.0.0.1:7777' }); vi.stubGlobal('location', { port: '7777', host: '127.0.0.1:7777' }); };
afterEach(() => vi.unstubAllGlobals());

describe('"Reopen" API', () => {
  it('fetchOpeners: GET with the token only in the Authorization header', async () => {
    env(); const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ openers: [iterm, cursor] }) })); vi.stubGlobal('fetch', fetch);
    expect((await fetchOpeners('tok')).openers.map((o) => o.id)).toEqual(['iterm', 'cursor']);
    const [u, init] = fetch.mock.calls[0] as unknown as [string, { method?: string; headers: Record<string, string>; cache: string }];
    expect(u).toBe('http://127.0.0.1:7777/history/openers'); expect(u).not.toContain('tok'); expect(init.method).toBeUndefined();
    expect(init.headers.authorization).toBe('Bearer tok'); expect(init.cache).toBe('no-store');
  });
  it('openSession: POST JSON {sid, app, confirm?}, token only in the header', async () => {
    env(); const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, app: 'iterm', project: '/p', resumed: true }) })); vi.stubGlobal('fetch', fetch);
    expect(await openSession('tok', { sid: 's1', app: 'iterm' })).toMatchObject({ ok: true, resumed: true });
    await openSession('tok', { sid: 's1', app: 'iterm', confirm: true });
    const calls = fetch.mock.calls as unknown as Array<[string, { method: string; headers: Record<string, string>; body: string }]>;
    for (const [u, init] of calls) { expect(u).toBe('http://127.0.0.1:7777/history/open'); expect(init.method).toBe('POST'); expect(init.headers.authorization).toBe('Bearer tok'); expect(init.headers['content-type']).toBe('application/json'); expect(init.body).not.toContain('tok'); }
    expect(calls.map(([, i]) => JSON.parse(i.body))).toEqual([{ sid: 's1', app: 'iterm' }, { sid: 's1', app: 'iterm', confirm: true }]);
  });
  it('failures keep the server {error, reason}; confirm-required is recognised', async () => {
    env();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ error: 'confirm-required', reason: 'This session is running in Claude Deck. Open another window?' }) })));
    const e = await openSession('t', { sid: 's', app: 'iterm' }).catch((x) => x) as HistoryHttpError;
    expect(e).toBeInstanceOf(HistoryHttpError); expect(e).toMatchObject({ status: 409, error: 'confirm-required' }); expect(isOpenConfirm(e.error)).toBe(true); expect(e.reason).toMatch(/is running/);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: 'project-missing', reason: 'The folder /p no longer exists.' }) })));
    const m = await openSession('t', { sid: 's', app: 'cursor' }).catch((x) => x) as HistoryHttpError;
    expect(isOpenConfirm(m.error)).toBe(false); expect(openErrorText(m.status, m.error, m.reason)).toBe('The folder /p no longer exists.');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => { throw new SyntaxError('html'); } }))); // old orchestrator: no JSON body
    const o = await fetchOpeners('t').catch((x) => x) as HistoryHttpError;
    expect(o).toMatchObject({ status: 404 }); expect(o.error).toBeUndefined(); expect(openErrorText(o.status, o.error)).toMatch(/doesn't support/);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(openSession('t', { sid: 's', app: 'iterm' })).rejects.toMatchObject({ status: 0 });
  });
  it('error text without a reason', () => {
    expect(openErrorText(0)).toMatch(/reach/); expect(openErrorText(401)).toMatch(/ui-url\.txt/); expect(openErrorText(-1)).toMatch(/can't be read/);
    expect(openErrorText(404, 'not-indexed')).toBe("Couldn't open: not-indexed."); expect(openErrorText(500)).toBe("Couldn't open (500).");
    expect(openErrorText(409, 'automation-pending')).toMatch(/asking.*Reopen/); expect(openErrorText(409, 'busy')).toMatch(/Another session/);
    expect(openErrorText(409, 'automation-pending', 'Click OK in the macOS Automation dialog.')).toBe('Click OK in the macOS Automation dialog.'); // the server's reason wins
    expect(isOpenConfirm('automation-pending')).toBe(false); expect(isOpenConfirm('busy')).toBe(false);
  });
  it('slow launch hint', () => { expect(OPEN_SLOW_MS).toBe(3000); expect(permissionHint('iTerm')).toBe('If macOS asks for permission to control iTerm, click OK.'); });
  it('sh/bash/zsh-only note for paths with \\ ! \' or control characters', () => {
    for (const p of ['/home/demo/shop-api', '/Users/me/My Project', '/Users/me/dự-án', '/tmp/$x;y']) expect(shOnlyPath(p)).toBe(false);
    for (const p of ['/tmp/a\\b', '/tmp/wow!', "/tmp/O'Brien", '/tmp/a\nb', '/tmp/tab\there', '/tmp/del\x7f']) expect(shOnlyPath(p)).toBe(true);
    expect(shOnlyPath(String.raw`C:\Users\me`)).toBe(false); // PowerShell command, not sh
    expect(SH_ONLY_NOTE).toBe('the path has special characters: use in bash/zsh only');
  });
});

describe('"Reopen" helpers', () => {
  it('remembers the last app (best effort)', () => {
    const m = new Map<string, string>(), store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(loadOpener(store)).toBeUndefined(); saveOpener('cursor', store); expect(m.get(OPENER_KEY)).toBe('cursor'); expect(loadOpener(store)).toBe('cursor');
    const bad = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); } };
    expect(loadOpener(bad)).toBeUndefined(); expect(() => saveOpener('iterm', bad)).not.toThrow(); expect(loadOpener(undefined)).toBeUndefined();
  });
  it('main button app: the last one if still offered, else the first; none when empty', () => {
    expect(pickOpener([iterm, cursor], 'cursor')).toBe(cursor); expect(pickOpener([iterm, cursor], 'terminal')).toBe(iterm); expect(pickOpener([iterm, cursor])).toBe(iterm); expect(pickOpener([], 'iterm')).toBeUndefined();
  });
  it('hint and status text', () => {
    expect(openerHint(cursor)).toBe('(opens the folder only)'); expect(openerHint(vscode)).toBe(''); expect(openerHint(iterm)).toBe('');
    expect(openedText({ resumed: true }, 'iTerm')).toBe('Opened in iTerm');
    expect(openedText({ resumed: false }, 'Cursor')).toBe('Opened the folder in Cursor');
    expect(openedText({ resumed: true, note: 'macOS may ask for permission once' }, 'iTerm')).toBe('Opened in iTerm. macOS may ask for permission once');
  });
  it('resume command quotes the path only when needed', () => {
    expect(resumeCommand('/home/demo/shop-api', 'abc-123')).toBe('cd /home/demo/shop-api && claude --resume abc-123');
    expect(resumeCommand('/Users/me/My Project', 'abc-123')).toBe(`cd '/Users/me/My Project' && claude --resume abc-123`);
    expect(resumeCommand('/Users/me/dự-án', 'a')).toBe(`cd '/Users/me/dự-án' && claude --resume a`); // non-ASCII: quoted
    expect(resumeCommand('/tmp/$HOME;x', 'a')).toBe(`cd '/tmp/$HOME;x' && claude --resume a`);
  });
});
