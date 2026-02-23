#!/usr/bin/env bash
# Run WebDownloader: backend + frontend from project root.
# Usage: ./run.sh   (no dependency installing - run pip/npm install first)
set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
BACKEND_DIR="$ROOT/backend"
FRONTEND_DIR="$ROOT/frontend"

PYTHON="python3"
if [ -x "$BACKEND_DIR/.venv/bin/python" ]; then
  PYTHON="$BACKEND_DIR/.venv/bin/python"
elif [ -x "$BACKEND_DIR/venv/bin/python" ]; then
  PYTHON="$BACKEND_DIR/venv/bin/python"
fi

wait_for_port() {
  local port=$1 timeout=${2:-25} n=0
  until [ $n -ge $timeout ]; do
    if curl -s -o /dev/null "http://127.0.0.1:$port/api/crawls" 2>/dev/null || \
       (command -v nc >/dev/null 2>&1 && nc -z 127.0.0.1 "$port" 2>/dev/null); then
      return 0
    fi
    n=$((n+1))
    sleep 0.3
  done
  return 1
}

echo "Starting backend (port 8000)..."
cd "$BACKEND_DIR"
$PYTHON -m uvicorn app.main:app --reload --port 8000 \
  >> "$ROOT/backend.log" 2>> "$ROOT/backend_err.log" &
BACKEND_PID=$!
cleanup() {
  kill $BACKEND_PID 2>/dev/null || true
}
trap cleanup EXIT

echo "Waiting for backend to be ready..."
if ! wait_for_port 8000; then
  echo "Backend did not start in time. Check backend_err.log"
  cat "$ROOT/backend_err.log" 2>/dev/null || true
  exit 1
fi
echo "Backend ready. Starting frontend (http://localhost:5173)..."
cd "$FRONTEND_DIR"
exec npm run dev
