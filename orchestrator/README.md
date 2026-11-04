# Orchestrator
```
cd orchestrator && npm install && npm test && npm run typecheck
npm run demo                                   # phase 1: single mock agent + authed WS client
npm start -- "task" --mock --office            # phase 2: researcher/coder/reviewer mock office (add --mock-delay 650 --keep-alive to watch in the UI)
npm start -- "task"                            # real `claude -p` agents (--role researcher|coder|reviewer picks the lead)
```
- Binds 127.0.0.1:7777 (`--port`). Serves `web/dist` at `/` when built. UI URL with the per-run token (in the `#fragment`, never sent to the server or logged) is written to `.run/ui-url.txt` (mode 600); console output shows it redacted unless `--print-token`.
- WS `ws://127.0.0.1:<port>/ws?token=…`, loopback Origins only. Hook endpoint: `POST /hook` with `X-Office-Token`, JSON Claude Code hook payload (PreToolUse/PostToolUse/Stop/SubagentStop/UserPromptSubmit), 256 KB max.
- Routing: agents write `@@ASK <role>: <question>`; the orchestrator emits `agent.message` (kind ask/reply, hops, qid), runs the target (`--resume` its session), and returns the answer to the asker once the target's own questions resolve. Guards: max 3 hops, loop/self/unknown-role/duplicate rejection, 20 messages per task, 8 turns per agent; rejections emit `office.notice` and tell the asker.
- Events: stdout + `logs/run-*.jsonl`.
