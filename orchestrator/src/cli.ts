import { resolve, dirname, join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { SessionTracker } from './sessions.js';
import { OfficeServer, newToken } from './server.js';
import { JsonlLog } from './log.js';
import { simulate } from './simulate.js';
const here = dirname(fileURLToPath(import.meta.url));
export interface StartOpts { demo: boolean; port: number; logDir: string; printToken: boolean; webDir: string; stepMs: number; userAgentsDir?: string }
export function parseArgs(argv: string[]): StartOpts {
  const o: StartOpts = { demo: process.env.OFFICE_DEMO === '1', port: 7777, logDir: resolve(here, '../logs'), printToken: false, webDir: resolve(here, '../../web/dist'), stepMs: 1500,
    userAgentsDir: process.env.OFFICE_USER_AGENTS_DIR ?? join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'agents') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--demo' || a === '--mock') o.demo = true; else if (a === '--port') o.port = Number(argv[++i]);
    else if (a === '--log-dir') o.logDir = resolve(argv[++i]); else if (a === '--print-token') o.printToken = true;
    else if (a === '--step-ms') o.stepMs = Number(argv[++i]); else if (a === '--user-agents') o.userAgentsDir = argv[++i] || undefined;
  }
  if (o.demo && !process.env.OFFICE_USER_AGENTS_DIR && !argv.includes('--user-agents')) o.userAgentsDir = undefined; // demo stays deterministic (A/B/C fixtures only)
  return o;
}
/** Starts the office server. Sessions come from the `office` Claude Code mod (POST /event); --demo runs the built-in simulator. */
export async function start(o: StartOpts) {
  const tracker = new SessionTracker({ userAgentsDir: o.userAgentsDir });
  const token = newToken();
  const server = new OfficeServer(token, () => tracker.snapshot(), { onEvent: (p) => tracker.ingest(p), staticDir: existsSync(o.webDir) ? o.webDir : undefined });
  const log = new JsonlLog(join(o.logDir, `run-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`));
  tracker.on((e) => { if (e.t !== 'sessions.update') log.write(e); server.broadcast(e); });
  const sweep = setInterval(() => tracker.sweep(), 5000); sweep.unref();
  const port = await server.listen(o.port);
  const uiUrl = `http://127.0.0.1:${port}/#token=${token}`;
  const runDir = resolve(here, '../.run'); mkdirSync(runDir, { recursive: true, mode: 0o700 });
  writeFileSync(join(runDir, 'ui-url.txt'), uiUrl + '\n', { mode: 0o600 });
  console.error(`[office] mod events: POST http://127.0.0.1:${port}/event   log=${log.path}${o.demo ? '   (demo sessions)' : ''}`);
  console.error(`[office] UI: ${o.printToken ? uiUrl : uiUrl.replace(/#token=.*/, '#token=[REDACTED]')} (full URL in orchestrator/.run/ui-url.txt, mode 600)`);
  if (o.demo) void simulate(`http://127.0.0.1:${port}/event`, { stepMs: o.stepMs });
  const close = async () => { clearInterval(sweep); await server.close(); };
  return { port, token, tracker, server, close, logPath: log.path };
}
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd !== 'start') { console.error('usage: cli.ts start [--demo] [--port 7777]'); process.exit(2); }
  start(parseArgs(rest)).then((r) => { console.error('[office] running: Ctrl-C to stop'); process.once('SIGINT', () => r.close().then(() => process.exit(130))); },
    (e) => { console.error(`[office] ${e.message}`); process.exit(2); });
}
