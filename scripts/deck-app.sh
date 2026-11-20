#!/bin/bash
# macOS launcher run by "Claude Deck.app" (built by scripts/make-mac-app.sh). Same steps as start.command, but the server runs
# detached (log: orchestrator/logs/server-console.log), so no Terminal window has to stay open.
#   - server already up on :7777 → just open the UI (restart first if this launcher started it and the code changed since)
#   - otherwise: git pull --ff-only, install the mod, npm install if needed, build web, start, open the token URL
# Errors go to stderr + exit 1; the app shows them in an alert.
REPO="$(cd "$(dirname "$0")/.." && pwd)" || exit 1
export PATH="$HOME/.local/node/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
command -v node >/dev/null || PATH="$(/bin/zsh -lc 'printf %s "$PATH"' 2>/dev/null):$PATH"
PORT="${DECK_PORT:-${OFFICE_PORT:-7777}}"; RUN="$REPO/orchestrator/.run"; LOG="$REPO/orchestrator/logs/server-console.log"; MARK="$RUN/app-started"
note() { osascript -e "display notification \"$1\" with title \"Claude Deck\"" >/dev/null 2>&1; }
fail() { echo "$1" >&2; exit 1; }
listener() { lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | head -n1; }
healthy() { curl -fsS -m 2 "http://127.0.0.1:$PORT/health" 2>/dev/null | grep -q '"ok":true'; }
open_ui() { [ -s "$RUN/ui-url.txt" ] && open "$(head -n1 "$RUN/ui-url.txt")"; }
stop_server() {
  local pid="$1" pp; pp="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')"
  ps -o command= -p "$pp" 2>/dev/null | grep -q 'cli.ts start' || pp=""
  kill -INT "$pid" $pp 2>/dev/null
  for _ in $(seq 1 20); do [ -z "$(listener)" ] && return 0; sleep 0.5; done
  kill -KILL "$pid" $pp 2>/dev/null; sleep 0.5; [ -z "$(listener)" ]
}
# The claude CLI refuses MCP config writes from a Claude Code session env (Claude tab read-only). When this launcher runs clean
# (Finder/Dock) but the server inherited such an env (started from a session), restart it so the tab can write.
session_env() { ps eww -o command= -p "$1" 2>/dev/null | tr ' ' '\n' | grep -qE '^(CLAUDECODE|CLAUDE_CODE_CHILD_SESSION|CLAUDE_CODE_SESSION_ID)='; }
clean_launch() { [ -z "${CLAUDECODE}${CLAUDE_CODE_CHILD_SESSION}${CLAUDE_CODE_SESSION_ID}" ]; }
changed() { [ -f "$MARK" ] && [ -n "$(find "$REPO/orchestrator/src" "$REPO/mod/deck" "$REPO/web/src" "$REPO/web/index.html" -newer "$MARK" -type f 2>/dev/null | head -n1)" ]; }

pid="$(listener)"
if [ -n "$pid" ]; then
  healthy || fail "Port $PORT is used by another program (pid $pid), not the Claude Deck server."
  if clean_launch && session_env "$pid"; then note "Restarting the server outside the Claude Code session…"
  elif changed; then note "Code changed, restarting the server…"
  else open_ui || fail "Server is running but orchestrator/.run/ui-url.txt is missing. Restart it from Terminal."; exit 0; fi
  stop_server "$pid" || fail "Could not stop the old server (pid $pid)."
fi

command -v node >/dev/null || fail "Node.js not found (looked in ~/.local/node/bin, Homebrew and the login shell PATH)."
cd "$REPO" || fail "Repo not found: $REPO"
mkdir -p "$RUN" "$(dirname "$LOG")"; : >"$LOG"
note "Starting…"
git pull --ff-only >>"$LOG" 2>&1 || echo "[deck] WARNING: git pull failed, continuing with the local copy." >>"$LOG"
MODOUT="$(node scripts/install-mod.mjs 2>&1)" || MODOUT="$MODOUT
[deck] WARNING: mod install failed."
printf '%s\n' "$MODOUT" >>"$LOG"
# Non-blocking hints (notifications, not alerts): the old plugin still installed, or a writable mod dir.
if printf '%s' "$MODOUT" | grep -q 'the old plugin is disabled'; then
  note "Old Văn phòng ảo plugin disabled. In Claude Code run: /plugin uninstall office@office-mods, then /plugin marketplace remove office-mods"
fi
printf '%s' "$MODOUT" | grep -q 'writable' && note "Warning: the deck mod folder is writable by other users (see orchestrator/logs/server-console.log)."
[ -d orchestrator/node_modules ] || (cd orchestrator && npm install) >>"$LOG" 2>&1 || fail "npm install failed in orchestrator/ (see orchestrator/logs/server-console.log)."
[ -d web/node_modules ] || (cd web && npm install) >>"$LOG" 2>&1 || fail "npm install failed in web/ (see orchestrator/logs/server-console.log)."
(cd web && npm run build) >>"$LOG" 2>&1 || fail "Web build failed (see orchestrator/logs/server-console.log)."
rm -f "$RUN/ui-url.txt"; touch "$MARK"
nohup orchestrator/node_modules/.bin/tsx orchestrator/src/cli.ts start --port "$PORT" >>"$LOG" 2>&1 </dev/null &
disown
for _ in $(seq 1 60); do
  [ -s "$RUN/ui-url.txt" ] && { open_ui; exit 0; }
  kill -0 $! 2>/dev/null || fail "Server exited during startup: $(tail -n 3 "$LOG")"
  sleep 0.5
done
fail "Server did not start within 30 s (see orchestrator/logs/server-console.log)."
