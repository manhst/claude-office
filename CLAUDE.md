# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"Văn phòng ảo" (virtual office): a local web UI that shows the user's running Claude Code sessions as staff at desks (the Vanphong voxel view). Three parts, each with its own role:

```
Claude Code session ──(office mod, POST /event, loopback)──> orchestrator :7777 ──(WebSocket + per-run token)──> web UI
```

- `mod/` — a Claude Code mod (marketplace `office-mods`, plugin `office`). `mod/office/hooks/register.ts` observes engine events and POSTs `{type, sid, ...}` events to the orchestrator. It only observes: every handler calls `next(e)` and the classic/`tool.call` handlers swallow errors. It sends tool *summaries* only (file basename, first line of a command, URL host), never file contents or tool inputs/results, and refuses non-loopback endpoints. It also sends each turn (`type:'turn'`) for the Responses panel: the prompt, the assistant's text, tool summaries and the final answer, capped and redacted by the server; these texts end up in `orchestrator/logs/run-*.jsonl`.
- `orchestrator/` — Node/TS server (no build step, run with `tsx`). It doesn't run agents; it tracks sessions reported by the mod and turns them into desks.
- `web/` — Vite + React 19 UI. It's a pure reducer over the orchestrator's event stream.

`README.md` is the current source of truth. `docs/ARCHITECTURE.md`, `orchestrator/README.md` and `web/README.md` describe the **superseded** design (orchestrator spawning `claude -p` agents, `@@ASK` routing, roles, `/hook` endpoint), so don't trust them for current behavior. `.claude/commands/office-start.md` is also stale: it passes a task argument that `cli.ts start` no longer accepts.

## Commands

```
# orchestrator
cd orchestrator && npm install
npm test                      # vitest run (also tests the mod, see below)
npm run typecheck             # tsc (noEmit; includes src + test)
npm start                     # tsx src/cli.ts start  — live mode, waits for mod events
npm run demo                  # 3 simulated sessions (one per profile source A/B/C)
npx vitest run test/sessions.test.ts         # single file
npx vitest run -t "desk allocation"          # single test by name

# web
cd web && npm install
npm test && npm run typecheck
npm run build                 # orchestrator serves web/dist at http://127.0.0.1:7777/
npm run dev                   # Vite on 127.0.0.1:5173; open /#token=<token>&ws=127.0.0.1:7777
npm run screens               # build + headless-Chrome screenshots (playwright-core) → docs/screens/session-*.png
```

`start.cmd` / `start.command` (with an optional `demo` arg) install deps, build the web UI if `web/dist` is missing, start the server and open the token URL.

CLI flags: `start [--demo|--mock] [--port 7777] [--print-token] [--user-agents <dir>] [--log-dir <dir>] [--step-ms 1500] [--history-dir <dir>]`. Env: `OFFICE_DEMO=1`, `OFFICE_USER_AGENTS_DIR`, `OFFICE_HISTORY_DIR` (History tab transcript root; default `${CLAUDE_CONFIG_DIR or ~/.claude}/projects`, `--demo` uses `orchestrator/fixtures/demo/history`), `OFFICE_HISTORY_BOOKMARKS` (bookmarks file; default `orchestrator/.run/history-bookmarks.json`, memory only under `--demo`), `OFFICE_RUN_DIR` (replaces `orchestrator/.run/`; `test/setup.ts` points it and the history/bookmark paths at temp dirs so tests never touch a live server's files), `OFFICE_CLAUDE_JSON` / `OFFICE_CLAUDE_SETTINGS` / `OFFICE_CLAUDE_BIN` (Claude config tab: Claude Code's `.claude.json`, `settings.json` and `claude` CLI; tests set all three to temp files and `test/fake/claude.mjs`). The UI URL with the token is written to `orchestrator/.run/ui-url.txt` (mode 600). Console output redacts the token unless `--print-token` is set. Events are logged to `orchestrator/logs/run-*.jsonl`.

## Architecture notes

**Wire schema.** `orchestrator/src/types.ts` is the single definition of `OfficeEvent`, `SessionView`, `AgentProfile` and the related types. `web/src/types.ts` re-exports it via a type-only relative import (`../../orchestrator/src/types`). Change the schema there, then update both the tracker and `web/src/reducer.ts`. Some event variants (`agent.message`, `tool.result`, `agent.text`) come from the old design. The reducer still handles them, and the views (message arcs, walking) still render them.

