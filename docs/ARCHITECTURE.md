# Văn phòng ảo (Virtual Office) — Architecture (draft, Step A)

## 0. Mods API verdict (checked 2026-11-04)
Claude Code **Mods are real and documented** (plugins/mods):
- API (`$.command.register`, `$.tool.register`, `$.agent.spawn`, `$.session.send`, `$.ui.status/toast`, `$.process.spawn`, `$.http.fetch`): https://code.claude.com/docs/en/plugins/mods/api
- UI: `$.ui.open({id})`, `on('ui.render', {component:'Pane'}, ...)`, `e.requestId`, `$.ui.resolve(e)` → `Box/Text/Button`, `$.ui.invalidate('ui.render')`: https://code.claude.com/docs/en/plugins/mods/interface
- Admin: `allowManagedModsOnly` under managed `pluginConfigs["cc-plugin-sec-default@builtin"].options`: https://code.claude.com/docs/en/plugins/mods/admin
- Reference (events `session.start`, `command.run`, `tool.call`, `turn.complete`, `ui.*`; Pane render site on Terminal/Desktop/VS Code): https://code.claude.com/docs/en/plugins/mods/reference
Caveats: Pane is a text/box UI (no WebGL) → 3D (phases 3–4) must live in a browser app. Mods can be disabled org-wide by `allowManagedModsOnly` / `disableAllHooks`; recent features need Claude Code ≥ v2.1.29x–2.1.304. Exact `$.agent.register` signature still to confirm in the reference before coding.

## 1. Components
```
 Claude Code session ──(mod "virtual-office")──┐  /office-start "task"; Pane = 2D text office (phase 2 alt)
                                               │  forwards agent/tool/turn events → HTTP POST
 Orchestrator (Node/TS, localhost:7777) ◄──────┘  ◄── Claude Code hooks (PreToolUse/PostToolUse/SubagentStop/Stop) POST (fallback source)
   ├─ AgentPool (max 6, configurable 5–7)
   │    each agent = `claude -p --output-format stream-json --verbose
   │                  --allowedTools <role list> --permission-mode default
   │                  --append-system-prompt <role>`  (or Agent SDK `query()`)
   ├─ StreamParser (NDJSON line → OfficeEvent)
   ├─ Router (agent↔agent messages, via orchestrator only)
   ├─ StateStore (agents, desks, transcript ring buffer)
   └─ WS server ws://127.0.0.1:7777/ws ──► Vite + React app (phase 2: SVG dots+bubbles; phase 3–4: R3F/drei)
```
Two backends behind one `AgentDriver` interface: `CliDriver` (subprocess, phase 1 default), `SdkDriver` (@anthropic-ai/claude-agent-sdk), and optionally `ModDriver` (`$.agent.spawn` inside a live session).

## 2. Event schema (orchestrator → UI, all JSON over WS)
```ts
type AgentState = 'idle'|'thinking'|'working'|'talking'|'done'|'error';
type OfficeEvent =
 | {t:'agent.spawned', id, role, name, desk:{x,y}, tools:string[], ts}
 | {t:'agent.state',  id, state:AgentState, ts}
 | {t:'agent.text',   id, text, partial?:boolean, ts}          // assistant text → speech bubble
 | {t:'tool.call',    id, callId, tool, inputSummary, ts}
 | {t:'tool.result',  id, callId, ok:boolean, summary, ts}
 | {t:'agent.message',from, to, text, ts}                      // routed talk; UI walks `from` to `to`'s desk
 | {t:'agent.done',   id, result, costUsd?, durationMs, ts}
 | {t:'agent.error',  id, error, ts}
 | {t:'office.snapshot', agents:AgentView[], ts}               // on WS connect
```
stream-json mapping: `system/init`→spawned; `assistant` content `text`→agent.text (state talking); `tool_use`→tool.call (working); `user` `tool_result`→tool.result (thinking); `result`→agent.done. Hook payloads (`hook_event_name`, `tool_name`, `tool_input`, `session_id`) map to the same types.

## 3. State machine (per agent)
```
idle ─spawn/task→ thinking ─tool_use→ working ─tool_result→ thinking
thinking ─text→ talking ─(1.5s quiet)→ thinking
thinking|talking ─ASK(to)→ talking(walking) ─reply→ thinking
* ─result→ done   * ─exit≠0/timeout→ error
```
UI derives animation: idle=sit, thinking=particles/“…”, working=typing, talking=bubble (+walk in phase 4).

## 4. Routing
Agents never talk directly. Each agent's system prompt says: to ask a colleague, emit a line `@@ASK <role>: <question>`. Parser intercepts it → `agent.message` → orchestrator starts/resumes target (`claude -p --resume <session_id>`) with the question → reply returned to asker via `--resume`. Guards: max hops 3 per question, max 20 messages per task, dedupe, pool limit (queue when full).

## 5. Security / least privilege
- Per-role `--allowedTools` (+ `--disallowedTools`), e.g. Researcher: `WebSearch,WebFetch,Read`; Coder: `Read,Edit,Write,Bash(npm test:*),Bash(git diff:*)`; Reviewer: `Read,Grep,Glob`. Never `--dangerously-skip-permissions`.
- Each agent `cwd` = its own git worktree / sandbox dir; `--add-dir` only as needed.
- Orchestrator + WS bind 127.0.0.1 only; random per-run token in WS URL; hook endpoint requires same token; Origin check.
- No secrets in events: redact tool inputs (env, tokens, long blobs) before broadcast; cap text length.
- Budgets: `--max-turns`, `--max-budget-usd`, per-agent timeout, kill process group on cancel.
- Mods: respect org `allowManagedModsOnly`; the mod only forwards events to localhost.

## 6. /office-start
`.claude/commands/office-start.md` (slash command) runs `!npx tsx orchestrator/src/cli.ts start "$ARGUMENTS"` and prints UI URL. Mod variant: `$.command.register({name:'office-start'})` + `$.ui.open({id:'office'})`.

## 7. Phases
1. CliDriver: spawn 1 agent, log OfficeEvents to console/NDJSON.
2. WS + React 2D (dots + bubbles); optional Mod Pane.
3. R3F/drei: capsule avatars, desks, lerped movement.
4. Walk-to-desk on agent.message, Quaternius GLTF + walk anim, thinking effects.
