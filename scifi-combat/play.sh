#!/bin/sh
# Emberfall: play on this computer (macOS, Linux). Serves this folder on http://localhost:8765/
# (this computer only) and opens the start menu in your browser. Ctrl+C or close the window to
# stop. Uses Node if you have it, else Python 3, else Ruby. PORT=9000 ./play.sh for another port.
cd "$(dirname "$0")" || exit 1
PORT="${PORT:-8765}"
URL="http://localhost:$PORT/start.html"
open_later() { (sleep 1; if command -v open >/dev/null 2>&1; then open "$URL"; elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1; fi) & }
if command -v node >/dev/null 2>&1; then
  exec node tools/serve.mjs "$PORT"
elif python3 -c 'import http.server' >/dev/null 2>&1; then
  echo "Emberfall is running at $URL (Ctrl+C to stop)"; open_later
  exec python3 -m http.server "$PORT" --bind 127.0.0.1
elif command -v ruby >/dev/null 2>&1 && ruby -e 'require "webrick"' >/dev/null 2>&1; then
  echo "Emberfall is running at $URL (Ctrl+C to stop)"; open_later
  exec ruby -run -e httpd . -p "$PORT" -b 127.0.0.1
else
  echo "Emberfall needs Node.js (nodejs.org) or Python 3 (python.org) to serve the game to your browser."
  printf 'Press Enter to close. '; read -r _
  exit 1
fi
