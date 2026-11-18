#!/bin/bash
# Builds "Văn phòng ảo.app" in /Applications (or ~/Applications when /Applications isn't writable, or in $1).
# The app runs scripts/office-app.sh from this checkout, so launcher changes need no rebuild; rerun this only if the repo moves.
REPO="$(cd "$(dirname "$0")/.." && pwd)" || exit 1
case "$REPO" in *\"*|*\\*) echo "Repo path contains a quote or backslash: $REPO" >&2; exit 1;; esac
DEST="${1:-/Applications}"; [ -w "$DEST" ] || DEST="$HOME/Applications"; mkdir -p "$DEST" || exit 1
APP="$DEST/Văn phòng ảo.app"; SRC="$(mktemp -d)/office.applescript"
chmod +x "$REPO/scripts/office-app.sh"
cat >"$SRC" <<EOF
on run
	try
		do shell script "/bin/bash " & quoted form of "$REPO/scripts/office-app.sh"
	on error errMsg number errNum
		if errNum is not -128 then
			activate
			display alert "Văn phòng ảo" message errMsg as critical
		end if
	end try
end run
EOF
rm -rf "$APP" && osacompile -o "$APP" "$SRC" || exit 1
plutil -replace CFBundleIdentifier -string "local.claude-office.launcher" "$APP/Contents/Info.plist"
plutil -replace LSUIElement -bool true "$APP/Contents/Info.plist"
codesign --force --sign - "$APP" 2>/dev/null || { echo "codesign failed" >&2; exit 1; } # Info.plist edits void osacompile's ad-hoc signature
touch "$APP"; echo "Installed: $APP"
