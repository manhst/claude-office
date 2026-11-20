import { describe, it, expect, vi, afterEach } from 'vitest';
import { fold, parseTerms, highlight, shq, psq, isWinPath, resumeCommand, continuePage, MAX_MARKS, MIN_HL, bookmarkRequest, patchSession, patchList, NOTE_MAX, relTime, fmtDuration, fmtSpan, fmtCost, historyErrorText, appendPage, projectOptions, loadTab, saveTab, TAB_KEY, MAX_TERMS, type Seg } from '../src/history';
import { historyQs, fetchHistory, fetchHistorySession, fetchHistoryUpTo, setBookmark, HistoryHttpError, MAX_LIMIT } from '../src/historyApi';
import type { HistoryHit, HistoryListResponse } from '../src/types';

const marks = (g: Seg[]) => g.filter((x) => x.m).map((x) => x.t);
const join = (g: Seg[]) => g.map((x) => x.t).join('');
const hit = (sid: string): HistoryHit => ({ sid, project: '/p', projectName: 'p', title: sid, startedAt: 1, endedAt: 2, prompts: 1, messages: 2, auto: false, subagents: 0, bytes: 10 });
const page = (sids: string[], o: Partial<HistoryListResponse> = {}): HistoryListResponse => ({ total: 5, offset: 0, sessions: sids.map(hit), projects: [], autoHidden: 0, scannedAt: 1, bookmarked: 0, ...o });

describe('fold', () => {
  it('drops case and Vietnamese diacritics, đ → d, length preserved', () => {
    expect(fold('Lịch Sử')).toBe('lich su');
    expect(fold('Đơn')).toBe('don');
    expect(fold('đường ĐI')).toBe('duong di');
    for (const s of ['Lịch Sử', 'Claude Deck', 'ÀÁÂÃ èéêë', 'naïve café', '😀 emoji ok', 'İstanbul']) expect(fold(s)).toHaveLength(s.length);
    expect(fold('npm TEST --Run')).toBe('npm test --run');
  });
  it('matches the per-unit rule from the contract', () => {
    const spec = (s: string) => Array.from({ length: s.length }, (_, i) => { const c = s[i], f = (c.normalize('NFD')[0] ?? c).toLowerCase()[0]; return f === 'đ' ? 'd' : f; }).join('');
    for (const s of ['Tiếng Việt có dấu: ỄỆỈỊ ơư ĐĐ', 'Ünïcödé ÇØ ß', 'x😀y\uD800z']) expect(fold(s)).toBe(spec(s));
  });
});

describe('parseTerms', () => {
  it('splits on whitespace, keeps quoted phrases, folds and de-duplicates', () => {
    expect(parseTerms('  Lịch   sử ')).toEqual(['lich', 'su']);
    expect(parseTerms('"npm test" build')).toEqual(['npm test', 'build']);
    expect(parseTerms('foo FOO "foo"')).toEqual(['foo']);
    expect(parseTerms('"" "  " ')).toEqual([]);
    expect(parseTerms('"unclosed phrase')).toEqual(['unclosed', 'phrase']);
    expect(parseTerms('a"b ""x""')).toEqual(['a"b', 'x']);
    expect(parseTerms('"npm \t  test"')).toEqual(['npm test']);
    expect(parseTerms('x'.repeat(150))).toEqual(['x'.repeat(100)]);
  });
  it('caps at 8 terms', () => {
    expect(parseTerms('a b c d e f g h i j')).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    expect(parseTerms('"x y" 1 2 3 4 5 6 7 8')).toHaveLength(MAX_TERMS);
  });
});

