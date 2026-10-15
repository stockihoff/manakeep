#!/bin/bash
# Installs or updates Manakeep on this Mac. Running it again replaces the old version.
# Your collection and decks are never touched: they live in your save folder and in your browser's storage.
cd "$(dirname "$0")"
NEW="$PWD/Manakeep.app"
if [ ! -d "$NEW" ]; then echo "Can't find Manakeep.app next to this installer."; read -n 1 -s -r -p "Press any key to close"; exit 1; fi
ver() { sed -n 's/.*name="manakeep-version" content="\([^"]*\)".*/\1/p' "$1/Contents/Resources/Manakeep.html" 2>/dev/null | head -1; }
ours() { [ -d "$1" ] && grep -q "app.manakeep.launcher" "$1/Contents/Info.plist" 2>/dev/null; }
DEST="/Applications"; [ -w "$DEST" ] || DEST="$HOME/Applications"; mkdir -p "$DEST"
OLD=""
for d in "/Applications/Manakeep.app" "$HOME/Applications/Manakeep.app" "$HOME/Documents/Manakeep/Manakeep.app"; do
  if [ "$d" != "$NEW" ] && ours "$d"; then
    [ -z "$OLD" ] && OLD="$(ver "$d")"; [ -z "$OLD" ] && OLD="an earlier version"
    echo "Removing old copy: $d"; rm -rf "$d"
  fi
done
# old launcher bits (not your data): the cached page is refreshed on next launch
rm -f "$HOME/Library/Application Support/Manakeep/location" "$HOME/Library/Application Support/Manakeep/app/Manakeep.html"
ditto "$NEW" "$DEST/Manakeep.app"
xattr -dr com.apple.quarantine "$DEST/Manakeep.app" 2>/dev/null
NEWV="$(ver "$DEST/Manakeep.app")"
echo
if [ -n "$OLD" ]; then echo "Updated Manakeep: $OLD -> $NEWV"; else echo "Installed Manakeep $NEWV in $DEST"; fi
echo "Your collection and decks are untouched. Drag Manakeep from $DEST to your Dock to keep it there."
open "$DEST/Manakeep.app"
