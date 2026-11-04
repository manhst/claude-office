---
description: Start the Virtual Office orchestrator for a task (spawns 1 agent)
argument-hint: "task description"
allowed-tools: Bash(orchestrator/node_modules/.bin/tsx orchestrator/src/cli.ts:*)
---
!`orchestrator/node_modules/.bin/tsx orchestrator/src/cli.ts start "$ARGUMENTS"`
Report the log path and the result printed above. (Set OFFICE_MOCK=1 to replay the fixture instead of calling claude.)