describe('highlight', () => {
  it('returns plain text without terms or matches', () => {
    expect(highlight('', ['a'])).toEqual([]);
    expect(highlight('hello', [])).toEqual([{ t: 'hello' }]);
    expect(highlight('hello', ['zz'])).toEqual([{ t: 'hello' }]);
  });
  it('maps diacritic-insensitive matches back to the original text', () => {
    const g = highlight('Mở tab Lịch Sử ngay', parseTerms('lich su'));
    expect(marks(g)).toEqual(['Lịch', 'Sử']);
    expect(join(g)).toBe('Mở tab Lịch Sử ngay');
    expect(marks(highlight('Đơn hàng ĐƠN', ['don']))).toEqual(['Đơn', 'ĐƠN']);
    expect(marks(highlight('Run NPM Test now', parseTerms('"npm test"')))).toEqual(['NPM Test']);
  });
  it('merges overlapping and adjacent terms into one mark', () => {
    expect(highlight('abcdef', ['abc', 'bcd'])).toEqual([{ t: 'abcd', m: true }, { t: 'ef' }]);
    expect(highlight('foobar baz', ['foo', 'bar'])).toEqual([{ t: 'foobar', m: true }, { t: ' baz' }]);
    expect(highlight('aaa', ['aa'])).toEqual([{ t: 'aaa', m: true }]);
    expect(highlight('x test y test', ['test'])).toEqual([{ t: 'x ' }, { t: 'test', m: true }, { t: ' y ' }, { t: 'test', m: true }]);
    expect(highlight('ab cd', ['cd', 'ab'])).toEqual([{ t: 'ab', m: true }, { t: ' ' }, { t: 'cd', m: true }]);
  });
  it('skips terms shorter than 2 chars (search still uses them)', () => {
    expect(MIN_HL).toBe(2);
    expect(highlight('a b ab', ['a'])).toEqual([{ t: 'a b ab' }]);
    expect(highlight('a b ab', ['a', 'ab'])).toEqual([{ t: 'a b ' }, { t: 'ab', m: true }]);
    expect(highlight('Đ đ', parseTerms('đ x'))).toEqual([{ t: 'Đ đ' }]);
  });
  it('caps marks per text; the rest stays plain and the text is intact', () => {
    const big = 'ab '.repeat(5000), g = highlight(big, ['ab']);
    expect(marks(g)).toHaveLength(MAX_MARKS); expect(join(g)).toBe(big); expect(g.length).toBeLessThanOrEqual(2 * MAX_MARKS + 1);
    expect(marks(highlight('ab ab ab ab', ['ab'], 2))).toEqual(['ab', 'ab']);
    const tail = 'ab '.repeat(300) + 'zz', t = highlight(tail, ['ab', 'zz']); // 'zz' lies past where 'ab' stopped counting: left plain, not a gap
    expect(marks(t)).toHaveLength(MAX_MARKS); expect(marks(t)).not.toContain('zz'); expect(join(t)).toBe(tail);
    expect(marks(highlight('aaaaaaaaaa', ['aa'], 3))).toEqual(['aaaa']); // 3 overlapping matches merge into one mark, nothing past the stop
  });
});

describe('resume command', () => {
  it('single-quotes the project path (spaces, single quotes)', () => {
    expect(shq("it's")).toBe(`'it'\\''s'`);
    expect(resumeCommand('/Users/me/My Project', 'abc-123')).toBe(`cd '/Users/me/My Project' && claude --resume abc-123`);
    expect(resumeCommand("/tmp/O'Brien dir", '0b9f2c1e-aaaa-4bbb-8ccc-123456789abc')).toBe(`cd '/tmp/O'\\''Brien dir' && claude --resume 0b9f2c1e-aaaa-4bbb-8ccc-123456789abc`);
    expect(resumeCommand('/p', 'x; rm -rf ~')).toBe(`cd /p && claude --resume 'x; rm -rf ~'`);
  });
  it('uses PowerShell quoting for drive and UNC paths', () => {
    expect([String.raw`C:\Users\me`, 'd:/src/x', String.raw`\\srv\share\p`].map(isWinPath)).toEqual([true, true, true]);
    expect(['/Users/me', 'C:', 'relative\\x', String.raw`\single`].map(isWinPath)).toEqual([false, false, false, false]);
    expect(psq("O'Brien’s")).toBe("'O''Brien’’s'");
    expect(resumeCommand(String.raw`C:\Users\me\My Project`, 'abc-123')).toBe(String.raw`cd -LiteralPath 'C:\Users\me\My Project'; claude --resume abc-123`);
    expect(resumeCommand(String.raw`C:\src\O'Brien [x]`, 'abc')).toBe(String.raw`cd -LiteralPath 'C:\src\O''Brien [x]'; claude --resume abc`);
    expect(resumeCommand(String.raw`\\nas\team\api`, 'a b')).toBe(String.raw`cd -LiteralPath '\\nas\team\api'; claude --resume 'a b'`);
  });
});

