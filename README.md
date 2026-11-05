# Văn phòng ảo (virtual office)

A local web office that shows your **running Claude Code sessions** as staff at desks in a voxel office (the Vanphong view).
The office does not run or define agents itself: a small Claude Code mod, `office`, reports each session's activity
to a local server, and the server shows the agents defined for that project.

```
Claude Code session ──(office mod, POST /event, loopback)──> orchestrator :7777 ──(WebSocket + run token)──> browser UI
```

## Quick start (Windows)

1. Install Node.js 20+.
2. Double-click `start.cmd` (macOS/Linux: `./start.command`). In order, it:
   1. runs `git pull --ff-only` (if that fails it prints a warning and continues with the local copy);
   2. clears the screen;
   3. installs the `office` mod into Claude Code (`node scripts/install-mod.mjs`, see below);
   4. on first run, runs `npm install` and builds the web UI, then starts the server and opens the browser with the per-run token (`http://127.0.0.1:7777/#token=…`).
3. Reopen any Claude Code sessions that were already open, so they load the mod.
4. Open Claude Code sessions in any project. They appear in the **Sessions** panel within a few seconds and
   their agents take desks. Close a session and it leaves (immediately on SessionEnd, otherwise after ~60 s with no heartbeat).

Demo without Claude: `start.cmd demo` (macOS/Linux: `./start.command demo`, or `cd orchestrator && npm run demo`)
runs 3 simulated sessions, one per agent-profile source below. For a server without the simulator you can also run
`npx tsx src/simulate.ts http://127.0.0.1:7777/event` from `orchestrator/` against a running office.

### How the mod gets installed

