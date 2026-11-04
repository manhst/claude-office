// End-to-end mock demo: start orchestrator with MockDriver, connect an authed WS client, print what it receives.
import WebSocket from 'ws';
import { start, parseArgs } from './cli.js';
const o = parseArgs(['--mock', '--port', '0', ...process.argv.slice(2)]);
if (!o.task) o.task = 'Find the latest Claude Code Mods API docs and summarize';
let got = 0;
const r = await start(o, (url) => {
  const ws = new WebSocket(url, { origin: 'http://127.0.0.1:5173' });
  ws.on('message', (m) => { got++; const e = JSON.parse(String(m)); console.error(`[ws-client] <- ${e.t}${e.state ? ' ' + e.state : ''}${e.tool ? ' ' + e.tool : ''}`); });
  const bad = new WebSocket(url.replace(/token=[^&]+/, 'token=wrong'));
  bad.on('error', () => console.error('[ws-client] bad-token connection rejected (expected)'));
  bad.on('open', () => { console.error('[ws-client] ERROR: bad token accepted'); process.exitCode = 1; });
});
console.error(`[demo] result=${r.result} ws_messages=${got} log=${r.logPath}`);