describe('formatting', () => {
  const now = new Date(2026, 10, 18, 12, 0).getTime();
  it('relative time, then the date after a week', () => {
    expect(relTime(now - 10_000, now)).toBe('just now');
    expect(relTime(now - 50_000, now)).toBe('1m ago');
    expect(relTime(now - 59 * 60_000, now)).toBe('59m ago');
    expect(relTime(now - 3 * 3600_000, now)).toBe('3h ago');
    expect(relTime(now - 2 * 86400_000, now)).toBe('2d ago');
    expect(relTime(new Date(2026, 9, 1, 8, 0).getTime(), now)).toBe('2026-10-01');
  });
  it('durations, spans and cost', () => {
    expect(fmtDuration(45_000)).toBe('45s');
    expect(fmtDuration(12 * 60_000)).toBe('12m');
    expect(fmtDuration(65 * 60_000)).toBe('1h 05m');
    expect(fmtDuration(51 * 3600_000)).toBe('2d 3h');
    expect(fmtSpan(new Date(2026, 10, 18, 9, 5).getTime(), new Date(2026, 10, 18, 10, 40).getTime())).toBe('2026-11-18 09:05 – 10:40');
    expect(fmtSpan(new Date(2026, 10, 17, 23, 50).getTime(), new Date(2026, 10, 18, 0, 30).getTime())).toBe('2026-11-17 23:50 – 2026-11-18 00:30');
    expect(fmtCost(0.0421)).toBe('$0.042');
    expect(fmtCost(3.456)).toBe('$3.46');
  });
  it('error copy per status', () => {
    expect(historyErrorText(401)).toMatch(/ui-url\.txt/);
    expect(historyErrorText(404)).toMatch(/too old.*Restart/);
    expect(historyErrorText(501)).toMatch(/too old/);
    expect(historyErrorText(404, 'session')).toMatch(/not found/);
    expect(historyErrorText(0)).toMatch(/reach/);
    expect(historyErrorText(500)).toMatch(/500/);
  });
});

