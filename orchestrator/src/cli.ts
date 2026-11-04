import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CliDriver, MockDriver } from './driver.js';
import { Orchestrator } from './orchestrator.js';
import { OfficeServer, newToken, redactUrl } from './server.js';
import { JsonlLog } from './log.js';
import { ROLES } from './types.js';
const here = dirname(fileURLToPath(import.meta.url));
export interface StartOpts { task: string; mock: boolean; role: string; port: number; logDir: string; fixture: string; keepAlive: boolean; printToken: boolean }
export function parseArgs(argv: string[]): StartOpts {
  const o: StartOpts = { task: '', mock: process.env.OFFICE_MOCK === '1', role: 'researcher', port: 7777, logDir: resolve(here, '../logs'),
    fixture: resolve(here, '../fixtures/researcher.stream.jsonl'), keepAlive: false, printToken: false };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--mock') o.mock = true; else if (a === '--role') o.role = argv[++i];
    else if (a === '--port') o.port = Number(argv[++i]); else if (a === '--log-dir') o.logDir = resolve(argv[++i]);
    else if (a === '--fixture') o.fixture = resolve(argv[++i]); else if (a === '--keep-alive') o.keepAlive = true;
    else if (a === '--print-token') o.printToken = true; else rest.push(a);
  }
  o.task = rest.join(' ').trim();
  return o;
}
export async function start(o: StartOpts, onReady?: (wsUrl: string) => void) {
  const role = ROLES[o.role]; if (!role) throw new Error(`unknown role ${o.role}`);
  if (!o.task) throw new Error('usage: start "task" [--mock] [--role researcher|coder|reviewer] [--port 7777]');
  const orch = new Orchestrator(o.mock ? new MockDriver(o.fixture) : new CliDriver());
  const token = newToken();
  const server = new OfficeServer(token, () => orch.snapshot());
  const log = new JsonlLog(join(o.logDir, `run-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`));
  orch.on((e) => { log.write(e); server.broadcast(e); console.log(JSON.stringify(e)); });
  const port = await server.listen(o.port);
  const wsUrl = `ws://127.0.0.1:${port}/ws?token=${token}`;
  console.error(`[office] driver=${o.mock ? 'mock' : 'cli'} role=${role.role} log=${log.path}`);
  console.error(`[office] UI WebSocket: ${o.printToken ? wsUrl : redactUrl(wsUrl)}`);
  onReady?.(wsUrl);
  const stop = () => { orch.cancelAll(); server.close().then(() => process.exit(130)); };
  process.once('SIGINT', stop);
  const result = await orch.spawn(o.task, role);
  console.error(`[office] agent finished: ${result}`);
  if (!o.keepAlive) await server.close();
  return { result, logPath: log.path };
}
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd !== 'start') { console.error('usage: cli.ts start "task" [--mock]'); process.exit(2); }
  start(parseArgs(rest)).then((r) => process.exit(r.result === 'done' ? 0 : 1), (e) => { console.error(`[office] ${e.message}`); process.exit(2); });
}
