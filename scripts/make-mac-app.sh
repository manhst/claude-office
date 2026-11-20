#!/bin/bash
# Builds "Claude Deck.app" in /Applications (or ~/Applications when /Applications isn't writable, or in $1).
# The app runs scripts/deck-app.sh from this checkout, so launcher changes need no rebuild; rerun this only if the repo moves.
REPO="$(cd "$(dirname "$0")/.." && pwd)" || exit 1
case "$REPO" in *\"*|*\\*) echo "Repo path contains a quote or backslash: $REPO" >&2; exit 1;; esac
DEST="${1:-/Applications}"; [ -w "$DEST" ] || DEST="$HOME/Applications"; mkdir -p "$DEST" || exit 1
APP="$DEST/Claude Deck.app"; SRC="$(mktemp -d)/deck.applescript"
chmod +x "$REPO/scripts/deck-app.sh"
cat >"$SRC" <<EOF
on run
	try
		do shell script "/bin/bash " & quoted form of "$REPO/scripts/deck-app.sh"
	on error errMsg number errNum
		if errNum is not -128 then
			activate
			display alert "Claude Deck" message errMsg as critical
		end if
	end try
end run
EOF
rm -rf "$APP" && osacompile -o "$APP" "$SRC" || exit 1
plutil -replace CFBundleIdentifier -string "local.claude-deck.launcher" "$APP/Contents/Info.plist"
plutil -replace LSUIElement -bool true "$APP/Contents/Info.plist"
codesign --force --sign - "$APP" 2>/dev/null || { echo "codesign failed" >&2; exit 1; } # Info.plist edits void osacompile's ad-hoc signature
touch "$APP"; echo "Installed: $APP"
# The app was called "Văn phòng ảo.app" before the Claude Deck rename; it runs the scripts/office-app.sh shim, so replace it (that exact name only).
for old in "/Applications/Văn phòng ảo.app" "$HOME/Applications/Văn phòng ảo.app" "$DEST/Văn phòng ảo.app"; do
  if [ -d "$old" ]; then rm -rf "$old" && echo "Removed old app: $old"; fi
done
