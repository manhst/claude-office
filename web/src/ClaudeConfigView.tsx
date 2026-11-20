import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ClaudeConfigView as Cfg, McpScope, McpServerView, McpTestResult } from './types';
import {
  APPLY_NOTE, argsFromText, configErrorText, describeLocation, isNewerView, keptHeadersMoved, maskArgs, maskedView, maskUrl, projectSecretsText, renameNote, RUN_CONFIRM, sanitizeName, draftFromImport, draftFromView, draftKey, emptyDraft, filterServers, groupServers, KNOWN_TYPES, namesIn, parseMcpAddCommand,
  IN_SESSION_FIX, isWeb, parseMcpJson, readOnlyReason, rebaseDraft, refKey, refOf, revealRow, saveRequest, SCOPE_LABEL, SCOPES, scopeCounts, serverLine, targetRef, testRequest, typeLabel, validateDraft,
  type DraftErrors, type ImportItem, type ImportResult, type McpDraft, type PairDraft, type Scope3,
} from './claudeConfig';
import { errInfo, fetchClaudeConfig, isConfirmRequired, mcpDelete, mcpReveal, mcpSave, mcpTest, type ErrInfo } from './claudeConfigApi';
import { isAbort } from './historyApi';
import { absTime } from './history';
import { IconCross, IconEye, IconWarn } from './icons';

type How = 'form' | 'json' | 'cmd';
/** Editor state: the draft, its starting point (dirty check / revert), the stored entry it came from, and import notes. */
type Ed = { draft: McpDraft; init: McpDraft; base: string; src?: McpServerView; how: How; notes?: string[]; tried?: boolean };
type Msg = { kind: 'ok' | 'err'; text: string };
const mkEd = (d: McpDraft, src?: McpServerView, how: How = 'form', extra: Partial<Ed> = {}): Ed => ({ draft: d, init: d, base: draftKey(d), src, how, ...extra });
const CHIPS: (McpScope | 'all')[] = ['all', ...SCOPES];
const errText = (i: ErrInfo, kind: Parameters<typeof configErrorText>[2]) => configErrorText(i.status, i.error, kind, i);
const SCOPE_HINT: Record<Scope3, string> = { user: '~/.claude.json · every project, only you', local: '~/.claude.json · this project only, only you', project: '<project>/.mcp.json · shared with the repo (each user approves it)' };

