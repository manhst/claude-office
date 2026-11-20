// Tiny stdio MCP server for probe tests. FAKE_MCP_MODE: ok (default) | crash | silent | error | flood. FAKE_MCP_ECHO is echoed to stderr / the error. FAKE_MCP_CHILD_PID_FILE: spawns a long-lived child and
// writes its pid there (the probe must kill the whole group). FAKE_TOOL renames the second tool (proves the entry env reaches the server).
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
const mode = process.env.FAKE_MCP_MODE ?? 'ok', send = (m) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`);
process.stderr.write(`fake mcp up, key sk-${'a'.repeat(24)} cwd=${process.cwd()} args=${process.argv.slice(2).join(' ')} echo=${process.env.FAKE_MCP_ECHO ?? ''}\n`);
if (process.env.FAKE_MCP_CHILD_PID_FILE) writeFileSync(process.env.FAKE_MCP_CHILD_PID_FILE, String(spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }).pid));
if (mode === 'crash') { process.stderr.write('boom\n'); process.exit(3); }
if (mode === 'flood') process.stdout.write('x'.repeat(5 << 20)); // no newline
createInterface({ input: process.stdin }).on('line', (l) => {
  const m = JSON.parse(l);
  if (mode === 'silent') return;
  if (m.method === 'initialize') {
    if (mode === 'error') return send({ id: m.id, error: { code: -32000, message: `bad init${process.env.FAKE_MCP_ECHO ? ` for ${process.env.FAKE_MCP_ECHO}` : ''}` } });
    process.stdout.write('a log line that is not JSON\n'); send({ method: 'notifications/message', params: { level: 'info', data: 'hello' } }); send({ id: 'srv-1', method: 'roots/list' });
    return send({ id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fake-mcp', version: '1.2.3' } } });
  }
  if (m.method === 'tools/list') return m.params?.cursor ? send({ id: m.id, result: { tools: [{ name: 'page2' }] } }) : send({ id: m.id, result: { tools: [{ name: 'echo' }, { name: process.env.FAKE_TOOL ?? 'add' }], nextCursor: 'p2' } });
});
