// Test stand-in for the `claude` CLI (OFFICE_CLAUDE_BIN in test/setup.ts): `--version`, `mcp add-json [-s scope] <name> -` (JSON on stdin) and
// `mcp remove [-s scope] <name>`, with Claude Code's scopes: user = OFFICE_CLAUDE_JSON mcpServers, local = its projects[cwd].mcpServers, project = <cwd>/.mcp.json.
// Refuses to run without OFFICE_CLAUDE_JSON or against the real ~/.claude.json. Like the real CLI: add-json checks the name rule and refuses stdin JSON inside a
// Claude Code session (CLAUDE_CODE_CHILD_SESSION / CLAUDECODE). Faults: FAKE_CLAUDE_MANGLE=<name> stores a changed entry, FAKE_CLAUDE_KEEP=<name> fakes a remove. FAKE_CLAUDE_FAIL=<op>|<name>[|<flag file>] makes that call fail; FAKE_CLAUDE_LOG appends each call.
import { appendFileSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
const argv = process.argv.slice(2), die = (m, code = 1) => { process.stderr.write(`${m}\n`); process.exit(code); };
if (argv[0] === '--version') { process.stdout.write('9.9.9 (Claude Code)\n'); process.exit(0); }
const file = process.env.OFFICE_CLAUDE_JSON;
if (!file || resolve(file) === resolve(join(homedir(), '.claude.json'))) die('fake claude: refusing to run without a temp OFFICE_CLAUDE_JSON', 3);
const [cmd, op, ...rest] = argv;
if (cmd !== 'mcp' || (op !== 'add-json' && op !== 'remove')) die(`fake claude: unsupported: ${argv.join(' ')}`, 2);
let scope = 'local'; const pos = [];
for (let i = 0; i < rest.length; i++) if (rest[i] === '-s' || rest[i] === '--scope') scope = rest[++i]; else pos.push(rest[i]);
const [name, json] = pos, cwd = process.cwd(), input = op === 'add-json' && json === '-' ? readFileSync(0, 'utf8') : json;
if (process.env.FAKE_CLAUDE_LOG) appendFileSync(process.env.FAKE_CLAUDE_LOG, `${JSON.stringify({ op, scope, name, cwd, input })}\n`);
if (!['user', 'local', 'project'].includes(scope) || !name) die(`fake claude: bad args: ${argv.join(' ')}`, 2);
// like the real CLI: stdin JSON is refused inside a Claude Code session (FAKE_CLAUDE_SESSION stands for a session marker the office doesn't check itself)
if (op === 'add-json' && json === '-' && (process.env.CLAUDE_CODE_CHILD_SESSION || process.env.CLAUDECODE || process.env.FAKE_CLAUDE_SESSION))
  die('Error: Reading the JSON from stdin is refused inside a Claude Code session, because its permission prompt would not show the server. Run the command outside the session.');
const [fop, fname, once] = (process.env.FAKE_CLAUDE_FAIL ?? '').split('|'); // <op>|<name>[|<flag file>: fail only while it exists, once]
if (fop === op && fname === name && (!once || existsSync(once))) { if (once) rmSync(once); die(`Error: injected failure for ${op} ${name}`); }
if (op === 'add-json' && !/^[A-Za-z0-9_-]+$/.test(name)) die(`Invalid name ${name}. Names can only contain letters, numbers, hyphens, and underscores.`);
const target = scope === 'project' ? join(cwd, '.mcp.json') : file;
const root = existsSync(target) ? JSON.parse(readFileSync(target, 'utf8')) : {};
let map;
if (scope === 'local') { root.projects ??= {}; root.projects[cwd] ??= {}; map = root.projects[cwd].mcpServers ??= {}; } else map = root.mcpServers ??= {};
if (op === 'add-json') {
  let entry; try { entry = JSON.parse(input); } catch { die('Error: Invalid JSON'); }
  if (Object.hasOwn(map, name)) die(`MCP server ${name} already exists in ${scope} config`);
  map[name] = process.env.FAKE_CLAUDE_MANGLE === name ? { ...entry, mangled: true } : entry; // FAKE_CLAUDE_MANGLE: store something else
} else {
  if (!Object.hasOwn(map, name)) die(`No ${scope}-scoped MCP server found with name: ${name}`);
  if (process.env.FAKE_CLAUDE_KEEP === name) process.exit(0); // FAKE_CLAUDE_KEEP: claim success, remove nothing
  delete map[name];
}
writeFileSync(`${target}.tmp`, `${JSON.stringify(root, null, 2)}\n`); renameSync(`${target}.tmp`, target);
process.stdout.write(`${op === 'add-json' ? 'Added' : 'Removed'} ${scope} MCP server ${name}\n`);
