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

It POSTs JSON events `{type, sid, ...}` (`sid` = the full session id), one at a time in event order:
`start` on `session.start` and a `heartbeat` every 12 s (project, cwd, root, title, transcript path), `state` / `tool` on
turn start, tool calls, permission requests and turn completion, `subagents` when a subagent starts a turn or calls a tool,
`end` on `session.end`. Every post also carries state, tool, prompt first sentence, subagents and cost.
Tool detail is only a file **basename**, the **first line** of a command, a URL **host**, a pattern/query or a description,
never file contents; the server also redacts tokens and caps lengths. Headless `claude -p` sessions
(`CLAUDE_CODE_ENTRYPOINT=sdk-cli`) are skipped. Non-loopback endpoints are refused by the mod.

Engine API used (the same as in the owner's usage-esp mod). Handlers only observe and always call `next(e)`; the classic
and `tool.call` handlers also have `.catch(($, e, next) => next(e))` so they never block.

| API | Used for |
|---|---|
| `export const register: Register = (on, options)`; `options.endpoint` from `plugin.json` userConfig | entry point, endpoint |
| `on('session.start')`: `e.cwd`, `$.env.get('CLAUDE_CODE_ENTRYPOINT' / 'USERPROFILE' / 'HOME' / 'CLAUDE_CONFIG_DIR')`, `$.session.id()`, `$.session.repo()` → `root` | session info, quiet check, transcript path |
| `$.clock.every(12000, fn)` | heartbeat |
| `on('turn.start')`: `e.agentId` (undefined = main turn) | thinking |
| `on('tool.call')`: `e.tool` + tool args on `e`, `e.agentId`, `next.origin.plugin === 'engine'` | current tool (model's own calls only) |
| `on('classic.PermissionRequest')`: `e.tool_name`, `e.tool_input` | waiting for permission |
| `on('classic.SessionStart')`, `on('classic.UserPromptSubmit')`: `e.session_title`, `e.transcript_path`, `e.prompt` (if a string) | title, prompt |
| `on('turn.complete')`: `e.agentId`, `e.reason` (`aborted` → idle, otherwise done) | done |
| `on('session.end')` | end |
| `$.agent.list()` → `{type, description, status}` | subagents |
| `$.session.usage()` → `cost.usd` | cost |
| `$.http.fetch(url, {method: 'POST', headers, body})` | posting events |
| `$.fs.exists(path)`, `$.fs.read(path)` | title from the transcript (`custom-title` > `ai-title`) when no `session_title` was given |

Not confirmed: the name of the prompt text field on `classic.UserPromptSubmit` (`e.prompt` is used only when it is a string).
For typechecking without the engine's types package, `orchestrator/test/claude-code.d.ts` declares a stand-in `claude-code` module.

### Why POST /event has no token

The browser token is per run, so the mod cannot know it. Instead `/event` accepts a request only when
1. the peer address is loopback (`127.0.0.1` / `::1`; the server also only listens on 127.0.0.1),
2. it does not look like a browser page: requests are rejected if `Origin` is an http(s) URL or `null`, or if `Sec-Fetch-Site` is
   `cross-site` / `same-site`. When these headers are absent the request is allowed, because we don't know whether `$.http.fetch` sends them, and
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