**Session → desks** (`orchestrator/src/sessions.ts`, `SessionTracker`):
- `parseModEvent` validates and sanitizes untrusted mod payloads (redaction via `redact.ts`, length caps).
- `ingest` merges events into `SessionView`s, and `sweep` (every 5 s) drops sessions with no heartbeat for about 60 s.
- `turn` events upsert a ring of the last 40 `TurnView`s by sid+turnId+agentId (end keeps the start's prompt), emit `session.turn`, and stay in `snapshot().turns` after the session leaves. Ended turns are evicted first. Running turns become `aborted` when their session drops or a new main turn of that sid starts. `cli.ts` logs a turn only at its first start and its end (`turnLogGate`). `deskId` is the lead desk for the main loop, the desk whose profile name equals the subagent type otherwise.
- Desks are capped at 6 per session and 6 in total, so one session with 6 agents fills the office. Sessions beyond that still appear in the panel.
- Session state maps onto agent state: `tool → working`, `waiting-permission → talking`.
- The session's own activity goes to its first agent. A subagent's activity goes to the agent whose `name` equals the subagent type.

**Agent profiles** (`profiles.ts`), in priority order:
- A: `<root>/.claude/agents/*.md` plus the user agents dir (project agents win on name clashes; YAML frontmatter is `name`, `description`, `tools`, `model`).
- B: `<root>/CLAUDE.md`, as a single agent named after its first `#` heading.
- C: placeholder `Dev 1` / `Dev 2`.

Files over 64 KB are ignored. Demo fixtures for each source live in `orchestrator/fixtures/demo/{shop-api,blog,scratch}`. Demo mode disables user agents so it stays deterministic.

**Server security model** (`server.ts`): binds 127.0.0.1 only.
- WS `/ws` requires the per-run token plus a loopback Origin.
- `POST /event` has **no token** (the mod can't know it). It accepts a request only if the peer is loopback, the request doesn't look like it came from a browser (rejects an http(s)/`null` `Origin` and cross-site/same-site `Sec-Fetch-Site`), and `Content-Type: application/json`. Bodies are capped at 64 KB.
- `GET /history` and `/history/session` (`history.ts`) read the `<claude config>/projects` transcripts. They need a loopback peer, a loopback Origin (or none) and `Authorization: Bearer <run token>` (header only, no `?token=`). `sid` is only a lookup key in the index, never a path. All text that leaves is redacted, and tool details are summaries only. `POST /history/bookmark` `{sid, on, note?}` uses the `/prompt` gate (loopback, Origin allow-list, JSON) plus the Bearer run token, with bodies capped at 4 KB. Adding a bookmark needs an indexed sid. Bookmarks are stored in `.run/history-bookmarks.json` (`bookmarks.ts`, mode 600, atomic write).
- `GET /claude-config` (history gate + Bearer) and `POST /claude-config/mcp/save|delete|reveal|test` (the `/prompt` gate + Bearer, bodies capped at 64 KB) read `~/.claude.json` (or `$CLAUDE_CONFIG_DIR/.claude.json`), each known project's `.mcp.json` and `~/.claude/settings.json`. They **never write those files directly**. Writes go only through `claude mcp add-json` / `claude mcp remove` (spawned without a shell, JSON on stdin), after a hash check (409) and a backup of the files involved into `.run/claude-config-backups/` (mode 600, newest 30 saves), and every write is re-read and verified (500 with `backup` if not). Env and header values that look secret are masked in the view and only returned by `reveal`. `test` starts the configured stdio command (in its own process group, killed afterwards) or calls the configured URL (no redirects, 1 MB answers, 3 at a time, cancelled when the request goes away). Project-scope entries (`.mcp.json`, possibly from a cloned repo) need `confirm:true` unless Claude Code approved them in a trusted project, and never get `${VAR}` expansion from the office env. A project-scope save that writes kept or secret-looking values needs `confirmProjectSecrets:true`. Read-only in `--demo` or without the CLI.
- `GET /history/openers` (history gate + Bearer) and `POST /history/open` (the `/prompt` gate + Bearer, 4 KB) are in `opener.ts`, and they **launch local apps**. The sid must be UUID-shaped and indexed. The cwd comes only from `HistoryIndex.locate`, which returns the raw transcript cwd and never sends it to the client; a missing cwd or one over 4096 chars is refused, never decoded from the folder name. The cwd must be absolute (`X:\` on Windows), free of C0/C1/U+2028/9, equal to the transcript folder name when folded with `[^a-zA-Z0-9]→-` (folders ≤200 chars), and an existing dir (2 s stat timeout). The app must have been detected. A live session, a reopen within 2 min, or a transcript written within 2 min each need `confirm`; one launch at a time, otherwise `busy`. **Never type or interpolate transcript data into a shell or AppleScript.** macOS writes a `/bin/sh` script (`.run/resume/`, dir 0700, file 0600, O_EXCL, random `[a-z0-9]+.sh`, deleted after 2 min, leftovers older than 10 min swept). The terminal only gets `/bin/sh '<path>'` matching `SAFE_SCRIPT_PATH`, through constant AppleScripts that take it as argv. Spawn only with argv arrays and allow-listed envs. Windows `claude.cmd` runs via `cmd.exe /d /c` only from a metacharacter-free path. Under vitest the default exec/launch refuse to run, so tests inject fakes and never open apps or run `claude --resume`.
- `GET /model-report?days=&auto=&fresh=` (`modelReport.ts`) uses the `/history` gate plus Bearer. `days` must be 0 or 1..3650 (else 400). It returns counters only. Error patterns and titles go through `scrub`: `redactText` first, then cookies, URL userinfo, query values, secret-looking `key=value` / `key: value` (optionally followed by `Bearer `), `Bearer x` / `token x`, mysql/sshpass `-p`, long tokens and emails. Patterns are then normalized (paths, IPs, quoted values, long numbers) and redacted again. Never add prompt, tool input or tool result text to it. Every new leak shape gets a test in `modelReport.test.ts`.
- Keep these checks when touching ingest. `test/e2e.test.ts` covers them.

**Claude config tab** (`claudeConfig.ts`, probe in `mcpProbe.ts`). It lists MCP servers by scope: user (`.claude.json` `mcpServers`), local (`projects[path].mcpServers`), project (`<path>/.mcp.json`) and settings (`settings.json` `mcpServers`, which Claude Code doesn't load, so they are read-only). Precedence is local > project > user (`shadowedBy`). Edits keep unknown keys and reuse stored secrets via `keep:true`. New names follow the CLI rule (letters, digits, `-`, `_`). An existing entry with another name can be renamed, moved or deleted, but not edited in place. **Never remove before an add has proved the CLI takes the JSON**: an edit in place first runs `add-json` under a temporary name, then removes the temporary entry, removes the original and adds the final entry, re-adding the original if that last step fails. A move or rename is `add-json` first, then `remove`. When the office runs inside a Claude Code session (`CLAUDE_CODE_CHILD_SESSION` / `CLAUDECODE`, the CLI's own test, plus `CLAUDE_CODE_SESSION_ID`), the tab is read-only because the CLI refuses stdin JSON there by design; never strip that env or pass the JSON as argv to get around it (`test/setup.ts` clears the markers only so tests run the same everywhere). Local writes are refused unless the project key equals the key the CLI computes (`configKey`: git root of the real path, a worktree resolves to its main repo, `/` on Windows). Project-scope writes are refused unless the key is a real path. `--demo` reads `fixtures/demo/claude-config/`, with project paths mapped under its `fs/`. **No test or script may write the real Claude Code config or run the real `claude mcp add/add-json/remove`**: `claudePaths` / `findClaude` throw or refuse under vitest without the overrides.

**Model report** (`modelReport.ts`, Hiệu suất tab) ports the heuristics of `_local/model-report/model_report.py` (error-cause regex order, message-id dedupe, verify-by-output, correction phrases on folded text, sdk-cli skip); keep the two in step. Each transcript (main and `<sid>/subagents/*.jsonl`) is parsed once into local-day buckets (per-model counters, turn ms, pattern counts, a session summary), so any window and the trend are answered from memory. It re-parses only changed files (mtime/size, stale-while-revalidate like `HistoryIndex`) and scans lazily on the first request. A turn ends at the last line before the next prompt. Windows are whole local days including today. Trend weeks start on Monday. `modelOrder` ranks by calls in the last 52 weeks, then older models. The response carries `scannedAt` and `refreshing`. `fresh` waits for a scan that starts after the request, sharing the single in-flight scan, and the memo is keyed per scan. `totals.costUsd` and `sessions` include models with no row, and a session's whole cost counts when its last activity is in the window. Demo pins `now` to `DEMO_NOW` (`cli.ts`) because the fixtures are dated.

**Mod testing.** The engine's types package isn't available. `orchestrator/test/claude-code.d.ts` declares a stand-in `claude-code` module, and `orchestrator/test/mod.test.ts` imports `mod/office/hooks/register.ts` and drives it with a fake engine (`$.http`, `$.fs`, `$.clock`, `$.session`, `$.agent`). So orchestrator `npm test` and `npm run typecheck` also cover the mod. The README's "The `office` mod" table lists which engine APIs are relied on.

**Web.**
- `reducer.ts` is pure: events → `OfficeState`.
- `connection.ts` reads the token from the URL fragment, strips it from the address bar, keeps it in sessionStorage, and reconnects with backoff.
- The only view is `ref-vanphong/` (Vanphong, plain three.js), a lazy-loaded chunk. The town around it is `ref-vanphong/town3d.ts`, driven by the pure sim in `town/` (`map.ts` plan pixels → world via `toWorld`, `sim.ts`, `looks.ts`); the context menu and name/avatar editor are `town/Editor.tsx`. The old 2D/3D views were removed.
- Pure helpers live in `layout.ts` (desk layout), `walk.ts` (grid A* walking between desks) and `sessionView.ts`, and are unit-tested under `web/test/`.
- `web/src/ref-vanphong/` is ported third-party code (see its `NOTICE`). Keep it isolated in that folder, and put mapping logic in `adapter.ts` rather than spreading reference code elsewhere.

## Style

The code is dense: long single-line statements, terse names and few comments (mostly one-line `/** */` doc comments on exported items). Both packages are ESM. Orchestrator imports use `.js` extensions (NodeNext resolution).
