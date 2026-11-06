#!/bin/bash
# Usage: ./start.command        (live: shows Claude Code sessions reported by the "office" mod)
#        ./start.command demo   (3 simulated sessions, no Claude needed)
cd "$(dirname "$0")" || exit 1
git pull --ff-only || echo "[office] WARNING: git pull failed, continuing with the local copy."
clear
DEMO=""
if [ "$1" = "demo" ] || [ "$1" = "mock" ]; then DEMO="--demo"; fi
node scripts/install-mod.mjs || echo "[office] WARNING: mod install failed."
[ -d orchestrator/node_modules ] || (cd orchestrator && npm install)
[ -d web/node_modules ] || (cd web && npm install)
(cd web && npm run build)
rm -f orchestrator/.run/ui-url.txt
( for i in $(seq 1 60); do
    if [ -s orchestrator/.run/ui-url.txt ]; then
      URL=$(head -n1 orchestrator/.run/ui-url.txt)
      # WSL: open the Windows browser (localhost forwarding reaches 127.0.0.1); wait for wslrelay to pick up the new listener.
      if grep -qi microsoft /proc/version 2>/dev/null; then sleep 2
        if command -v wslview >/dev/null; then wslview "$URL"; else (cd /mnt/c 2>/dev/null; cmd.exe /c start "" "$URL" >/dev/null 2>&1); fi
      elif command -v open >/dev/null; then open "$URL"; else xdg-open "$URL" >/dev/null 2>&1; fi
      exit 0
    fi; sleep 1
  done ) &
exec orchestrator/node_modules/.bin/tsx orchestrator/src/cli.ts start $DEMO
