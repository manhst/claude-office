# Văn phòng ảo (virtual office)

A local web office that shows your **running Claude Code sessions** as staff at desks (2D, 3D and Vanphong views).
The office does not run or define agents itself: a small Claude Code mod, `office`, reports each session's activity
to a local server, and the server shows the agents defined for that project.

```
Claude Code session ──(office mod, POST /event, loopback)──> orchestrator :7777 ──(WebSocket + run token)──> browser UI
```

## Quick start (Windows)

1. Install Node.js 20+.
2. In Claude Code, add the mod marketplace from this repo and install the mod:
   ```
   /plugin marketplace add C:\path\to\claude-office\mod
   /plugin install office@office-mods
   ```
   Restart Claude Code sessions after installing.
3. Double-click `start.cmd`. The first run installs dependencies and builds the web UI, then the browser opens
   the office with its per-run token (`http://127.0.0.1:7777/#token=…`).
4. Open Claude Code sessions in any project. They appear in the **Sessions** panel within a few seconds and
   their agents take desks. Close a session and it leaves (immediately on SessionEnd, otherwise after ~60 s with no heartbeat).

Demo without Claude: `start.cmd demo` (macOS/Linux: `./start.command demo`, or `cd orchestrator && npm run demo`)
runs 3 simulated sessions, one per agent-profile source below. For a server without the simulator you can also run
`npx tsx src/simulate.ts http://127.0.0.1:7777/event` from `orchestrator/` against a running office.

## Which agents a session shows

For each session the server (same PC) reads, in priority order:

| | Source | Shown as |
|---|---|---|
| A | `<project>/.claude/agents/*.md` plus user-level `~/.claude/agents/*.md` (or `%CLAUDE_CONFIG_DIR%\agents`) | one desk per agent; YAML frontmatter `name`, `description`, `tools`, `model` + body |
| B | `<project>/CLAUDE.md` (only if A found nothing) | one desk; the file is the agent profile (name = first `# heading`) |
| C | neither | placeholders `Dev 1`, `Dev 2` |

`<project>` is the repo root the mod reports (`$.session.repo()`), else the session cwd. Project agents win over
user agents with the same name. Files over 64 KB are ignored; at most 3 desks per session and 6 desks in total
(extra sessions are still listed in the panel, with a "no free desk" notice).

Live activity is pushed onto those desks so it looks like the agents are working:
- the session's own state/tool goes to the **first** agent (thinking / working + tool chip / talking = waiting for permission / done);
- each running **subagent** goes to the agent whose `name` equals the subagent type (e.g. a `coder` subagent lights up the `coder` desk);
  unmatched subagents are shown on the first agent's bubble.

Click a session in the panel (or a desk in 2D) to see its agent profiles (name, description, tools, model, markdown body as text)
and live activity (state, tool, prompt first sentence, subagents, cost).

## The `office` mod

`mod/.claude-plugin/marketplace.json` (marketplace `office-mods`) → `mod/office/` with
`.claude-plugin/plugin.json` (userConfig `endpoint`, default `http://127.0.0.1:7777/event`) and
`hooks/hooks.json` = `{ "modules": ["./register.ts"] }` → `hooks/register.ts`.

It POSTs JSON events `{type, sid, ...}`: `heartbeat` every 12 s and at register (project, cwd, root, title, transcript path,
state, tool, subagents, cost), `start` on SessionStart, `state` / `tool` on prompt / tool / permission / stop,
`subagents` on subagent start/stop, `end` on SessionEnd. Tool detail is only a file **basename**, the **first line** of a command,
a glob/query, a URL **host** or a subagent description, never file contents; the server also redacts tokens and caps lengths.
Headless `claude -p` sessions are skipped. Non-loopback endpoints are refused by the mod.

Engine API the mod relies on. The type defs were not available when this was written, so every call is optional-chained
and wrapped in try/catch (a missing API only loses detail). **Verify these against `.claude-plugin/types/claude-code/index.d.ts` from usage-esp:**

