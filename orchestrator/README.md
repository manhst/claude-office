# Orchestrator (phase 1)
```
cd orchestrator && npm install
npm test                      # parser, state machine, security, mock e2e
npm run typecheck
npm run demo                  # mock run + authed WS client (no claude needed)
npm start -- "task" --mock    # or without --mock to spawn real `claude -p` (role: --role researcher|coder|reviewer)
```
Binds 127.0.0.1:7777 (`--port`). WS: `ws://127.0.0.1:<port>/ws?token=<per-run token>`; token is redacted in output unless `--print-token`. Loopback Origins only. Events: stdout + `logs/run-*.jsonl`.
