import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchOpeners, openSession, HistoryHttpError } from '../src/historyApi';
import { loadOpener, saveOpener, OPENER_KEY, pickOpener, openerHint, openedText, openErrorText, isOpenConfirm, resumeCommand, permissionHint, OPEN_SLOW_MS, shOnlyPath, SH_ONLY_NOTE } from '../src/history';
import type { HistoryOpener } from '../src/types';

const iterm: HistoryOpener = { id: 'iterm', label: 'iTerm', kind: 'terminal', resumes: true };
const cursor: HistoryOpener = { id: 'cursor', label: 'Cursor', kind: 'editor', resumes: false };
const vscode: HistoryOpener = { id: 'vscode', label: 'VS Code', kind: 'editor', resumes: true };
const env = () => { vi.stubGlobal('sessionStorage', { getItem: () => '127.0.0.1:7777' }); vi.stubGlobal('location', { port: '7777', host: '127.0.0.1:7777' }); };
afterEach(() => vi.unstubAllGlobals());

describe('"Mở lại" API', () => {
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
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ error: 'confirm-required', reason: 'Phiên này đang chạy trong văn phòng — mở thêm một cửa sổ nữa?' }) })));
    const e = await openSession('t', { sid: 's', app: 'iterm' }).catch((x) => x) as HistoryHttpError;
    expect(e).toBeInstanceOf(HistoryHttpError); expect(e).toMatchObject({ status: 409, error: 'confirm-required' }); expect(isOpenConfirm(e.error)).toBe(true); expect(e.reason).toMatch(/đang chạy/);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: 'project-missing', reason: 'Thư mục /p không còn.' }) })));
    const m = await openSession('t', { sid: 's', app: 'cursor' }).catch((x) => x) as HistoryHttpError;
    expect(isOpenConfirm(m.error)).toBe(false); expect(openErrorText(m.status, m.error, m.reason)).toBe('Thư mục /p không còn.');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => { throw new SyntaxError('html'); } }))); // old orchestrator: no JSON body
    const o = await fetchOpeners('t').catch((x) => x) as HistoryHttpError;
    expect(o).toMatchObject({ status: 404 }); expect(o.error).toBeUndefined(); expect(openErrorText(o.status, o.error)).toMatch(/chưa hỗ trợ/);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(openSession('t', { sid: 's', app: 'iterm' })).rejects.toMatchObject({ status: 0 });
  });
  it('error text without a reason', () => {
    expect(openErrorText(0)).toMatch(/kết nối/); expect(openErrorText(401)).toMatch(/ui-url\.txt/); expect(openErrorText(-1)).toMatch(/không đọc/);
    expect(openErrorText(404, 'not-indexed')).toBe('Không mở được: not-indexed.'); expect(openErrorText(500)).toBe('Không mở được (500).');
    expect(openErrorText(409, 'automation-pending')).toMatch(/hỏi quyền.*Mở lại/); expect(openErrorText(409, 'busy')).toMatch(/phiên khác/);
    expect(openErrorText(409, 'automation-pending', 'Bấm OK trong hộp thoại Automation của macOS.')).toBe('Bấm OK trong hộp thoại Automation của macOS.'); // the server's reason wins
    expect(isOpenConfirm('automation-pending')).toBe(false); expect(isOpenConfirm('busy')).toBe(false);
  });
  it('slow launch hint', () => { expect(OPEN_SLOW_MS).toBe(3000); expect(permissionHint('iTerm')).toBe('Nếu macOS hỏi quyền điều khiển iTerm, bấm OK.'); });
  it('sh/bash/zsh-only note for paths with \\ ! \' or control characters', () => {
    for (const p of ['/home/demo/shop-api', '/Users/me/My Project', '/Users/me/dự-án', '/tmp/$x;y']) expect(shOnlyPath(p)).toBe(false);
    for (const p of ['/tmp/a\\b', '/tmp/wow!', "/tmp/O'Brien", '/tmp/a\nb', '/tmp/tab\there', '/tmp/del\x7f']) expect(shOnlyPath(p)).toBe(true);
    expect(shOnlyPath(String.raw`C:\Users\me`)).toBe(false); // PowerShell command, not sh
    expect(SH_ONLY_NOTE).toBe('đường dẫn có ký tự đặc biệt — chỉ dùng trong bash/zsh');
  });
});

describe('"Mở lại" helpers', () => {
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
    expect(openerHint(cursor)).toBe('(chỉ mở thư mục)'); expect(openerHint(vscode)).toBe(''); expect(openerHint(iterm)).toBe('');
    expect(openedText({ resumed: true }, 'iTerm')).toBe('Đã mở trong iTerm');
    expect(openedText({ resumed: false }, 'Cursor')).toBe('Đã mở thư mục trong Cursor');
    expect(openedText({ resumed: true, note: 'macOS có thể hỏi quyền một lần' }, 'iTerm')).toBe('Đã mở trong iTerm. macOS có thể hỏi quyền một lần');
  });
  it('resume command quotes the path only when needed', () => {
    expect(resumeCommand('/home/demo/shop-api', 'abc-123')).toBe('cd /home/demo/shop-api && claude --resume abc-123');
    expect(resumeCommand('/Users/me/My Project', 'abc-123')).toBe(`cd '/Users/me/My Project' && claude --resume abc-123`);
    expect(resumeCommand('/Users/me/dự-án', 'a')).toBe(`cd '/Users/me/dự-án' && claude --resume a`); // non-ASCII: quoted
    expect(resumeCommand('/tmp/$HOME;x', 'a')).toBe(`cd '/tmp/$HOME;x' && claude --resume a`);
  });
});