| Call | Used for | Fallback if missing |
|---|---|---|
| `export function register($)` (also `export default`) | entry point | none |
| `$.on(name, handler)` (then tries `$.hooks.on`, `$.events.on`) | hook events `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, `Notification`, `SubagentStart`, `SubagentStop`, `Stop`, `SessionEnd` | heartbeat only (state stays idle) |
| hook payload `e.cwd`, `e.tool_name`/`toolName`, `e.tool_input`/`toolInput`/`input`, `e.prompt`, `e.message` | cwd, tool, prompt | generic `tool` |
| `$.session.id()` | session id | `CLAUDE_SESSION_ID` env |
| `$.session.repo()` (string or `{root}`) | project root for agent files | cwd |
| `$.session.usage().cost.usd` | cost | omitted |
| `$.session.quiet?.()` / `isQuiet` / `headless`, or `-p`/`--print` in argv | skip headless sessions | argv check |
| `$.agent.list()` → `{id, type, description, status}` | subagents | empty |
| `$.http.fetch(url, {method, headers, body})` | POST events | `globalThis.fetch` |
| `$.clock.setInterval(fn, ms)` (or `$.clock.every(ms, fn)`) | heartbeat | global `setInterval` |
| `$.config.get('endpoint')` / `$.config.endpoint` / `$.userConfig.endpoint` | userConfig | `CLAUDE_PLUGIN_OPTION_ENDPOINT` env, then default |
| `import('node:fs')` | read session title from `<configDir>/projects/<cwd, non-alphanumerics→'-'>/<sid>.jsonl` (`custom-title` > `ai-title`, last 256 KB) | no title |

Also check: the `hooks.json` module path is resolved relative to `hooks/` here (`mod/office/hooks/register.ts`), and the
`userConfig` schema in `plugin.json` matches usage-esp's.

### Why POST /event has no token

The browser token is per run, so the mod cannot know it. Instead `/event` accepts a request only when
1. the peer address is loopback (`127.0.0.1` / `::1`; the server also only listens on 127.0.0.1),
2. there is **no `Origin` and no `Sec-Fetch-Site` header** (browsers always send these on cross-site requests, so a web page cannot post), and
3. `Content-Type` is `application/json` (a cross-origin browser request with that type needs a CORS preflight, which the server never answers).

Payloads are validated, capped at 64 KB and redacted. Any local process could still post fake sessions; it can only make the
office display them, and the server only reads `.claude/agents/*.md` / `CLAUDE.md` under the reported path, showing them to the
token-protected UI. The UI WebSocket keeps the per-run token (URL fragment, Origin check), unchanged.

## Development

```
cd orchestrator && npm install && npm test && npm run typecheck
cd web && npm install && npm test && npm run typecheck && npm run build
```
Server: `tsx src/cli.ts start [--demo] [--port 7777] [--print-token] [--user-agents <dir>]`.
UI dev server: `cd web && npm run dev` then open `http://127.0.0.1:5173/#token=…` (the token from `orchestrator/.run/ui-url.txt`).

Tests cover session tracking (start/heartbeat/end/60 s timeout/desk allocation), profile priority A > B > C, frontmatter parsing,
event ingest auth (loopback, Origin, Content-Type, preflight), payload sanitizing, the mod against a fake engine, and the web reducer/panel helpers.

## Screens

Demo mode (`npm run screens` in `web/`, headless Chrome):
- `docs/screens/session-1280-2d.png`, `session-1280-2d-claude-md.png`, `session-1280-3d.png`, `session-1280-vanphong.png`
- `docs/screens/session-390-2d.png`, `session-390-vanphong.png`

Older `phase*` / `refui*` screenshots show the previous design (orchestrator spawning its own agents), kept for history.

## 3D characters and attribution

The characters are the mannequin from **Universal Animation Library** by **Quaternius**
(<https://quaternius.com/packs/universalanimationlibrary.html>, downloaded from <https://quaternius.itch.io/universal-animation-library>,
file "Universal Animation Library[Standard].zip"). The pack's License.txt places it under **CC0 1.0 Universal** (public domain). A copy
is at [web/public/models/LICENSE-Quaternius.txt](web/public/models/LICENSE-Quaternius.txt). Thanks to Quaternius
(<https://www.patreon.com/quaternius>).

`web/public/models/office-character.glb` is `Unreal-Godot/UAL1_Standard.glb` from that zip, pruned to 5 clips (Idle_Loop,
Idle_Talking_Loop, Sitting_Idle_Loop, Sitting_Talking_Loop and Walk_Loop) and quantized with `web/scripts/prune-model.mjs`
(@gltf-transform). That takes it from 7.6 MB to 0.6 MB (263 kB gzip). The model loads only when you open the 3D view. If it
fails to load, each avatar falls back to a capsule.

To add or swap a model: put a CC0 skinned GLB in `web/public/models/` that has clips with the names above, then point `modelUrl()` in
`web/src/Character.tsx` at it. For testing, `?model=<file>.glb` in the URL overrides the file name. Only use CC0 assets.

## Known issues

- Message arcs are drawn desk-to-desk (seat to seat), not from the walking agent's current position, so while an agent is
  visiting a colleague the arc still starts at its empty seat.
- The sitting pose hovers slightly above the simple box chair; the chair and seat height are not fitted to the animation.
