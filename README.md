# Văn phòng ảo (virtual office)

A local web office that shows your **running Claude Code sessions** as staff at desks in a voxel office (the Vanphong view).
The office does not run or define agents itself: a small Claude Code mod, `office`, reports each session's activity
to a local server, and the server shows the agents defined for that project.

```
Claude Code session ──(office mod, POST /event, loopback)──> orchestrator :7777 ──(WebSocket + run token)──> browser UI
browser UI ──(POST /prompt, Bearer run token)──> orchestrator ──(GET /inbox, per-session inboxToken)──> office mod ── $.prompt.submit({text, asUser:true})
```

## Quick start (Windows)

1. Install Node.js 20+.
2. Double-click `start.cmd` (macOS/Linux: `./start.command`). In order, it:
   1. runs `git pull --ff-only` (if that fails it prints a warning and continues with the local copy);
   2. clears the screen;
   3. installs the `office` mod into Claude Code (`node scripts/install-mod.mjs`, see below);
   4. on first run, runs `npm install` and builds the web UI, then starts the server and opens the browser with the per-run token (`http://127.0.0.1:7777/#token=…`).
3. Reopen any Claude Code sessions that were already open, so they load the mod. Prompt submit needs a Claude Code build that exposes `$.prompt.submit` (see the mods API); reload/restart the session after updating the office plugin.
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
- **IT Ops** watches a Prometheus-compatible HTTP API and reports alerts from the indoor desk in a red speech bubble.

| Env / flag | Meaning |
|---|---|
| `OFFICE_PROMETHEUS_URL` or `--prometheus URL` | Base URL, e.g. `http://prometheus:9090`. The server calls `GET <url>/api/v1/query?query=…`. Credentials in the URL are used but never shown or sent to the UI. |
| `OFFICE_PROMETHEUS_QUERY` | Instant query; every returned series counts as a problem. Default `ALERTS{alertstate="firing"}`. |
| `OFFICE_PROMETHEUS_INTERVAL_MS` | Poll interval, default 30000 (min 2000). |

### Settings (Cài đặt)

Gear icon in the header opens **Cài đặt**. Useful knobs already in the product, surfaced there:

| Setting | Where it lives | Notes |
|---|---|---|
| Prometheus URL / query / poll interval | UI → `GET`/`PUT /settings` (Bearer run token) → `orchestrator/.run/office-settings.json` (mode 600) | Live-reloads IT Ops without restart. Password in the URL is masked in the UI. Env/`--prometheus` still seed the first load when the file is empty. |
| Demo mode | read-only badge when `--demo` / `OFFICE_DEMO=1` | Shown on the Settings panel. |
| Desk / session limits | read-only (6 desks, 6 agents/session, 3 cols) | Layout defaults; not runtime-editable. |
| Name & avatar | right-click agent name (localStorage) | Linked from Settings notes; not duplicated. |
| `vp-debug` | Advanced → localStorage `vp-debug=1` | Enables `__vpTraffic` / `__vpTown` console hooks after reload. |
| Run speed / Tốc độ chạy | Settings → localStorage `vp-run-speed` | Slider (default 2.5 m/s, min 0.1, max ≈5.07 = old sprint). Idle amenity trips & town NPC runs use half that; walk unchanged at 1.6 m/s. Active agent returning to desk always uses max. |
| Structure labels | Settings → **Nhãn công trình** | localStorage `vp-labels`. Defaults: ON for Crossian / Xuka / Xém Nướng / trà đá / hồ cá sấu; OFF for other amenities & rooms; Monitor = chỉ khi lỗi/cảnh báo. |

**Session dump (left sidebar).** Selecting a session shows a CLI-like field list (sid, cwd, transcript, tool, prompt, cost, started/lastSeen, source, all subagents — not agent profile markdown bodies). Session dump and Agents are collapsible (localStorage `vp-collapse`). Screenshot: `docs/screens/session-dump.png` (`cd web && npm run build && node scripts/screens-session-dump.mjs`).

**Agents (left sidebar).** Collapsible list of the selected session's desk agents and current subagents (status + task from the live payload; `unavailable` when no task). Pref in localStorage `vp-collapse.agents`. The map/info split is draggable (default 80:20, localStorage `vp-split`).

**Responses (left sidebar).** Collapsible list of agent answers from the event log (`agent.text`, `agent.done` result, non-empty `tool.result`, `agent.error`) — newest first; no agent profile markdown. Pref in localStorage `vp-collapse.responses`. Screenshot: `docs/screens/session-responses.png` (`cd web && npm run build && node scripts/screens-session-responses.mjs`).

