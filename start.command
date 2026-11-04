#!/bin/bash
# Usage: ./start.command        (live: shows Claude Code sessions reported by the "office" mod)
#        ./start.command demo   (3 simulated sessions, no Claude needed)
cd "$(dirname "$0")" || exit 1
DEMO=""
if [ "$1" = "demo" ] || [ "$1" = "mock" ]; then DEMO="--demo"; fi
[ -d orchestrator/node_modules ] || (cd orchestrator && npm install)
[ -d web/node_modules ] || (cd web && npm install)
[ -f web/dist/index.html ] || (cd web && npm run build)
rm -f orchestrator/.run/ui-url.txt
( for i in $(seq 1 60); do
    if [ -s orchestrator/.run/ui-url.txt ]; then
      URL=$(head -n1 orchestrator/.run/ui-url.txt)
      if command -v open >/dev/null; then open "$URL"; else xdg-open "$URL" >/dev/null 2>&1; fi
      exit 0
    fi; sleep 1
  done ) &
exec orchestrator/node_modules/.bin/tsx orchestrator/src/cli.ts start $DEMO
