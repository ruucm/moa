#!/bin/bash
# ─────────────────────────────────────────────────────────
# MOA dev server launcher (double-click in Finder)
#   1) kills any existing process holding port 5001,
#   2) starts the next dev server,
#   3) opens http://localhost:5001 in the browser.
# To quit: Ctrl+C in this window (or close the window)
# ─────────────────────────────────────────────────────────

PORT=5001
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
cd "$DIR" || exit 1

printf '\033]0;MOA dev server\007'   # terminal window title

# --- Ensure node/npm are on PATH (PATH can be sparse when launched from Finder) ---
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v npm >/dev/null 2>&1; then
  [ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "❌ node/npm not found. Install Node.js and run again."
  echo "   (press Enter to close this window)"
  read -r _
  exit 1
fi

echo "📂 $DIR"
echo "🟢 node $(node -v) · npm $(npm -v)"

# --- 1) Clear anything on port 5001 ---
PIDS="$(lsof -ti tcp:$PORT -sTCP:LISTEN 2>/dev/null)"
if [ -n "$PIDS" ]; then
  echo "🔻 Killing processes using port $PORT: $(echo "$PIDS" | tr '\n' ' ')"
  kill $PIDS 2>/dev/null
  for _ in $(seq 1 20); do
    lsof -ti tcp:$PORT -sTCP:LISTEN >/dev/null 2>&1 || break
    sleep 0.2
  done
  PIDS="$(lsof -ti tcp:$PORT -sTCP:LISTEN 2>/dev/null)"
  if [ -n "$PIDS" ]; then
    echo "🔻 Not responding — force killing."
    kill -9 $PIDS 2>/dev/null
    sleep 0.5
  fi
else
  echo "✅ Port $PORT is free"
fi

# --- Install dependencies (first run only) ---
if [ ! -d node_modules ]; then
  echo "📦 node_modules missing → npm install"
  npm install || { echo "❌ npm install failed"; read -r _; exit 1; }
fi

# --- 2) Open the browser once the server is up ---
(
  for _ in $(seq 1 120); do
    if curl -sf -o /dev/null "http://127.0.0.1:$PORT/"; then
      open "http://localhost:$PORT/"
      exit 0
    fi
    sleep 0.5
  done
) &

# --- 3) Dev server (foreground: watch the logs, quit with Ctrl+C) ---
echo "🚀 npm run dev  →  http://localhost:$PORT"
echo "   (press Ctrl+C to quit)"
echo
npm run dev

echo
echo "🛑 Server stopped. Press Enter to close this window."
read -r _