**Prompt composer (under Responses).** Textarea + Send scoped to the selected live session. Send is an explicit click (or Ctrl/Cmd+Enter) only — never on session switch, reconnect, or restart. Same-session delivery uses the documented `$.prompt.submit({ text, asUser: true })` when the office mod reports `canSubmit`. There is **no** live model/mode dropdown (no documented mod setter); the current model is shown read-only if `$.session.model()` returned a string. Demo / older Claude Code / missing `$.prompt.submit`: Send stays disabled with a labeled explanation (change model and type after Esc in Claude Code). Queued prompts are in-memory only (TTL ~45 s queued / ~3 min claimed), one per session, claimed at most once; a `delivered` ack means handed to Claude Code, **not** a finished turn. Pending permission prompts stay in Claude Code. After app restart, unsent drafts and queued jobs are gone. Screenshot: `docs/screens/session-composer.png` (`cd web && npm run build && node scripts/screens-composer.mjs`).



Screenshot: `docs/screens/settings.png` (`cd web && npm run build && node scripts/screens-settings.mjs`).

Not configured: the badge says **chưa cấu hình** and IT Ops stays at the kiosk, with no fake alerts. If the API can't be read, the error itself is reported.
`--demo` with no URL runs a monitor labelled **(demo)** that alternates ok and `DEMO HighLatency` every 15 s.
**Xuka Mát xa** sits across the back street from Crossian Cafe; NPCs and free office agents walk there, lie on a bed and chat about massages (PG, comedic), then walk back.
**Xém Nướng** is opposite the crocodile pond (northwest): BBQ and crocodile-meat hotpot. Side NPCs and free agents occasionally walk over, sit/eat, chat, then return.
**Layoff** is a voxel T-Rex that occasionally roams the town hunting idle/useless staff (side NPCs chatting, coffee, BBQ, massage, romance, etc., and free office agents). Random outcome: eat on the spot (comedic chomp → respawn) or carry them to the crocodile pond. Dialogue in `web/src/town/dialogue.ts` (`layoffHunt` / `layoffEat` / `layoffThrow` / `victimPanic` / `layoffWitness`, ≥30 lines each). Debug: `localStorage vp-debug=1` then `__vpTown.layoffEat()` / `__vpTown.layoffPond()`. Screenshots: `docs/screens/layoff-*.png` (`cd web && npm run build && node scripts/screens-layoff.mjs`).

**Flower garden** between Xuka and Xém Nướng: rarely two characters sneak there for a secret PG office-soap affair (stand close, kiss, flat SVG heart pops).


**Bia Hải Xồm + town events.** Beer stall opposite cổng/trạm gửi xe across the front street (trees cleared). Label default ON in Settings. Also: shipper/cơm hộp drama at the gate, occasional rain (wet pond path, quieter garden), sếp walkthrough (temporary, not Architect), and a payday beat (ATM queue / BBQ treat / Layoff more often). Office shell now has four walls + light interior dressing; the road-facing front is a clear aluminium-framed glass facade with a dark-framed main door and a blue "Crossian" decal.

**Outdoor amenities** on empty map edges (voxel, same style): smoking/cooler corner (west of pond), outdoor gym / table tennis (south yard), ATM + snack machine (east, by trà đá), parking/security gate (SW), glass outdoor meeting pod (south yard east of gym), printer + photocopier (inside the office, against the back/north wall by the window right of the back door). NPCs and free office agents visit occasionally. Office-drama dialogue packs (≥30 unique VN lines each) cover gossiping about the boss, trolling PR reviews, ghosting Slack, gossiping about colleagues (and getting caught), layoff/PIP rumors, fake sick leave (caught at Xém Nướng / Xuka), and remote vs onsite desk wars — plus amenity go/talk lines and two-sided `PAIRS`. Debug: `localStorage vp-debug=1` then `__vpTown.drama('smoke'|'gym'|'atm'|'print'|'pod'|'gate')`. Screenshots: `docs/screens/town-{smoke-corner,gym-yard,atm-snack,security-gate,meeting-pod,print-kiosk,drama-smoke}.png` (`cd web && npm run build && node scripts/screens-amenities.mjs`).
Speech bubbles are paced slower (longer display + gaps, less idle chatter) so lines are readable.

**Main-road traffic** (front street, `web/src/town/traffic.ts`, at most 5 vehicles plus responders): 22 voxel vehicle types (xe máy, xe đạp, xe ôm Grab, ô tô con, taxi, bán tải, xe buýt, ô tô tải, container, trộn bê tông, xe rác, xe cẩu, xe lu, máy xúc, máy ủi, xe tăng, ba gác, cứu thương, cứu hỏa, cảnh sát, xe kiểm tra đường, xe bán kem). Vehicles sometimes knock a pedestrian over (they get back up), rear-end each other (both drivers get out and argue in turns), or catch fire and explode. Police, fire truck and ambulance are dispatched to incidents; wrecks are cleared after a while. Comedic only.


