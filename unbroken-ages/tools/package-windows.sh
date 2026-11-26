#!/usr/bin/env bash
# Builds the Windows release and its installer:
#   build/windows/UnbrokenAges.exe   the game (self-contained: the .NET runtime is bundled)
#   build/UnbrokenAges-Setup-<version>.exe   the installer (Start menu, desktop shortcut, uninstaller)
# Needs: the .NET 8 SDK, a Godot 4.3 .NET binary in $GODOT (or `godot` on PATH) with the 4.3.stable.mono export
# templates installed, and NSIS (`makensis`). Runs on Linux or Windows (Git Bash). Usage: tools/package-windows.sh [version]
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION="${1:-0.1.0}"
GODOT="${GODOT:-$(command -v godot || true)}"
[ -n "$GODOT" ] || { echo "Set GODOT to a Godot 4.3 .NET binary." >&2; exit 2; }
command -v makensis >/dev/null || { echo "Install NSIS (makensis)." >&2; exit 2; }

OUT=build/windows
rm -rf "$OUT" && mkdir -p "$OUT"
echo "== Building the C# projects"
dotnet build godot/UnbrokenAges.Client.csproj -nologo -v q -c ExportRelease
echo "== Importing assets"
"$GODOT" --headless --path godot --import >/dev/null 2>&1 || true
echo "== Exporting the Windows build"
"$GODOT" --headless --path godot --export-release "Windows Desktop" "../$OUT/UnbrokenAges.exe" 2>&1 | grep -v "^$" | tail -5
[ -f "$OUT/UnbrokenAges.exe" ] && [ -f "$OUT/UnbrokenAges.pck" ] || { echo "Export failed." >&2; exit 1; }
[ -f "$OUT/data_UnbrokenAges.Client_windows_x86_64/UnbrokenAges.Client.dll" ] || { echo "Export is missing the C# assemblies." >&2; exit 1; }

echo "== Adding game content"
# The game loads its rules from content/ (and optional mods/) beside the executable.
cp -r content "$OUT/content"
mkdir -p "$OUT/mods" && cp -r mods/* "$OUT/mods/"
cp installer/HOW-TO-PLAY.txt "$OUT/HOW-TO-PLAY.txt"

echo "== Building the installer"
SETUP="build/UnbrokenAges-Setup-$VERSION.exe"
makensis -V2 -DVERSION="$VERSION" -DSRCDIR="$(cd "$OUT" && pwd)" -DOUTFILE="$(pwd)/$SETUP" installer/UnbrokenAges.nsi
ls -lh "$SETUP"
echo "Done: $SETUP"