describe('list helpers', () => {
  it('appendPage drops sids already listed', () => {
    const a = appendPage(page(['a', 'b']), page(['b', 'c'], { offset: 2 }));
    expect(a.sessions.map((x) => x.sid)).toEqual(['a', 'b', 'c']);
    expect(a.offset).toBe(0);
  });
  it('continuePage appends when the overlap row still matches, null when the order drifted', () => {
    const prev = page(['a', 'b']);
    expect(continuePage(prev, page(['b', 'c', 'd'], { offset: 1 }))?.sessions.map((x) => x.sid)).toEqual(['a', 'b', 'c', 'd']);
    expect(continuePage(prev, page(['x', 'b', 'c'], { offset: 1 }))).toBeNull(); // a session jumped to the top: b moved down by one
    expect(continuePage(prev, page([], { offset: 1 }))).toBeNull();
    expect(continuePage(page([]), page(['a']))).toBeNull();
  });
  it('bookmarkRequest trims and caps the note, omits it when empty or off', () => {
    expect(bookmarkRequest('s', true)).toEqual({ sid: 's', on: true });
    expect(bookmarkRequest('s', true, '   ')).toEqual({ sid: 's', on: true });
    expect(bookmarkRequest('s', true, '  ship it  ')).toEqual({ sid: 's', on: true, note: 'ship it' });
    expect(bookmarkRequest('s', true, 'x'.repeat(300)).note).toHaveLength(NOTE_MAX);
    expect(bookmarkRequest('s', false, 'kept?')).toEqual({ sid: 's', on: false });
  });
  it('patchSession adds, updates and removes a bookmark (same object when nothing changes)', () => {
    const a = hit('a'), on = patchSession(a, { sid: 'a', bookmark: { at: 5, note: 'n' } });
    expect(on.bookmark).toEqual({ at: 5, note: 'n' }); expect(a.bookmark).toBeUndefined();
    expect(patchSession(on, { sid: 'a', bookmark: { at: 5, note: 'n2' } }).bookmark?.note).toBe('n2');
    const off = patchSession(on, { sid: 'a', bookmark: null }); expect(off).not.toHaveProperty('bookmark'); expect(off.title).toBe('a');
    expect(patchSession(a, { sid: 'b', bookmark: { at: 1 } })).toBe(a);
    expect(patchSession(a, { sid: 'a', bookmark: null })).toBe(a);
    expect(patchSession(on, { sid: 'a', bookmark: { at: 5, note: 'n' } })).toBe(on);
  });
  it('patchList keeps un-starred rows in place and moves the bookmarked count', () => {
    const d = page(['a', 'b', 'c'], { bookmarked: 0 });
    const s1 = patchList(d, { sid: 'b', bookmark: { at: 1 } });
    expect(s1.bookmarked).toBe(1); expect(s1.sessions[1].bookmark).toEqual({ at: 1 }); expect(s1.sessions[0]).toBe(d.sessions[0]);
    expect(patchList(s1, { sid: 'b', bookmark: { at: 1 } })).toBe(s1); // server echo of the optimistic state: no double count
    expect(patchList(s1, { sid: 'b', bookmark: { at: 1, note: 'x' } }).bookmarked).toBe(1); // note edit: count unchanged
    const s2 = patchList(s1, { sid: 'b', bookmark: null });
    expect(s2.sessions.map((x) => x.sid)).toEqual(['a', 'b', 'c']); expect(s2.sessions[1].bookmark).toBeUndefined(); expect(s2.bookmarked).toBe(0);
    expect(patchList(d, { sid: 'zz', bookmark: { at: 1 } })).toBe(d); // not listed: count untouched
    expect(patchList(d, { sid: 'a', bookmark: null }).bookmarked).toBe(0);
  });
  it('projectOptions: All first, full path on name clashes, keeps a stale filter', () => {
    const o = projectOptions([{ project: '/a/api', projectName: 'api', sessions: 3, lastAt: 1 }, { project: '/b/api', projectName: 'api', sessions: 1, lastAt: 1 }, { project: '/c/web', projectName: 'web', sessions: 2, lastAt: 1 }], '/gone');
    expect(o.map((x) => x.label)).toEqual(['All projects (6)', '/gone (0)', '/a/api (3)', '/b/api (1)', 'web (2)']);
    expect(o[0].value).toBe('');
  });
  it('tab preference survives a throwing storage', () => {
    const m = new Map<string, string>(), store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(loadTab(store)).toBe('office');
    saveTab('history', store); expect(m.get(TAB_KEY)).toBe('history'); expect(loadTab(store)).toBe('history');
    const bad = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(loadTab(bad)).toBe('office'); expect(() => saveTab('history', bad)).not.toThrow();
  });
});