`scripts/install-mod.mjs` (Node, no dependencies; it works the same way as esp-claude's `install.ps1`) edits `${CLAUDE_CONFIG_DIR or ~/.claude}/settings.json`:
- If `<config>/plugins/installed_plugins.json` already lists `office@…` (installed through the marketplace), it leaves
  `CLAUDE_CODE_PLUGIN_DIRS` alone except to remove this repo's `mod/office` from it, so the mod is not loaded twice.
- Otherwise it adds the absolute path of `mod/office` to `env.CLAUDE_CODE_PLUGIN_DIRS` (`;`-separated on Windows, `:` on macOS/Linux). Existing entries such as usage-esp's dir are kept, and duplicates are removed.
- It sets `pluginConfigs.office.options.endpoint` (and `pluginConfigs["office@…"]` when installed) to `http://127.0.0.1:<port>/event` and touches no other option.
- It writes only when something changed. In that case it first backs up the file to `settings.json.bak-YYYYMMDD-HHmmss`, then writes UTF-8 without BOM, 2-space JSON, keeping all other keys.
  It prints only the mod path and endpoint, never other settings (they may contain tokens). Use `--port N` for a non-default port.

Manual alternative: `/plugin marketplace add C:\path\to\claude-office\mod` then `/plugin install office@office-mods`.
The next run of `start.cmd` then detects the installed plugin and removes the plugin-dirs entry.

## Town around the office

The Vanphong view (the only view) puts the voxel office inside a small town. Sessions and agents work exactly as before.
- Roads with a zebra crossing, **Crossian Cafe**, a sidewalk **trà đá** stall, and a **crocodile pond** next to the office, all in Vanphong's voxel style (`web/src/ref-vanphong/town3d.ts`).
- **Click or right-click an agent's or side character's name** for **Đặt tên & avatar** or **Ném cho cá sấu**. A thrown agent flies into the pond, the crocodiles eat it, and it walks back in through the office door 20 s later. Side characters reappear on the street after 15 s.
- **Name and avatar** reuse Phúc's VanphongAI picker: the 20 chibi presets (`web/src/ref-vanphong/nhanVat.ts`, Nữ/Nam tabs). Choices are kept in this browser's localStorage and apply at once, also to agents already in the office. Agents are keyed by profile name, so the same agent keeps its look in every session.
- **Side characters** are simulated in the browser (`web/src/town/sim.ts`) and walk around the building, not through it:
  - Tèo, Tý, Bờm and Mít wander, chat nonsense, drink coffee or beer and run outside, and sometimes slip into the pond.
  - **Chos An** the dog barks wildly. **Meow** the cat picks fights with him.
- **IT Ops** watches a Prometheus-compatible HTTP API from the kiosk on the front street. When it sees a problem it runs to the **Architect** and reports the alert in a red speech bubble. The kiosk label shows the monitor state.

| Env / flag | Meaning |
|---|---|
| `OFFICE_PROMETHEUS_URL` or `--prometheus URL` | Base URL, e.g. `http://prometheus:9090`. The server calls `GET <url>/api/v1/query?query=…`. Credentials in the URL are used but never shown or sent to the UI. |
| `OFFICE_PROMETHEUS_QUERY` | Instant query; every returned series counts as a problem. Default `ALERTS{alertstate="firing"}`. |
| `OFFICE_PROMETHEUS_INTERVAL_MS` | Poll interval, default 30000 (min 2000). |

Not configured: the badge says **chưa cấu hình** and IT Ops stays at the kiosk, with no fake alerts. If the API can't be read, the error itself is reported.
`--demo` with no URL runs a monitor labelled **(demo)** that alternates ok and `DEMO HighLatency` every 15 s.
**Xuka Mát xa** sits across the back street from Crossian Cafe; NPCs drop in now and then, lie on a bed and chat about massages (PG, comedic).

**Main-road traffic** (front street, `web/src/town/traffic.ts`, at most 5 vehicles plus responders): 22 voxel vehicle types (xe máy, xe đạp, xe ôm Grab, ô tô con, taxi, bán tải, xe buýt, ô tô tải, container, trộn bê tông, xe rác, xe cẩu, xe lu, máy xúc, máy ủi, xe tăng, ba gác, cứu thương, cứu hỏa, cảnh sát, xe kiểm tra đường, xe bán kem). Vehicles sometimes knock a pedestrian over (they get back up), rear-end each other (both drivers get out and argue in turns; police come), or catch fire and explode (fire truck comes; the wreck is cleared after a while). Comedic only.

**Dialogue** lives in `web/src/town/dialogue.ts`: 31 line categories plus two-sided argument pairs (work arguments, crash arguments); `web/test/dialogue.test.ts` checks every category has at least 30 unique lines.

Screenshots: `docs/screens/town-*.png` (`cd web && npm run build && node scripts/screens-town.mjs`).

## Which agents a session shows

For each session the server (same PC) reads, in priority order:

| | Source | Shown as |
|---|---|---|
| A | `<project>/.claude/agents/*.md` plus user-level `~/.claude/agents/*.md` (or `%CLAUDE_CONFIG_DIR%\agents`) | one desk per agent; YAML frontmatter `name`, `description`, `tools`, `model` + body |
| B | `<project>/CLAUDE.md` (only if A found nothing) | one desk; the file is the agent profile (name = first `# heading`) |
| C | neither | placeholders `Dev 1`, `Dev 2` |

`<project>` is the repo root the mod reports (`$.session.repo()`), else the session cwd. Project agents win over
user agents with the same name. Files over 64 KB are ignored; at most 6 desks per session and 6 desks in total
(extra sessions are still listed in the panel, with a "no free desk" notice).

Live activity is pushed onto those desks so it looks like the agents are working:
- the session's own state/tool goes to the **first** agent (thinking / working + tool chip / talking = waiting for permission / done);
- each running **subagent** goes to the agent whose `name` equals the subagent type (e.g. a `coder` subagent lights up the `coder` desk);
  unmatched subagents are shown on the first agent's bubble.

Click a session in the panel to see its live activity (state, tool, prompt first sentence, subagents, cost). Agent profiles are
not listed in the UI any more; they still decide who sits at the desks. The map takes about 80% of the width, the session
panel and event log the rest (on phones the map comes first, 78% of the screen height).

## The `office` mod

`mod/.claude-plugin/marketplace.json` (marketplace `office-mods`) → `mod/office/` with
`.claude-plugin/plugin.json` (userConfig `endpoint`, default `http://127.0.0.1:7777/event`) and
`hooks/hooks.json` = `{ "modules": ["./register.ts"] }` → `hooks/register.ts`.

It POSTs JSON events `{type, sid, ...}` (`sid` = the full session id), one at a time in event order:
`start` on `session.start` and a `heartbeat` every 12 s (project, cwd, root, title, transcript path), `state` / `tool` on
turn start, tool calls, permission requests and turn completion, `subagents` when a subagent starts a turn or calls a tool,
`end` on `session.end`, and `usage` (below). Every session post also carries state, tool, prompt first sentence, subagents and cost.
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
| `$.session.usage()` → `cost.usd`, `rateLimits`, `context` | cost; usage on start/heartbeat |
| `on('session.measure')`: `e.rateLimits[{kind, percentUsed, resetsAt}]`, `e.context.percent`, `e.cost.usd` | usage bars |
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

### Claude usage in the header

The header shows the account's Claude usage as two bars, **5h** and **7d** (percent used, time to reset). The red line on each
bar is the **pace**: the share of the window already gone, from `resets_at` (e.g. 2.5 h into the 5 h window = 50%). Being past
the line means burning faster than the limit sustains; the bar then turns orange. Before any reading it says **chưa có số liệu**.

The mod sends `{type:'usage', sid, usage}` on `session.measure` (raised by the engine after each turn and whenever a limit moves
a whole point) and on start/heartbeat from `$.session.usage()`. `usage` is built exactly like esp-claude's `payload.ts`:
`{source:'claude-code', ts, five_hour:{pct, resets_at}|null, seven_day:…, context_pct, cost_usd}`, and is sent only when
there is a 5h or 7d reading. The server keeps the newest reading (account-wide, newest `ts` wins) and pushes it to the UI.
`--demo` posts simulated usage labelled **demo**.

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
- `docs/screens/session-1280-vanphong.png`, `session-1280-vanphong-claude-md.png`, `session-390-vanphong.png`
- Town: `docs/screens/town-overview.png`, `town-cafe-trada.png`, `town-croc-throw.png`, `town-itops-report.png`, `town-dog-cat.png`, `town-editor.png` (`node scripts/screens-town.mjs` after a build); `town-massage.png`, `town-traffic.png`, `town-crash-argue.png`, `town-fire.png`, `town-explosion.png` (`node scripts/screens-traffic.mjs`)

The old 2D (SVG) and 3D (React Three Fiber + Quaternius model) views were removed; the Vanphong view replaces both.

Older `phase*` / `refui*` screenshots show earlier designs (orchestrator spawning its own agents, and the removed 2D/3D views), kept for history.

## Known issues

- IT Ops' Prometheus client sends no auth header (only credentials embedded in the URL), and has not been tried against a real Prometheus yet.
- `orchestrator/test/mod.test.ts` (incl. the usage payload tests) only loads when `mod/office/.claude-plugin/types/tsconfig.json` exists (it comes with the engine types, not in this repo).
- Headless screenshots use software WebGL (SwiftShader), so shadows are off in them.
