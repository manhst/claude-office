import { resolve, dirname, join, delimiter } from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { SessionTracker } from './sessions.js';
import { DeckServer, newToken } from './server.js';
import { PromptInbox } from './inbox.js';
import { JsonlLog, turnLogGate } from './log.js';
import { simulate } from './simulate.js';
import { UsageStore } from './usage.js';
import { ItOpsMonitor } from './itops.js';
import { HistoryIndex, historyRoot } from './history.js';
import { ModelReport } from './modelReport.js';
import { SessionOpener } from './opener.js';
import { SessionDeleter } from './historyDelete.js';
import { BookmarkStore } from './bookmarks.js';
import { ClaudeConfig, claudeConfigDir, claudePaths } from './claudeConfig.js';
import { applyLegacyEnv, migrateLegacySettings } from './env.js';
import { applyPatch, loadSettings, resolveItopsConfig, saveSettings, toView, type DeckSettingsFile, type SettingsPatch } from './settings.js';
const here = dirname(fileURLToPath(import.meta.url));
/** "now" of the demo model report (the demo transcripts are dated 2026-11). */
export const DEMO_NOW = new Date(2026, 10, 20, 12).getTime();
export interface StartOpts { demo: boolean; port: number; logDir: string; printToken: boolean; webDir: string; stepMs: number; userAgentsDir?: string; prometheus?: string; settingsPath?: string; historyDir?: string; bookmarksPath?: string; runDir?: string }
export function parseArgs(argv: string[]): StartOpts {
  const o: StartOpts = { demo: process.env.DECK_DEMO === '1', port: 7777, logDir: resolve(here, '../logs'), printToken: false, webDir: resolve(here, '../../web/dist'), stepMs: 1500,
    userAgentsDir: process.env.DECK_USER_AGENTS_DIR ?? join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'agents'), historyDir: process.env.DECK_HISTORY_DIR ? resolve(process.env.DECK_HISTORY_DIR) : undefined,
    bookmarksPath: process.env.DECK_HISTORY_BOOKMARKS ? resolve(process.env.DECK_HISTORY_BOOKMARKS) : undefined, runDir: process.env.DECK_RUN_DIR ? resolve(process.env.DECK_RUN_DIR) : undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--demo' || a === '--mock') o.demo = true; else if (a === '--port') o.port = Number(argv[++i]);
    else if (a === '--log-dir') o.logDir = resolve(argv[++i]); else if (a === '--print-token') o.printToken = true;
    else if (a === '--step-ms') o.stepMs = Number(argv[++i]); else if (a === '--user-agents') o.userAgentsDir = argv[++i] || undefined;
    else if (a === '--prometheus') o.prometheus = argv[++i];
    else if (a === '--settings' && argv[i + 1]) o.settingsPath = resolve(argv[++i]);
    else if (a === '--history-dir' && argv[i + 1]) o.historyDir = resolve(argv[++i]);
  }
  if (o.demo && !process.env.DECK_USER_AGENTS_DIR && !argv.includes('--user-agents')) o.userAgentsDir = undefined; // demo stays deterministic (A/B/C fixtures only)
  return o;
}
/** Starts the Claude Deck server. Sessions come from the `deck` Claude Code mod (POST /event); --demo runs the built-in simulator. */
export async function start(o: StartOpts) {
  const runDir = o.runDir ?? resolve(here, '../.run'); mkdirSync(runDir, { recursive: true, mode: 0o700 });
  if (!o.settingsPath) migrateLegacySettings(runDir);
  const settingsPath = o.settingsPath ?? join(runDir, 'deck-settings.json');
  let file: DeckSettingsFile = loadSettings(settingsPath);
  const tracker = new SessionTracker({ userAgentsDir: o.userAgentsDir });
  const token = newToken();
  let server!: DeckServer;
  const inbox = new PromptInbox({ onStatus: (a) => server?.broadcast(a) });
  const itops = new ItOpsMonitor(resolveItopsConfig(process.env, o.demo, o.prometheus, file), (status) => server?.broadcast({ t: 'itops.status', status, ts: Date.now() }));
  const usage = new UsageStore(); usage.onChange = (u) => server?.broadcast({ t: 'usage.update', usage: u, ts: Date.now() });
  const view = () => toView(file, itops.config, itops.status, o.demo);
  // History tab: past transcripts; demo shows fixtures only, never this machine's sessions
  const bookmarks = new BookmarkStore(o.bookmarksPath ?? (o.demo ? undefined : join(runDir, 'history-bookmarks.json'))); // demo: memory only
  const histRoot = o.historyDir ?? (o.demo ? resolve(here, '../fixtures/demo/history') : historyRoot());
  const history = new HistoryIndex(histRoot, { bookmarks });
  // Performance tab: per-model stats from the same transcripts, parsed on first use; the demo fixtures are dated, so demo pins "today" to 2026-11-20
  // History "Reopen": resumes a past session in iTerm/Terminal/Cursor/VS Code (macOS) or Windows Terminal/Cursor/VS Code; demo lists no apps and launches nothing
  const opener = new SessionOpener({ demo: o.demo, runDir, historyRoot: histRoot, locate: (sid) => history.locate(sid), isLive: (sid) => tracker.list().some((s) => s.sid === sid) });
  const modelReport = new ModelReport(histRoot, o.demo && !o.historyDir ? { now: () => DEMO_NOW } : {});
  // History "Delete from this machine": local files of one session + Claude Deck's own data (its logs too); demo never deletes (fixtures).
  // Scratchpads: DECK_SCRATCH_ROOTS (path list), else os.tmpdir() and /tmp; under vitest only the override.
  const scratchRoots = process.env.DECK_SCRATCH_ROOTS ? process.env.DECK_SCRATCH_ROOTS.split(delimiter).filter(Boolean) : process.env.VITEST || process.platform === 'win32' ? [] : [tmpdir(), '/tmp'];
  const deleter = new SessionDeleter({ demo: o.demo, historyRoot: histRoot, configDir: claudeConfigDir(), logDir: o.logDir, scratchRoots, bookmarks, locate: (sid) => history.locate(sid),
    isLive: (sid) => tracker.list().some((s) => s.sid === sid), openedRecently: (sid) => opener.openedRecently(sid),
    forget: (sid, files) => { history.forget(sid, files); for (const f of files) modelReport.forget(f); } });
  // Claude config tab: Claude Code's MCP servers; demo reads fixtures (project paths mapped under fixtures/…/fs) and never writes
  const ccDemo = o.demo ? resolve(here, '../fixtures/demo/claude-config') : undefined;
  const claude = new ClaudeConfig({ ...claudePaths(process.env, ccDemo), runDir, demo: o.demo, fsRoot: ccDemo && !process.env.DECK_CLAUDE_JSON ? join(ccDemo, 'fs') : undefined });
  const liveSid = (raw: unknown) => {
    const sid = typeof (raw as any)?.sid === 'string' ? String((raw as any).sid).replace(/[^\w-]/g, '').slice(0, 64) : '';
    return sid && tracker.list().some((s) => s.sid === sid) ? sid : '';
  };
  server = new DeckServer(token, () => ({ ...tracker.snapshot(), prompts: inbox.view(), itops: itops.status, usage: usage.latest }) as any, {
    onEvent: (p) => {
      if ((p as any)?.type === 'usage') return usage.accept(p);
      const ok = tracker.ingest(p); if (!ok) return false;
      const sid = liveSid(p);
      if (!sid) { const gone = typeof (p as any)?.sid === 'string' ? String((p as any).sid).replace(/[^\w-]/g, '').slice(0, 64) : ''; if (gone) inbox.drop(gone); return true; }
      return { ok: true as const, inboxToken: inbox.ensureToken(sid) };
    },
    onPrompt: (p) => {
      const sid = typeof p.sid === 'string' ? p.sid.replace(/[^\w-]/g, '').slice(0, 64) : '';
      const s = tracker.list().find((x) => x.sid === sid);
      return inbox.enqueue(sid, p.text, p.nonce, { exists: !!s, canSubmit: !!s?.canSubmit }, { model: p.model, effort: p.effort });
    },
    onInboxClaim: (sid, tok) => inbox.claim(sid, tok),
    onInboxAck: (sid, tok, id, state, reason) => inbox.ack(sid, tok, id, state as any, reason),
    staticDir: existsSync(o.webDir) ? o.webDir : undefined,
    history, claude, modelReport, opener, deleter,
    getSettings: () => view(),
    setSettings: (raw) => {
      try {
        const next = applyPatch(file, (raw ?? {}) as SettingsPatch);
        saveSettings(settingsPath, next);
        file = next;
        // Settings UI/API is source of truth after save; CLI/env only seed the first load.
        itops.reconfigure(resolveItopsConfig(process.env, o.demo, undefined, file));
        return { ok: true as const, view: view() };
      } catch (e) { return { ok: false as const, error: String((e as Error).message ?? e).slice(0, 200) }; }
    },
  });
  const log = new JsonlLog(join(o.logDir, `run-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`));
  const logTurn = turnLogGate();
  tracker.on((e) => { if (e.t !== 'sessions.update' && logTurn(e)) log.write(e); server.broadcast(e); });
  const sweep = setInterval(() => { tracker.sweep(); inbox.expire(); inbox.retain(new Set(tracker.list().map((s) => s.sid))); }, 5000); sweep.unref();
  const port = await server.listen(o.port);
  void history.refresh().then(() => { if (history.scannedAt) console.error(`[deck] history: ${history.stats.files} transcripts in ${history.stats.ms} ms (${history.root})`); }, () => {});
  itops.start();
  console.error(`[deck] IT Ops: ${itops.status.mode}${itops.status.endpoint ? ` ${itops.status.endpoint}` : ''}`);
  const uiUrl = `http://127.0.0.1:${port}/#token=${token}`;
  writeFileSync(join(runDir, 'ui-url.txt'), uiUrl + '\n', { mode: 0o600 });
  console.error(`[deck] mod events: POST http://127.0.0.1:${port}/event   log=${log.path}${o.demo ? '   (demo sessions)' : ''}`);
  console.error(`[deck] UI: ${o.printToken ? uiUrl : uiUrl.replace(/#token=.*/, '#token=[REDACTED]')} (full URL in orchestrator/.run/ui-url.txt, mode 600)`);
  console.error(`[deck] settings: ${settingsPath}`);
  if (o.demo) void simulate(`http://127.0.0.1:${port}/event`, { stepMs: o.stepMs });
  const close = async () => { clearInterval(sweep); itops.stop(); history.stop(); modelReport.stop(); await server.close(); };
  return { port, token, tracker, server, inbox, usage, itops, history, modelReport, opener, deleter, bookmarks, claude, settingsPath, close, logPath: log.path };
}
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  applyLegacyEnv();
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd !== 'start') { console.error('usage: cli.ts start [--demo] [--port 7777]'); process.exit(2); }
  start(parseArgs(rest)).then((r) => { console.error('[deck] running: Ctrl-C to stop'); process.once('SIGINT', () => r.close().then(() => process.exit(130))); },
    (e) => { console.error(`[deck] ${e.message}`); process.exit(2); });
}
