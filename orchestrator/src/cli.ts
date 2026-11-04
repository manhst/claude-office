import { resolve, dirname, join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CliDriver, MockDriver } from './driver.js';
import { Orchestrator } from './orchestrator.js';
import { OfficeServer, newToken, redactUrl } from './server.js';
import { JsonlLog } from './log.js';
import { ROLES } from './types.js';
const here = dirname(fileURLToPath(import.meta.url));
export interface StartOpts { task: string; mock: boolean; role: string; port: number; logDir: string; fixture: string; keepAlive: boolean; printToken: boolean; mockDelay: number; startDelay: number; office: boolean; webDir: string }
export function parseArgs(argv: string[]): StartOpts {
  const o: StartOpts = { task: '', mock: process.env.OFFICE_MOCK === '1', role: 'researcher', port: 7777, logDir: resolve(here, '../logs'),
    fixture: resolve(here, '../fixtures/researcher.stream.jsonl'), keepAlive: false, printToken: false, mockDelay: 150, startDelay: 150, office: false, webDir: resolve(here, '../../web/dist') };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--mock') o.mock = true; else if (a === '--role') o.role = argv[++i];
    else if (a === '--port') o.port = Number(argv[++i]); else if (a === '--log-dir') o.logDir = resolve(argv[++i]);
    else if (a === '--fixture') o.fixture = resolve(argv[++i]); else if (a === '--keep-alive') o.keepAlive = true;
    else if (a === '--print-token') o.printToken = true; else if (a === '--mock-delay') o.mockDelay = Number(argv[++i]); else if (a === '--start-delay') o.startDelay = Number(argv[++i]);
    else if (a === '--office') o.office = true; else if (a === '--single') o.office = false; else rest.push(a);
  }
  o.task = rest.join(' ').trim();
  return o;
}
export async function start(o: StartOpts, onReady?: (wsUrl: string, uiUrl: string) => void) {
  const role = ROLES[o.role]; if (!role) throw new Error(`unknown role ${o.role}`);
  if (!o.task) throw new Error('usage: start "task" [--mock] [--role researcher|coder|reviewer] [--port 7777]');
  // --office: multi-agent mock fixtures (fixtures/office/<role>.<turn>.jsonl); default single fixture keeps phase-1 behaviour
  const fixtures = o.office ? (r: string, t: number) => resolve(here, `../fixtures/office/${r}.${t}.jsonl`) : o.fixture;
  const orch = new Orchestrator(o.mock ? new MockDriver(fixtures, o.mockDelay) : new CliDriver());
  const token = newToken();
  const server = new OfficeServer(token, () => orch.snapshot(), { onHook: (p) => orch.ingestHook(p), staticDir: existsSync(o.webDir) ? o.webDir : undefined });
  const log = new JsonlLog(join(o.logDir, `run-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`));
  orch.on((e) => { log.write(e); server.broadcast(e); console.log(JSON.stringify(e)); });
  const port = await server.listen(o.port);
  const wsUrl = `ws://127.0.0.1:${port}/ws?token=${token}`;
  console.error(`[office] driver=${o.mock ? 'mock' : 'cli'} role=${role.role} log=${log.path}`);
  const uiUrl = `http://127.0.0.1:${port}/#token=${token}`;
  const runDir = resolve(here, '../.run'); mkdirSync(runDir, { recursive: true, mode: 0o700 });
  writeFileSync(join(runDir, 'ui-url.txt'), uiUrl + '\n', { mode: 0o600 });
  console.error(`[office] WebSocket: ${o.printToken ? wsUrl : redactUrl(wsUrl)}  hook: POST http://127.0.0.1:${port}/hook (X-Office-Token)`);
  console.error(`[office] UI: ${o.printToken ? uiUrl : uiUrl.replace(/#token=.*/, '#token=[REDACTED]')} (full URL in orchestrator/.run/ui-url.txt, mode 600)`);
  onReady?.(wsUrl, uiUrl);
  const stop = () => { orch.cancelAll(); server.close().then(() => process.exit(130)); };
  process.once('SIGINT', stop);
  await new Promise((r) => setTimeout(r, o.startDelay)); // let already-open UIs connect before the first event
  const result = await orch.run(o.task, role.role);
  console.error(`[office] agent finished: ${result}`);
  if (!o.keepAlive) await server.close(); else console.error('[office] keep-alive: Ctrl-C to stop');
  return { result, logPath: log.path };
}
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd !== 'start') { console.error('usage: cli.ts start "task" [--mock]'); process.exit(2); }
  const opts = parseArgs(rest);
  start(opts).then((r) => { if (!opts.keepAlive) process.exit(r.result === 'done' ? 0 : 1); }, (e) => { console.error(`[office] ${e.message}`); process.exit(2); });
}