describe('historyApi', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('query builder omits empty params, auto=1 only when on', () => {
    expect(historyQs({})).toBe('');
    expect(historyQs({ q: '  ', project: '', auto: false, offset: 0 })).toBe('');
    expect(historyQs({ q: ' lịch sử "npm test" ', project: '/Users/me/My Project', auto: true, limit: 50, offset: 100 }))
      .toBe(`?q=${encodeURIComponent('lịch sử "npm test"')}&project=%2FUsers%2Fme%2FMy%20Project&auto=1&limit=50&offset=100`);
    expect(historyQs({ q: 'a&b=c', limit: 50 })).toBe('?q=a%26b%3Dc&limit=50');
    expect(historyQs({ bookmarked: false, auto: false })).toBe('');
    expect(historyQs({ q: 'x', auto: true, bookmarked: true, limit: 50 })).toBe('?q=x&auto=1&bookmarked=1&limit=50');
  });
  it('sends the token as a Bearer header only, never in the URL', async () => {
    const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => page(['a']) }));
    vi.stubGlobal('fetch', fetch); vi.stubGlobal('sessionStorage', { getItem: () => '127.0.0.1:7777' }); vi.stubGlobal('location', { port: '7777', host: '127.0.0.1:7777' });
    await fetchHistory('tok', { q: 'x', limit: 50 });
    await fetchHistorySession('tok', 'a b');
    const calls = fetch.mock.calls as unknown as Array<[string, { headers: Record<string, string> }]>;
    expect(calls.map((c) => c[0])).toEqual(['http://127.0.0.1:7777/history?q=x&limit=50', 'http://127.0.0.1:7777/history/session?sid=a%20b']);
    for (const [u, init] of calls) { expect(u).not.toContain('tok'); expect(init.headers.authorization).toBe('Bearer tok'); }
  });
  it('fetchHistoryUpTo reloads in ≤200-row chunks and merges them', async () => {
    const all = Array.from({ length: 330 }, (_, i) => `s${i}`), urls: string[] = [];
    vi.stubGlobal('sessionStorage', { getItem: () => null }); vi.stubGlobal('location', { port: '7777', host: '127.0.0.1:7777' });
    vi.stubGlobal('fetch', vi.fn(async (u: string) => { urls.push(u); const q = new URL(u).searchParams, o = +(q.get('offset') ?? 0), l = Math.min(MAX_LIMIT, +(q.get('limit') ?? 50));
      return { ok: true, status: 200, json: async () => page(all.slice(o, o + l), { offset: o, total: all.length }) }; }));
    const r = await fetchHistoryUpTo('t', { q: 'x' }, 250);
    expect(urls.map((u) => u.replace(/^.*\?/, ''))).toEqual(['q=x&limit=200', 'q=x&limit=50&offset=200']);
    expect(r.data.sessions.map((x) => x.sid)).toEqual(all.slice(0, 250)); expect(r.next).toBe(250); expect(r.data.offset).toBe(0);
    urls.length = 0; const s = await fetchHistoryUpTo('t', {}, 1000); // stops at total
    expect(urls).toHaveLength(2); expect(s.next).toBe(330);
  });
  it('setBookmark POSTs JSON with the token only in the header', async () => {
    const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ sid: 'a', bookmark: { at: 9, note: 'n' } }) }));
    vi.stubGlobal('fetch', fetch); vi.stubGlobal('sessionStorage', { getItem: () => '127.0.0.1:7777' }); vi.stubGlobal('location', { port: '7777', host: '127.0.0.1:7777' });
    expect(await setBookmark('tok', bookmarkRequest('a', true, ' n '))).toEqual({ sid: 'a', bookmark: { at: 9, note: 'n' } });
    const [u, init] = fetch.mock.calls[0] as unknown as [string, { method: string; headers: Record<string, string>; body: string }];
    expect(u).toBe('http://127.0.0.1:7777/history/bookmark'); expect(u).not.toContain('tok');
    expect(init.method).toBe('POST'); expect(init.headers.authorization).toBe('Bearer tok'); expect(init.headers['content-type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ sid: 'a', on: true, note: 'n' }); expect(init.body).not.toContain('tok');
  });
  it('setBookmark failures map to HistoryHttpError and bookmark copy', async () => {
    vi.stubGlobal('sessionStorage', { getItem: () => null }); vi.stubGlobal('location', { port: '7777', host: '127.0.0.1:7777' });
    for (const st of [400, 401, 404]) {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: st, json: async () => ({ error: 'x' }) })));
      await expect(setBookmark('t', { sid: 's', on: false })).rejects.toMatchObject({ status: st });
    }
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(setBookmark('t', { sid: 's', on: true })).rejects.toMatchObject({ status: 0 });
    expect(historyErrorText(404, 'bookmark')).toMatch(/not in the history index/);
    expect(historyErrorText(400, 'bookmark')).toMatch(/bad input/);
    expect(historyErrorText(403, 'bookmark')).toMatch(/ui-url\.txt/);
    expect(historyErrorText(500, 'bookmark')).toBe('Bookmark failed (500).');
  });
  it('maps HTTP and network failures to HistoryHttpError', async () => {
    vi.stubGlobal('sessionStorage', { getItem: () => null }); vi.stubGlobal('location', { port: '7777', host: '127.0.0.1:7777' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
    await expect(fetchHistory('t', {})).rejects.toMatchObject({ status: 404 });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(fetchHistory('t', {})).rejects.toBeInstanceOf(HistoryHttpError);
    await expect(fetchHistory('t', {})).rejects.toMatchObject({ status: 0 });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('html'); } })));
    await expect(fetchHistorySession('t', 's')).rejects.toMatchObject({ status: -1 });
  });
});
