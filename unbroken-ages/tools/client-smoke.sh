#!/usr/bin/env bash
# Plays the real Godot client for 45 turns with scripted input and saves a screenshot after every step.
# Fails if the client crashes or any step fails. Usage: tools/client-smoke.sh [screenshot-dir]
# Needs a Godot 4.3 .NET binary in $GODOT (or on PATH as godot). Without a display it uses xvfb-run, and it uses a
# software Vulkan driver (lavapipe) when one is installed at /opt/lavapipe.
set -euo pipefail
cd "$(dirname "$0")/.."
GODOT="${GODOT:-$(command -v godot || true)}"
[ -n "$GODOT" ] || { echo "Set GODOT to a Godot 4.3 .NET binary." >&2; exit 2; }
SHOTS="${1:-$(mktemp -d)}"
mkdir -p "$SHOTS"
dotnet build godot/UnbrokenAges.Client.csproj -nologo -v q
"$GODOT" --headless --path godot --import >/dev/null 2>&1 || true
[ -f /opt/lavapipe/lvp_icd.json ] && export VK_ICD_FILENAMES=/opt/lavapipe/lvp_icd.json
RUN=("$GODOT" --path godot --rendering-driver vulkan -- --autostart
     --do=found,research,produce,end,next,move-east,turns:40,select-city,panel:T,panel:P,panel:C,save,turns:3,load,zoom-out
     --shots="$SHOTS" --quit)
if [ -z "${DISPLAY:-}" ]; then RUN=(xvfb-run -a -s "-screen 0 1600x900x24" "${RUN[@]}"); fi
LOG="$SHOTS/client.log"
set +e; "${RUN[@]}" >"$LOG" 2>&1; CODE=$?; set -e
grep '\[auto\]' "$LOG" | grep -v screenshot
if [ $CODE -ne 0 ] || grep -q "FAILED" "$LOG" || ! grep -q "zoom-out: ok" "$LOG"; then
  echo "Client smoke test FAILED (exit $CODE). Log: $LOG" >&2; exit 1
fi
echo "Client smoke test passed. Screenshots: $SHOTS"