**IT Ops** sits at an indoor monitor desk in the pantry side of the office (no outdoor street kiosk run). On a Prometheus/demo alert he reports from that desk via speech bubble. The Architect NPC is gone.

**Character labels** show the name plus at most a short status bit, scaled to about 70% of the previous size.

**Dialogue** lives in `web/src/town/dialogue.ts`: line categories (incl. BBQ / romance / outdoor amenities / office drama) plus two-sided argument pairs; `web/test/dialogue.test.ts` checks every category has at least 30 unique lines.

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
- the session's own state/tool goes to the **lead** desk (first profile, or the first desk not claimed by a subagent);
- each **busy** subagent (`running` / `pending` / `waiting` from `$.agent.list()`) claims its own desk: prefer a profile whose `name` matches the subagent `type`, `name`, or `description`, otherwise the next free desk in that session (so N parallel Task/Explore agents light up N characters);
- only when every desk is already taken does leftover subagent text collapse onto the lead bubble (`Subagents: …`);
- when the main turn is `done` but busy subagents remain, desks stay working until the list clears (the mod keeps sending updates — same idea as esp-claude's pendingDone).

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
`end` on `session.end`, `usage` (below) and `turn` (below). Every session post also carries state, tool, prompt first sentence, subagents and cost.
Tool detail is only a file **basename**, the **first line** of a command, a URL **host**, a pattern/query or a description,
never file contents or tool inputs/results; the server also redacts tokens and caps lengths. Headless `claude -p` sessions
(`CLAUDE_CODE_ENTRYPOINT=sdk-cli`) are skipped. Non-loopback endpoints are refused by the mod.

For the **Responses** panel the mod also posts each turn, the main loop's and each subagent run's, as the CLI shows it:
`{type:'turn', sid, turn:{id, phase:'start'|'end', agentId?, agentType?, prompt?, steps?, answer?, reason?, durationMs?}}`.
`id` is the engine's `turnId`, or `local-<run>-<n>` when the engine gives none.
`start` (on `turn.start`) carries the prompt; `end` (on `turn.complete`) the answer, reason, duration and the steps. A main turn's
steps are the messages added since its `turn.start` (the scan falls back to "after the last typed prompt" when the list was compacted
or is at the engine's 4096 cap); a subagent's are those after its prompt. Each assistant text is `{kind:'text', text}` and each tool use
`{kind:'tool', name, detail, isError?}` with the same summary detail as above. While a main turn runs, a tool call posts a `start`
with the steps so far (at most one every 2 s).
Caps: prompt and each text 4000 chars, answer 12000, the last 60 steps, and oldest steps dropped until the body is at most
56,000 characters (UTF-16 chars, not bytes; the server's limit is 64 × 1024 chars).
So unlike the rest, **prompts and the assistant's own text and answers leave the session** (to the loopback server only).
The server redacts tokens in them and keeps the last 40 turns in memory (ended ones are evicted first). It writes them, as
`session.turn` events, to `orchestrator/logs/run-*.jsonl`, once when a turn starts and once when it ends (live progress goes
to the UI only). Turns still running when their session ends or times out, or when a new main turn of the same session starts,
are marked `aborted`.

Engine API used (the same as in the owner's usage-esp mod). Handlers only observe and always call `next(e)`; the classic
and `tool.call` handlers also have `.catch(($, e, next) => next(e))` so they never block.

| API | Used for |
|---|---|
| `export const register: Register = (on, options)`; `options.endpoint` from `plugin.json` userConfig | entry point, endpoint |
| `on('session.start')`: `e.cwd`, `$.env.get('CLAUDE_CODE_ENTRYPOINT' / 'USERPROFILE' / 'HOME' / 'CLAUDE_CONFIG_DIR')`, `$.session.id()`, `$.session.repo()` → `root` | session info, quiet check, transcript path |
| `$.clock.every(12000, fn)` | heartbeat |
| `typeof $.prompt.submit === 'function'` then `$.prompt.submit({ text, asUser: true })` | same-session composer (documented; waits until idle; `{drop}` after Esc until the user types in Claude Code). Polls `GET /inbox` every 2 s only when this exists. |
| `$.session.model()` | read-only model label when it returns a string or `{id|name|model}`; no live setter is used |
| `on('turn.start')`: `e.agentId` (undefined = main turn), `e.text`, `e.turnId` | thinking, prompt (first sentence; `classic.UserPromptSubmit` is skipped for user-tier plugins), `turn` start |
| `on('tool.call')`: `e.tool` + tool args on `e`, `e.agentId`, `next.origin.plugin === 'engine'` | current tool (model's own calls only) |
| `on('classic.PermissionRequest')`: `e.tool_name`, `e.tool_input` | waiting for permission |
| `on('classic.SessionStart')`, `on('classic.UserPromptSubmit')`: `e.session_title`, `e.transcript_path`, `e.prompt` (if a string) | title, prompt |
| `on('turn.complete')`: `e.agentId`, `e.reason` (`aborted` → idle; else done, or stay `tool` while busyAgents remain), `e.answer`, `e.durationMs`, `e.turnId` | done / pendingDone, `turn` end |
| `$.session.messages()` / `$.session.messages({ agentId })` → `[{role, text, toolUses:[{tool, input, isError?}], toolResults?}]` (or `{deny}`); shape from the types package, not yet confirmed live | turn steps (text + tool summary only), message count at `turn.start` |
| `on('session.end')` | end |
| `$.agent.list()` → `{id?, name?, type?, description?, status}` (busy = running|pending|waiting); full list on heartbeat / tool / turn when `agentId` set; main `turn.complete` stays `tool` while busy remain | subagents / pendingDone |
| `$.session.usage()` → `cost.usd`, `rateLimits`, `context` | cost; usage on start/heartbeat |
| `on('session.measure')`: `e.rateLimits[{kind, percentUsed, resetsAt}]`, `e.context.percent`, `e.cost.usd` | usage bars |
| `$.http.fetch(url, {method: 'POST'|'GET', headers, body?})` | posting events; `GET /inbox` + `POST /inbox/ack` with the session inbox token |
| `$.fs.exists(path)`, `$.fs.read(path)` | title from the transcript (`custom-title` > `ai-title`) when no `session_title` was given |

`classic.UserPromptSubmit` is skipped for this user-tier plugin; the prompt comes from `turn.start`'s `e.text`, and `e.prompt` there is used only when it is a string.
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

**Prompt reverse channel (not `/event`).** `/event` must not inject commands. On a successful live-session ingest the JSON body `{inboxToken}` is returned **only** to that loopback poster (never on the WebSocket, never in logs). The UI sends `POST /prompt` with the **run** Bearer token, loopback peer, loopback Origin, JSON `{sid,text,nonce}` — 200 `{ok,id,nonce,state:'queued'}` means queued, not a completed turn. The mod polls `GET /inbox?sid=` with the **inbox** Bearer token (same anti-browser rules as `/event`; the run token is rejected with 403). Claim is atomic (one queued job per sid); `POST /inbox/ack` reports `delivered` / `rejected` / `unsupported`. Status events `{t:'prompt.status', sid, nonce, state, reason?}` carry **no prompt text**. Bound TTL, idempotent nonce, no disk persist.

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
- Town: `docs/screens/town-overview.png`, `town-cafe-trada.png`, `town-croc-throw.png`, `town-itops-report.png`, `town-dog-cat.png`, `town-editor.png` (`node scripts/screens-town.mjs` after a build); `town-massage.png`, `town-traffic.png`, `town-crash-argue.png`, `town-fire.png`, `town-explosion.png` (`node scripts/screens-traffic.mjs`); `town-office-itops.png`, `town-labels.png`, `town-labels.png`, `town-agent-massage.png`, `town-ambulance.png` (`node scripts/screens-followup.mjs`); `town-labels-clean.png` (`node scripts/screens-labels-clean.mjs`); `town-xem-nuong.png`, `town-flower-garden.png`, `town-slower-talk.png` (`node scripts/screens-north.mjs`); outdoor amenities + drama: `town-smoke-corner.png`, `town-gym-yard.png`, `town-atm-snack.png`, `town-security-gate.png`, `town-meeting-pod.png`, `town-print-kiosk.png`, `town-drama-smoke.png` (`node scripts/screens-amenities.mjs`); office front (aluminium-framed clear glass facade with larger undivided panes, framed main door, blue "Crossian" decal) + printer/photocopier at the back wall: `town-front-glass-facade.png`, `town-printer-back-wall.png` (`node scripts/screens-facade.mjs`)

The old 2D (SVG) and 3D (React Three Fiber + Quaternius model) views were removed; the Vanphong view replaces both.

Older `phase*` / `refui*` screenshots show earlier designs (orchestrator spawning its own agents, and the removed 2D/3D views), kept for history.

## Known issues

- IT Ops' Prometheus client sends no auth header (only credentials embedded in the URL), and has not been tried against a real Prometheus yet.
- `mod/office/.claude-plugin/types/tsconfig.json` is a tiny stub so vitest can load `register.ts` without the engine's real types package. Replace it with the official types when you have them.
- Headless screenshots use software WebGL (SwiftShader), so shadows are off in them.
