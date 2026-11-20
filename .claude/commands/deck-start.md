---
description: Start the Claude Deck server (live mode; prints the UI URL)
allowed-tools: Bash(orchestrator/node_modules/.bin/tsx orchestrator/src/cli.ts:*)
---
!`orchestrator/node_modules/.bin/tsx orchestrator/src/cli.ts start`
Report the UI URL and log path printed above (the full token URL is in orchestrator/.run/ui-url.txt). Add `--demo` for 3 simulated sessions.