/** "Cấu hình Claude" tab: Claude Code's MCP servers across scopes (GET /claude-config); add / edit / clone / delete / test / import. Writes go through the claude CLI. */
export const ClaudeConfigView = memo(function ClaudeConfigView({ token, active, focusTick }: { token: string; active: boolean; focusTick: number }) {
  const [cfg, setCfg] = useState<Cfg>(), [loading, setLoading] = useState(true), [loadErr, setLoadErr] = useState<string>(), [reload, setReload] = useState(0);
  const [q, setQ] = useState(''), [scope, setScope] = useState<McpScope | 'all'>('all'), [project, setProject] = useState('');
  const [ed, setEd] = useState<Ed>(), [msg, setMsg] = useState<Msg>(), [busy, setBusy] = useState<'save' | 'delete' | 'import'>(), [ask, setAsk] = useState<Ask>();
  const [test, setTest] = useState<McpTestResult>(), [testing, setTesting] = useState(false), [revealErr, setRevealErr] = useState<string>();
  const [shown, setShown] = useState<ReadonlySet<string>>(new Set()); // servers whose masked args/url parts are shown
  const input = useRef<HTMLInputElement>(null), testAc = useRef<AbortController | undefined>(undefined), lastRead = useRef(0), edGen = useRef(0);
  const toggleShown = useCallback((k: string) => setShown((v) => { const n = new Set(v); if (!n.delete(k)) n.add(k); return n; }), []);
  /** Replace the editor (open / add / clone / close…); a save still in flight then leaves the new one alone. */
  const openEd = (e: Ed | undefined) => { edGen.current++; setEd(e); };
  /** Show a fetched view unless an older one arrived late. */
  const accept = useCallback((v: Cfg) => { if (!isNewerView(lastRead.current, v.readAt)) return false; lastRead.current = v.readAt; setCfg(v); return true; }, []);
  useEffect(() => { if (focusTick) input.current?.focus(); }, [focusTick]);
  /** After a reload: an untouched editor follows the stored entry; an edited one keeps the fields the user changed, takes the rest + the new hash ("check and save again"). */
  const sync = useCallback((v: Cfg) => setEd((e) => {
    const o = e?.draft.original; if (!e || !o) return e;
    const cur = v.servers.find((x) => refKey(x) === refKey(o));
    if (!cur) { const { original: _, ...d } = e.draft; return { ...e, draft: { ...d, mode: 'new' }, src: undefined }; }
    const fresh = draftFromView(cur, 'edit');
    if (draftKey(e.draft) === e.base) return mkEd(fresh, cur);
    return { ...e, draft: rebaseDraft(e.draft, e.init, fresh), init: fresh, base: draftKey(fresh), src: cur };
  }), []);
  const refetch = useCallback(async () => { try { const v = await fetchClaudeConfig(token); if (accept(v)) sync(v); setLoadErr(undefined); } catch (e) { setLoadErr(errText(errInfo(e), 'load')); } }, [token, sync, accept]);
  useEffect(() => {
    const ac = new AbortController(); setLoading(true);
    fetchClaudeConfig(token, ac.signal).then((v) => { if (accept(v)) sync(v); setLoadErr(undefined); setLoading(false); },
      (e) => { if (isAbort(e)) return; setLoadErr(errText(errInfo(e), 'load')); setLoading(false); });
    return () => ac.abort();
  }, [token, reload, sync, accept]);
  useEffect(() => () => testAc.current?.abort(), []);
  const wasActive = useRef(active);
  useEffect(() => { if (active && !wasActive.current) void refetch(); wasActive.current = active; }, [active, refetch]); // re-opened: Claude Code may have rewritten ~/.claude.json

  const servers = cfg?.servers ?? [], projects = cfg?.projects ?? [];
  const f = useMemo(() => ({ q, scope, project }), [q, scope, project]);
  const counts = useMemo(() => scopeCounts(servers, f), [servers, f]);
  const groups = useMemo(() => groupServers(filterServers(servers, f)), [servers, f]);
  const roEntry = !!ed && ed.draft.mode === 'edit' && !!ed.src?.readOnly, dirty = !!ed && !roEntry && draftKey(ed.draft) !== ed.base;
  const selKey = ed?.draft.mode === 'edit' && ed.draft.original ? refKey(ed.draft.original) : undefined;
  const reset = () => { testAc.current?.abort(); setTest(undefined); setTesting(false); setRevealErr(undefined); };
  const guard = (next: () => void) => dirty ? setAsk({ title: 'Discard unsaved changes?', body: <>Your edits to <b>{ed!.draft.name || 'the new server'}</b> are not saved.</>, ok: 'Discard', danger: true, run: next }) : next();
  const open = (v: McpServerView) => guard(() => { reset(); setMsg(undefined); openEd(mkEd(draftFromView(v, 'edit'), v)); });
  const defLoc = (): { scope: Scope3; project: string } => (scope === 'local' || scope === 'project') && project ? { scope, project } : { scope: 'user', project: '' };
  const add = (how: How) => guard(() => { reset(); setMsg(undefined); const d = defLoc(); openEd(mkEd(emptyDraft(d.scope, d.project), undefined, how)); });
  const clone = (v: McpServerView) => guard(() => {
    reset(); setMsg(undefined); const sc = v.scope === 'settings' ? 'user' : v.scope, d = draftFromView(v, 'clone', namesIn(servers, sc, v.project));
    openEd(mkEd(d, v, 'form', sanitizeName(v.name) !== v.name ? { notes: [renameNote(v.name, sanitizeName(v.name))] } : {}));
  });
  const setDraft = (p: Partial<McpDraft>) => setEd((e) => e && { ...e, draft: { ...e.draft, ...p } });
  const loadImport = (it: ImportItem) => {
    const d = draftFromImport(it, defLoc()); setMsg(undefined);
    openEd({ ...mkEd(d, undefined, 'form', { notes: [...(it.name && d.name !== it.name ? [renameNote(it.name, d.name)] : []), ...it.notes] }), base: draftKey(emptyDraft()) });
  };

  /** Save, after confirming kept headers going to a new host and (server-asked) plain-text secrets in a project's .mcp.json. */
  const save = async (o: { hostOk?: boolean; secretsOk?: boolean } = {}) => {
    if (!ed || !cfg || busy) return;
    const d = ed.draft; if (Object.keys(validateDraft(d, servers, projects)).length) { setEd({ ...ed, tried: true }); return; }
    const mv = o.hostOk ? undefined : keptHeadersMoved(d, ed.src?.url);
    if (mv) { setAsk({ title: 'Send kept headers to a new host?', ok: 'Save anyway', danger: true, run: () => void save({ ...o, hostOk: true }), body: <>The stored {mv.keys.length === 1 ? 'header' : 'headers'} <b>{mv.keys.join(', ')}</b> will be sent to <code>{mv.to}</code> instead of <code>{mv.from}</code>. Re-enter {mv.keys.length === 1 ? 'it' : 'them'} if the new host shouldn't get them.</> }); return; }
    const g = edGen.current; setBusy('save'); setMsg(undefined);
    try {
      const r = await mcpSave(token, { ...saveRequest(d), ...(o.secretsOk ? { confirmProjectSecrets: true } : {}) }), t = targetRef(d), cur = r.view.servers.find((x) => refKey(x) === refKey(t));
      accept(r.view); if (cur && edGen.current === g) openEd(mkEd(draftFromView(cur, 'edit'), cur));
      setMsg({ kind: 'ok', text: `Saved “${t.name}” to ${cur ? describeLocation(cur) : `${SCOPE_LABEL[t.scope]} scope`}. ${APPLY_NOTE}${r.backup ? ` Backup: ${r.backup}` : ''}` });
    } catch (e) {
      const i = errInfo(e);
      if (isConfirmRequired(i)) { setAsk({ title: 'Write secrets to .mcp.json?', ok: 'Save anyway', danger: true, run: () => void save({ ...o, hostOk: true, secretsOk: true }), body: <>{projectSecretsText(d.project)}{i.reason ? <small className="cc-reason">{i.reason}</small> : null}</> }); return; }
      setMsg({ kind: 'err', text: errText(i, 'save') });
      if (i.status === 409 && i.error === 'changed') await refetch();
    } finally { setBusy(undefined); }
  };
  const del = (v: McpServerView) => setAsk({
    title: `Delete “${v.name}”?`, ok: 'Delete', danger: true,
    body: <>Removes it from <b>{describeLocation(v)}</b> using <code>claude mcp remove</code>. {APPLY_NOTE}</>,
    run: async () => {
      setBusy('delete'); setMsg(undefined);
      const g = edGen.current;
      try { const r = await mcpDelete(token, { ...refOf(v), hash: v.hash }); accept(r.view); if (edGen.current === g) { reset(); openEd(undefined); } setMsg({ kind: 'ok', text: `Deleted “${v.name}” from ${describeLocation(v)}. ${APPLY_NOTE}${r.backup ? ` Backup: ${r.backup}` : ''}` }); }
      catch (e) { const i = errInfo(e); setMsg({ kind: 'err', text: errText(i, 'delete') }); if (i.status === 409 && i.error === 'changed') await refetch(); }
      finally { setBusy(undefined); }
    },
  });
  /** Test; kept headers aimed at a new host and (server-asked) unapproved project servers need a confirm first. */
  const runTest = async (o: { confirm?: boolean; hostOk?: boolean } = {}) => {
    if (!ed) return;
    const mv = o.hostOk || !dirty ? undefined : keptHeadersMoved(ed.draft, ed.src?.url);
    if (mv) { setAsk({ title: 'Send kept headers to a new host?', ok: 'Test anyway', danger: true, run: () => void runTest({ ...o, hostOk: true }), body: <>The test sends the stored <b>{mv.keys.join(', ')}</b> to <code>{mv.to}</code> instead of <code>{mv.from}</code>.</> }); return; }
    testAc.current?.abort(); const ac = new AbortController(); testAc.current = ac; setTesting(true); setTest(undefined);
    try { const r = await mcpTest(token, { ...testRequest(ed.draft, dirty), ...(o.confirm ? { confirm: true } : {}) }, ac.signal); if (!ac.signal.aborted) setTest(r); }
    catch (e) {
      if (ac.signal.aborted || isAbort(e)) return;
      const i = errInfo(e);
      if (isConfirmRequired(i)) { setAsk({ title: 'Run this project server?', ok: 'Run test', run: () => void runTest({ ...o, hostOk: true, confirm: true }), body: <>{RUN_CONFIRM}{i.reason ? <code className="cc-reason">{i.reason}</code> : null}</> }); return; }
      setTest({ ok: false, ms: 0, error: errText(i, 'test') });
    } finally { if (testAc.current === ac) setTesting(false); }
  };
  /** Reveal a stored value; it only lands in an editor whose source is still that server (and on the row still holding that key). */
  const reveal = async (field: 'env' | 'headers', i: number) => {
    const srcRef = (d?: McpDraft) => d?.original ? refOf(d.original) : d?.cloneFrom;
    const d = ed?.draft, ref = srcRef(d), row = d?.[field][i]; if (!d || !ref || !row?.orig) return;
    const rk = refKey(ref), key = row.orig; setRevealErr(undefined);
    try {
      const { value } = await mcpReveal(token, { ...ref, field, key });
      setEd((e) => {
        const er = srcRef(e?.draft); if (!e || !er || refKey(er) !== rk) return e;
        const at = e.draft[field].findIndex((p) => p.masked && p.orig === key && p.value === ''); if (at < 0) return e;
        const draft = { ...e.draft, [field]: e.draft[field].map((p, k) => k === at ? revealRow(p, value) : p) }, clean = draftKey(e.draft) === e.base;
        return { ...e, draft, ...(clean ? { base: draftKey(draft), init: draft } : {}) };
      });
    } catch (e) { setRevealErr(errText(errInfo(e), 'reveal')); }
  };
  const importAll = async (items: ImportItem[], loc: { scope: Scope3; project: string }): Promise<(string | true)[]> => {
    setBusy('import'); const out: (string | true)[] = [];
    try {
      let view = cfg;
      for (const it of items) {
        const d = draftFromImport({ ...it, scope: loc.scope }, loc), errs = validateDraft(d, view?.servers ?? [], view?.projects);
        if (Object.keys(errs).length) { out.push(Object.values(errs)[0]!); continue; }
        try { const r = await mcpSave(token, saveRequest(d)); view = r.view; accept(r.view); out.push(it.name && d.name !== it.name ? `saved as “${d.name}”` : true); }
        catch (e) { const i = errInfo(e); out.push(isConfirmRequired(i) ? `${projectSecretsText(d.project)} Open it in the form to confirm.` : errText(i, 'save')); }
      }
      const n = out.filter((x) => x === true || (typeof x === 'string' && x.startsWith('saved as'))).length; setMsg({ kind: n === items.length ? 'ok' : 'err', text: `Imported ${n} of ${items.length}. ${n ? APPLY_NOTE : ''}` });
    } finally { setBusy(undefined); }
    return out;
  };

  const ro = !cfg?.writable, rr = readOnlyReason(cfg?.cli ?? {});
  return (
    <div className="hist cc" data-testid="claude-config">
      <section className="hist-list" aria-label="MCP servers">
        <div className="hist-tools">
          {cfg ? <div className="cc-files" title={`read ${absTime(cfg.readAt)}`}><span className="mono">{cfg.files.claudeJson}</span> · <span className="mono">{cfg.files.settings}</span>
            {cfg.cli.version || cfg.cli.path ? <> · claude {cfg.cli.version ?? ''}{cfg.cli.path ? <span className="mono"> ({cfg.cli.path})</span> : null}</> : null}</div> : null}
          {cfg && ro ? (rr.inSession ? <div className="cc-banner cc-banner-big" role="alert" data-testid="cc-in-session"><b>Read-only.</b> {IN_SESSION_FIX}<small>{rr.text}</small></div>
            : <div className="cc-banner" role="status" data-testid="cc-readonly">Read-only: {rr.text}. You can browse, reveal and test; saving is off.</div>) : null}
          <input ref={input} type="search" className="hist-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, command, URL, project" aria-label="Search MCP servers" spellCheck={false} data-testid="cc-q"
            onKeyDown={(e) => { if (e.key === 'Escape' && q) { e.preventDefault(); e.stopPropagation(); setQ(''); } }} />
          <div className="cc-chips" role="group" aria-label="Scope">{CHIPS.map((c) => (
            <button key={c} type="button" className="cc-chip" aria-pressed={scope === c} onClick={() => setScope(c)} data-testid={`cc-chip-${c}`}>{c === 'all' ? 'All' : SCOPE_LABEL[c]} <small>{counts[c]}</small></button>))}</div>
          <div className="hist-filters">
            <select value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project (local and project scopes)" data-testid="cc-project">
              <option value="">All projects</option>
              {projects.map((p) => <option key={p.path} value={p.path}>{p.path}{p.exists ? '' : ' (missing)'}</option>)}
            </select>
            <button type="button" className="hist-btn cc-primary" onClick={() => add('form')} disabled={!cfg || ro} title={cfg && ro ? `Read-only: ${rr.text}` : 'Add a server: form, pasted JSON or a claude mcp add command'} data-testid="cc-add">+ Add server</button>
            <button type="button" className="hist-btn" onClick={() => setReload((r) => r + 1)} disabled={loading}>Refresh</button>
          </div>
        </div>
        <div className="hist-scroll">
          {loadErr ? <div className="hist-err" role="alert"><span>{loadErr}</span><button type="button" className="hist-btn" onClick={() => setReload((r) => r + 1)}>Retry</button></div> : null}
          {!cfg && loading ? <div className="muted hist-empty">Reading Claude Code config…</div> : null}
          {cfg && !groups.length ? <div className="muted hist-empty">{q || scope !== 'all' || project ? 'No MCP servers match.' : 'No MCP servers configured yet. Use + Add server.'}</div> : null}
          {groups.map((g) => (
            <div key={g.key} className="cc-group" data-testid={`cc-group-${g.scope}`}>
              <h3 className="cc-gh">{SCOPE_LABEL[g.scope]}<small className="mono">{g.scope === 'user' ? cfg?.files.claudeJson : g.scope === 'settings' ? 'not loaded by Claude Code' : g.scope === 'project' ? `${g.project}/.mcp.json` : g.project}
                {g.project && projects.some((p) => p.path === g.project && !p.exists) ? ' (missing)' : ''}</small><span>{g.servers.length}</span></h3>
              <ul className="hist-rows">{g.servers.map((v) => <Row key={refKey(v)} v={v} sel={refKey(v) === selKey} roBadge={v.readOnly && !ro} show={shown.has(refKey(v))} onShow={toggleShown} onOpen={open} />)}</ul>
            </div>))}
        </div>
      </section>
      <section className="hist-detail cc-detail" aria-label="MCP server editor" data-testid="cc-detail">
        {msg ? <div className={msg.kind === 'ok' ? 'cc-ok' : 'hist-err'} role={msg.kind === 'ok' ? 'status' : 'alert'} data-testid="cc-msg"><span>{msg.text}</span><button type="button" className="cc-icon" aria-label="Dismiss" onClick={() => setMsg(undefined)}><IconCross size={12} /></button></div> : null}
        {ed && cfg ? <Editor key={ed.src && ed.draft.mode === 'edit' ? refKey(ed.src) : ed.draft.mode} ed={ed} cfg={cfg} ro={roEntry} locked={ro} dirty={dirty} busy={busy} testing={testing} test={test} revealErr={revealErr}
          show={!ed.src || shown.has(refKey(ed.src))} onShow={() => ed.src && toggleShown(refKey(ed.src))}
          set={setDraft} setHow={(how) => setEd((e) => e && { ...e, how })} onSave={() => void save()} onTest={() => void runTest()} onClone={clone} onDelete={del} onReveal={reveal} onRevert={() => setEd((e) => e && { ...e, draft: e.init, tried: false })}
          onClose={() => guard(() => { reset(); openEd(undefined); })} onImport={loadImport} onImportAll={importAll} defLoc={defLoc()} />
          : <div className="muted hist-empty">{cfg ? 'Select a server to edit it, or + Add server (form, pasted JSON or a claude mcp add command).' : ''}</div>}
      </section>
      {ask ? <Confirm a={ask} onClose={() => setAsk(undefined)} active={active} /> : null}
    </div>
  );
});

/** roBadge: only when other entries are writable (a read-only config says so once, in the banner). */
const Row = memo(function Row({ v, sel, roBadge, show, onShow, onOpen }: { v: McpServerView; sel: boolean; roBadge: boolean; show: boolean; onShow: (k: string) => void; onOpen: (v: McpServerView) => void }) {
  const masked = maskedView(v).masked;
  return <li className={`hrow-li${masked ? ' has-star' : ''}`}><button type="button" className={`hrow${sel ? ' sel' : ''}`} aria-pressed={sel} onClick={() => onOpen(v)} data-testid={`cc-row-${v.scope}-${v.name}`}>
    <span className="hrow-top"><b className="hrow-title">{v.name}</b>
      <span className="hbadge">{typeLabel(v.type)}</span>
      {v.warnings.length ? <span className="hbadge cc-warnb" title={v.warnings.join('\n')}><IconWarn size={11} /> {v.warnings.length}</span> : null}
      {v.shadowedBy ? <span className="hbadge" title={`A ${SCOPE_LABEL[v.shadowedBy.scope]} entry with this name wins${v.shadowedBy.project ? ` in ${v.shadowedBy.project}` : ''}`}>overridden by {v.shadowedBy.scope}</span> : null}
      {v.approval ? <span className={`hbadge cc-ap-${v.approval}`} title="Project servers need each user's approval">{v.approval}</span> : null}
      {roBadge ? <span className="hbadge">read-only</span> : null}</span>
    <span className="cc-line mono">{serverLine(v, show) || '—'}</span>
  </button>
  {masked ? <button type="button" className={`hstar cc-eye${show ? ' on' : ''}`} aria-pressed={show} aria-label={show ? `Hide secrets of ${v.name}` : `Show hidden parts of ${v.name}`} title={show ? 'Hide secrets' : 'Show hidden parts (tokens, passwords)'}
    onClick={(e) => { e.stopPropagation(); onShow(refKey(v)); }} data-testid={`cc-show-${v.scope}-${v.name}`}><IconEye size={13} /></button> : null}</li>;
});

type EdProps = {
  ed: Ed; cfg: Cfg; ro: boolean; locked: boolean; dirty: boolean; busy?: string; testing: boolean; test?: McpTestResult; revealErr?: string; defLoc: { scope: Scope3; project: string };
  /** args/url secrets shown (per server); focusing a masked field shows it too, so editing always sees the real text */ show: boolean; onShow: () => void;
  set: (p: Partial<McpDraft>) => void; setHow: (h: How) => void; onSave: () => void; onTest: () => void; onClone: (v: McpServerView) => void; onDelete: (v: McpServerView) => void;
  onReveal: (f: 'env' | 'headers', i: number) => void; onRevert: () => void; onClose: () => void; onImport: (it: ImportItem) => void; onImportAll: (items: ImportItem[], loc: { scope: Scope3; project: string }) => Promise<(string | true)[]>;
};
function Editor({ ed, cfg, ro, locked, dirty, busy, testing, test, revealErr, defLoc, show, onShow, set, setHow, onSave, onTest, onClone, onDelete, onReveal, onRevert, onClose, onImport, onImportAll }: EdProps) {
  const d = ed.draft, src = ed.src, t = d.type.trim(), web = isWeb(t), stdio = t === 'stdio', unknown = !KNOWN_TYPES.includes(t);
  const errs: DraftErrors = useMemo(() => validateDraft(d, cfg.servers, cfg.projects), [d, cfg]);
  const err = (k: keyof DraftErrors) => errs[k] && (ed.tried || k === 'env' || k === 'headers' || k === 'type' || (k === 'name' && !!d.name) || (k === 'url' && !!d.url) || (k === 'command' && !!d.command)) ? <p className="cc-ferr" role="alert">{errs[k]}</p> : null;
  const canReveal = !!(d.original || d.cloneFrom), isNew = d.mode !== 'edit';
  const realArgs = argsFromText(d.args).join('\n'), mArgs = maskArgs(argsFromText(d.args)).join('\n'), mUrl = maskUrl(d.url), hasMask = mArgs !== realArgs || mUrl !== d.url;
  const hideArgs = !show && mArgs !== realArgs, hideUrl = !show && mUrl !== d.url, fix = sanitizeName(d.name.trim());
  const title = d.mode === 'edit' ? d.original?.name ?? d.name : d.mode === 'clone' ? `Clone of ${d.cloneFrom?.name}` : 'New MCP server';
  return (<>
    <div className="hd-head"><h2>{title}</h2>{d.mode !== 'edit' ? <span className="hbadge">{d.mode}</span> : null}{ro ? <span className="hbadge">read-only</span> : null}{dirty ? <span className="hbadge cc-dirty">unsaved</span> : null}
      <button type="button" className="cc-icon" aria-label="Close editor" title="Close" onClick={onClose}><IconCross size={13} /></button></div>
    {d.mode === 'new' ? <div className="cc-seg" role="group" aria-label="Add from">{([['form', 'Form'], ['json', 'Paste JSON'], ['cmd', 'Paste command']] as [How, string][]).map(([h, l]) => (
      <button key={h} type="button" aria-pressed={ed.how === h} onClick={() => setHow(h)} data-testid={`cc-how-${h}`}>{l}</button>))}</div> : null}
    <div className="cc-ed">
      {ed.how !== 'form' && d.mode === 'new' ? <Importer how={ed.how} cfg={cfg} defLoc={defLoc} busy={busy} onImport={onImport} onImportAll={onImportAll} /> : <>
        {src && d.mode === 'edit' ? <p className="muted cc-file">{describeLocation(src)}</p> : null}
        {ed.notes?.length ? <ul className="cc-notes">{ed.notes.map((n, i) => <li key={i}>{n}</li>)}</ul> : null}
        {src && d.mode === 'edit' && src.warnings.length ? <ul className="cc-warns">{src.warnings.map((w, i) => <li key={i}><IconWarn size={12} /> {w}</li>)}</ul> : null}
        {src?.shadowedBy && d.mode === 'edit' ? <p className="cc-note">Overridden: a {SCOPE_LABEL[src.shadowedBy.scope]} entry with this name wins{src.shadowedBy.project ? ` in ${src.shadowedBy.project}` : ''}.</p> : null}
        {src?.approval && d.mode === 'edit' ? <p className="cc-note">Project approval: <b>{src.approval}</b> (each user approves .mcp.json servers in Claude Code).</p> : null}
        {ro ? null : <fieldset className="cc-fs"><legend>Location</legend>
          <div className="cc-grid cc-loc">
            <label>Scope<select value={d.scope} onChange={(e) => { const s = e.target.value as Scope3; set({ scope: s, project: s === 'user' ? '' : d.project || defLoc.project }); }} data-testid="cc-scope">
              {(['user', 'local', 'project'] as Scope3[]).map((s) => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}</select></label>
            {d.scope !== 'user' ? <label>Project<select value={d.project} onChange={(e) => set({ project: e.target.value })} data-testid="cc-ed-project">
              <option value="">Pick a project…</option>
              {d.project && !cfg.projects.some((p) => p.path === d.project) ? <option value={d.project}>{d.project} (unknown)</option> : null}
              {cfg.projects.map((p) => <option key={p.path} value={p.path}>{p.path}{p.exists ? '' : ' (missing)'}</option>)}</select>{err('project')}</label> : null}
            <label className="cc-wide">Name<input value={d.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} spellCheck={false} placeholder="e.g. postgresql-dev" data-testid="cc-name" />{err('name')}
              {errs.name && d.name.trim() && fix !== d.name.trim() ? <button type="button" className="hist-btn cc-fixname" onClick={() => set({ name: fix })} data-testid="cc-fixname">Use “{fix}”</button> : null}</label>
          </div>
          <p className="muted cc-hint">{SCOPE_HINT[d.scope].replace('<project>', d.project || '<project>')}{d.scope !== 'user' && cfg.projects.some((p) => p.path === d.project && !p.exists) ? ' · this folder no longer exists' : ''}</p>
        </fieldset>}
        <fieldset className="cc-fs"><legend>Server</legend>
          {hasMask && src ? <button type="button" className="hist-btn cc-showsec" aria-pressed={show} onClick={onShow} data-testid="cc-show">{show ? 'Hide secrets' : 'Show hidden parts'}</button> : null}
          <div className="cc-grid">
            <label>Type<select value={t} disabled={ro} onChange={(e) => set({ type: e.target.value })} data-testid="cc-type">
              {[...KNOWN_TYPES, ...(unknown && t ? [t] : [])].map((x) => <option key={x} value={x}>{KNOWN_TYPES.includes(x) ? x : `${x} (unknown)`}</option>)}</select>{ro ? null : err('type')}</label>
            {web || unknown ? <label className="cc-wide">URL<input className="mono" value={hideUrl ? mUrl : d.url} readOnly={ro || hideUrl} onFocus={hideUrl ? onShow : undefined} onChange={(e) => set({ url: e.target.value })} spellCheck={false}
              placeholder={t === 'ws' ? 'wss://…' : 'https://…'} title={hideUrl ? 'Secrets hidden: focus to show and edit' : undefined} data-testid="cc-url" />{err('url')}</label> : null}
            {stdio || unknown ? <label className="cc-wide">Command<input className="mono" value={d.command} readOnly={ro} onChange={(e) => set({ command: e.target.value })} spellCheck={false} placeholder="npx, uvx, node, /path/to/server" data-testid="cc-command" />{err('command')}</label> : null}
          </div>
          {unknown && ro ? <p className="cc-ferr">Unknown type “{t}”: Claude Code may not load it.</p> : null}
          {t === 'ws' ? <p className="muted cc-hint">Test can't start ws servers; it reports “not supported”.</p> : null}
          {stdio || unknown ? <label className="cc-col">Arguments <small className="muted">one per line, in order; spaces inside a line stay in that argument</small>
            <textarea className="mono" rows={Math.min(8, Math.max(2, d.args.split('\n').length + 1))} value={hideArgs ? mArgs : d.args} readOnly={ro || hideArgs} onFocus={hideArgs ? onShow : undefined} onChange={(e) => set({ args: e.target.value })}
              spellCheck={false} title={hideArgs ? 'Secrets hidden: focus to show and edit' : undefined} data-testid="cc-args" /></label> : null}
          {d.lossyArgs ? <p className="cc-ferr">Some stored arguments are empty or contain line breaks; saving from here drops/splits them.</p> : null}
          {stdio || unknown ? <Pairs label="Environment" field="env" rows={d.env} ro={ro} canReveal={canReveal} onChange={(env) => set({ env })} onReveal={onReveal} err={err('env')} /> : null}
          {web || unknown ? <Pairs label="Headers" field="headers" rows={d.headers} ro={ro} canReveal={canReveal} onChange={(headers) => set({ headers })} onReveal={onReveal} err={err('headers')} /> : null}
          {revealErr ? <p className="cc-ferr" role="alert">{revealErr}</p> : null}
          {d.extraKeys.length ? <p className="muted cc-hint">Kept as is: {d.extraKeys.join(', ')}{d.mode === 'clone' ? ' (copied from the original)' : ''}.</p> : null}
        </fieldset>
        <div className="hd-actions cc-actions">
          {!ro ? <button type="button" className="hist-btn cc-primary" onClick={onSave} disabled={locked || !!busy || (d.mode === 'edit' && !dirty)} title={locked ? 'Read-only: saving is off' : d.mode === 'edit' && !dirty ? 'No changes' : undefined} data-testid="cc-save">{busy === 'save' ? 'Saving…' : isNew ? 'Save' : 'Save changes'}</button> : null}
          <button type="button" className="hist-btn" onClick={onTest} disabled={testing} data-testid="cc-test">{testing ? 'Testing…' : 'Test'}</button>
          {src && d.mode === 'edit' ? <button type="button" className="hist-btn" onClick={() => onClone(src)} data-testid="cc-clone">{src.scope === 'settings' ? 'Clone to…' : 'Clone'}</button> : null}
          {src && d.mode === 'edit' && !ro ? <button type="button" className="hist-btn cc-danger" onClick={() => onDelete(src)} disabled={locked || !!busy} data-testid="cc-delete">{busy === 'delete' ? 'Deleting…' : 'Delete'}</button> : null}
          {dirty && d.mode === 'edit' ? <button type="button" className="hist-btn" onClick={onRevert}>Revert</button> : null}
        </div>
        {test || testing ? <TestPanel r={test} testing={testing} /> : null}
      </>}
    </div>
  </>);
}

function Pairs({ label, field, rows, ro, canReveal, onChange, onReveal, err }: { label: string; field: 'env' | 'headers'; rows: PairDraft[]; ro: boolean; canReveal: boolean; onChange: (r: PairDraft[]) => void; onReveal: (f: 'env' | 'headers', i: number) => void; err: ReactNode }) {
  const put = (i: number, p: Partial<PairDraft>) => onChange(rows.map((r, k) => k === i ? { ...r, ...p } : r));
  return <div className="cc-pairs" data-testid={`cc-${field}`}>
    <div className="cc-ph">{label} <small className="muted">{rows.length || 'none'}</small></div>
    {rows.map((p, i) => <div className="cc-pair" key={i}>
      <input className="mono" value={p.key} readOnly={ro} onChange={(e) => put(i, { key: e.target.value })} placeholder={field === 'env' ? 'NAME' : 'Header-Name'} aria-label={`${label} ${i + 1} name`} spellCheck={false} />
      <input className="mono" value={p.value} readOnly={ro} onChange={(e) => put(i, { value: e.target.value })} placeholder={p.masked ? '•••• (unchanged)' : 'value'} aria-label={`${label} ${p.key || i + 1} value`} spellCheck={false} />
      {p.masked && p.value === '' && canReveal && p.orig ? <button type="button" className="cc-icon" title="Reveal the stored value" aria-label={`Reveal ${p.orig}`} onClick={() => onReveal(field, i)} data-testid={`cc-reveal-${p.orig}`}><IconEye size={13} /></button> : <span className="cc-icon-sp" />}
      {!ro ? <button type="button" className="cc-icon" aria-label={`Remove ${p.key || 'row'}`} title="Remove" onClick={() => onChange(rows.filter((_, k) => k !== i))}><IconCross size={12} /></button> : null}
    </div>)}
    {!ro ? <button type="button" className="hist-btn cc-addrow" onClick={() => onChange([...rows, { key: '', value: '' }])}>+ Add {field === 'env' ? 'variable' : 'header'}</button> : null}
    {err}
  </div>;
}

function TestPanel({ r, testing }: { r?: McpTestResult; testing: boolean }) {
  if (testing || !r) return <div className="cc-test" role="status">Starting the server and listing its tools…</div>;
  return <div className={`cc-test ${r.ok ? 'ok' : 'fail'}`} role="status" data-testid="cc-test-result">
    <b>{r.ok ? 'Connected' : 'Failed'}</b>{r.ms ? <span className="muted"> · {r.ms} ms</span> : null}
    {r.server?.name ? <span className="muted"> · {r.server.name}{r.server.version ? ` ${r.server.version}` : ''}</span> : null}
    {r.error ? <p className="cc-ferr">{r.error}</p> : null}
    {r.tools ? <details open={r.tools.length <= 12}><summary>{r.tools.length} tool{r.tools.length === 1 ? '' : 's'}</summary><ul className="cc-tools">{r.tools.map((x) => <li key={x} className="mono">{x}</li>)}</ul></details> : null}
    {r.stderr ? <details open={!r.ok}><summary>stderr (tail)</summary><pre className="md">{r.stderr}</pre></details> : null}
  </div>;
}

/** Paste JSON / a `claude mcp add` command: one server → prefilled form; several → pick and save them in one go (per-item results). */
function Importer({ how, cfg, defLoc, busy, onImport, onImportAll }: { how: 'json' | 'cmd'; cfg: Cfg; defLoc: { scope: Scope3; project: string }; busy?: string; onImport: (it: ImportItem) => void; onImportAll: EdProps['onImportAll'] }) {
  const [text, setText] = useState(''), [res, setRes] = useState<ImportResult>(), [pick, setPick] = useState<boolean[]>([]), [out, setOut] = useState<(string | true)[]>([]), [loc, setLoc] = useState(defLoc);
  const parse = () => { const r = how === 'json' ? parseMcpJson(text) : parseMcpAddCommand(text); setOut([]); if (r.ok && r.items.length === 1) { onImport(r.items[0]); return; } setRes(r); if (r.ok) setPick(r.items.map(() => true)); };
  const items = res?.ok ? res.items : [];
  return <div className="cc-imp">
    <label className="cc-col">{how === 'json' ? <>JSON <small className="muted">{'{"mcpServers": {…}}'}, {'{"name": {…}}'} or one server {'{"command": …}'}</small></> : <>Command <small className="muted">claude mcp add … or claude mcp add-json …</small></>}
      <textarea className="mono" rows={how === 'json' ? 10 : 4} value={text} onChange={(e) => { setText(e.target.value); setRes(undefined); }} spellCheck={false} data-testid="cc-import-text"
        placeholder={how === 'json' ? '{\n  "mcpServers": {\n    "github": { "type": "http", "url": "https://…" }\n  }\n}' : 'claude mcp add -s user -e API_KEY=… my-server -- npx -y some-mcp'} /></label>
    <div className="hd-actions"><button type="button" className="hist-btn cc-primary" onClick={parse} disabled={!text.trim()} data-testid="cc-parse">Parse</button></div>
    {res && !res.ok ? <p className="cc-ferr" role="alert">{res.error}</p> : null}
    {items.length > 1 ? <div className="cc-multi" data-testid="cc-multi">
      <p>{items.length} servers found. Save the checked ones to:</p>
      <div className="cc-grid">
        <label>Scope<select value={loc.scope} onChange={(e) => { const s = e.target.value as Scope3; setLoc({ scope: s, project: s === 'user' ? '' : loc.project }); }}>{(['user', 'local', 'project'] as Scope3[]).map((s) => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}</select></label>
        {loc.scope !== 'user' ? <label className="cc-wide">Project<select value={loc.project} onChange={(e) => setLoc({ ...loc, project: e.target.value })}><option value="">Pick a project…</option>{cfg.projects.map((p) => <option key={p.path} value={p.path}>{p.path}</option>)}</select></label> : null}
      </div>
      <ul className="cc-mlist">{items.map((it, i) => <li key={i}>
        <label><input type="checkbox" checked={!!pick[i]} onChange={(e) => setPick(pick.map((x, k) => k === i ? e.target.checked : x))} /> <b>{it.name}</b> <span className="muted mono">{it.server.type} · {it.server.url ?? [it.server.command, ...(it.server.args ?? [])].join(' ')}</span></label>
        <button type="button" className="hist-btn" onClick={() => onImport(it)}>Edit in form</button>
        {out[i] === true ? <span className="cc-okt">saved</span> : out[i] ? <span className="cc-ferr">{out[i]}</span> : null}
        {it.notes.length ? <small className="muted cc-inote">{it.notes.join(' ')}</small> : null}
      </li>)}</ul>
      <div className="hd-actions"><button type="button" className="hist-btn cc-primary" disabled={!!busy || !cfg.writable || !pick.some(Boolean)} onClick={async () => { const sel = items.filter((_, i) => pick[i]); const r = await onImportAll(sel, loc); let k = 0; setOut(items.map((_, i) => pick[i] ? r[k++] : '')); }} data-testid="cc-import-all">{busy === 'import' ? 'Saving…' : `Save ${pick.filter(Boolean).length} checked`}</button></div>
    </div> : null}
  </div>;
}


/** A pending confirmation: OK runs `run`; cancel label defaults to "Cancel". */
type Ask = { title: string; body: ReactNode; ok: string; cancel?: string; danger?: boolean; run: () => void };
const FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
/** Small modal confirm (the tab stays mounted, hidden when not shown).
 *  Esc / backdrop = cancel; focus starts on Cancel, Tab stays inside, and on close focus goes back to the element focused when it first showed
 *  (the opener; if it opened while its tab was hidden, the element focused when the tab came back), when that is still visible.
 *  active = its tab is visible: the Esc/Tab/focus listeners exist only then, so a dialog left open in the hidden tab never swallows keys elsewhere,
 *  and focus moves back into it when the tab is shown again. */
function Confirm({ a, onClose, active = true }: { a: Ask; onClose: () => void; active?: boolean }) {
  const id = useId(), box = useRef<HTMLDivElement>(null), cancel = useRef<HTMLButtonElement>(null), close = useRef(onClose); close.current = onClose;
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => () => { const o = opener.current; if (o?.isConnected && o.getClientRects().length) o.focus(); }, []);
  useEffect(() => {
    if (!active) return;
    opener.current ??= document.activeElement as HTMLElement | null;
    cancel.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close.current(); return; }
      if (e.key !== 'Tab' || !box.current) return;
      const f = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)], first = f[0], last = f[f.length - 1], at = document.activeElement;
      if (!first) return;
      if (e.shiftKey ? at === first || !box.current.contains(at) : at === last || !box.current.contains(at)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
    };
    const into = (e: FocusEvent) => { if (box.current && !box.current.contains(e.target as Node)) cancel.current?.focus(); };
    document.addEventListener('keydown', key, true); document.addEventListener('focusin', into);
    return () => { document.removeEventListener('keydown', key, true); document.removeEventListener('focusin', into); };
  }, [active]);
  return <div className="editor-back" onClick={onClose}><div ref={box} className="editor cc-confirm" role="alertdialog" aria-modal="true" aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`} onClick={(e) => e.stopPropagation()} data-testid="cc-confirm">
    <h3 id={`${id}-t`}>{a.title}</h3><p id={`${id}-d`}>{a.body}</p>
    <div className="editor-foot"><button ref={cancel} type="button" onClick={onClose}>{a.cancel ?? 'Cancel'}</button><button type="button" className={a.danger ? 'cc-danger-b' : 'primary'} onClick={() => { onClose(); a.run(); }} data-testid="cc-confirm-ok">{a.ok}</button></div>
  </div></div>;
}
