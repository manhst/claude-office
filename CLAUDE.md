# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"Văn phòng ảo" (virtual office): a local web UI that shows the user's running Claude Code sessions as staff at desks (the Vanphong voxel view). Three parts, each with its own role:

```
Claude Code session ──(office mod, POST /event, loopback)──> orchestrator :7777 ──(WebSocket + per-run token)──> web UI
```

- `mod/` — a Claude Code mod (marketplace `office-mods`, plugin `office`). `mod/office/hooks/register.ts` observes engine events and POSTs `{type, sid, ...}` events to the orchestrator. It only observes: every handler calls `next(e)` and the classic/`tool.call` handlers swallow errors. It sends tool *summaries* only (file basename, first line of a command, URL host), never file contents, and refuses non-loopback endpoints.
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

CLI flags: `start [--demo|--mock] [--port 7777] [--print-token] [--user-agents <dir>] [--log-dir <dir>] [--step-ms 1500]`. Env: `OFFICE_DEMO=1`, `OFFICE_USER_AGENTS_DIR`. The UI URL with the token is written to `orchestrator/.run/ui-url.txt` (mode 600). Console output redacts the token unless `--print-token` is set. Events are logged to `orchestrator/logs/run-*.jsonl`.

## Architecture notes

**Wire schema.** `orchestrator/src/types.ts` is the single definition of `OfficeEvent`, `SessionView`, `AgentProfile` and the related types. `web/src/types.ts` re-exports it via a type-only relative import (`../../orchestrator/src/types`). Change the schema there, then update both the tracker and `web/src/reducer.ts`. Some event variants (`agent.message`, `tool.result`, `agent.text`) come from the old design. The reducer still handles them, and the views (message arcs, walking) still render them.

**Session → desks** (`orchestrator/src/sessions.ts`, `SessionTracker`):
- `parseModEvent` validates and sanitizes untrusted mod payloads (redaction via `redact.ts`, length caps).
- `ingest` merges events into `SessionView`s, and `sweep` (every 5 s) drops sessions with no heartbeat for about 60 s.
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
- Keep these checks when touching ingest. `test/e2e.test.ts` covers them.

**Mod testing.** The engine's types package isn't available. `orchestrator/test/claude-code.d.ts` declares a stand-in `claude-code` module, and `orchestrator/test/mod.test.ts` imports `mod/office/hooks/register.ts` and drives it with a fake engine (`$.http`, `$.fs`, `$.clock`, `$.session`, `$.agent`). So orchestrator `npm test` and `npm run typecheck` also cover the mod. The README's "The `office` mod" table lists which engine APIs are relied on.

**Web.**
- `reducer.ts` is pure: events → `OfficeState`.
- `connection.ts` reads the token from the URL fragment, strips it from the address bar, keeps it in sessionStorage, and reconnects with backoff.
- The only view is `ref-vanphong/` (Vanphong, plain three.js), a lazy-loaded chunk. The town around it is `ref-vanphong/town3d.ts`, driven by the pure sim in `town/` (`map.ts` plan pixels → world via `toWorld`, `sim.ts`, `looks.ts`); the context menu and name/avatar editor are `town/Editor.tsx`. The old 2D/3D views were removed.
- Pure helpers live in `layout.ts` (desk layout), `walk.ts` (grid A* walking between desks) and `sessionView.ts`, and are unit-tested under `web/test/`.
- `web/src/ref-vanphong/` is ported third-party code (see its `NOTICE`). Keep it isolated in that folder, and put mapping logic in `adapter.ts` rather than spreading reference code elsewhere.

## Style

The code is dense: long single-line statements, terse names and few comments (mostly one-line `/** */` doc comments on exported items). Both packages are ESM. Orchestrator imports use `.js` extensions (NodeNext resolution).
