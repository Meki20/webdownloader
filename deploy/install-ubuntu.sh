#!/usr/bin/env bash
# Install WebDownloader on Ubuntu: deps, venv, frontend build, optional systemd.
# Run from project root: ./deploy/install-ubuntu.sh
set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)"
cd "$ROOT"

echo "Installing system deps (optional, for curl/nc in run.sh)..."
sudo apt-get update -qq
sudo apt-get install -y -qq curl python3-venv python3-pip nodejs npm >/dev/null 2>&1 || true

echo "Backend: creating venv and installing Python deps..."
cd "$ROOT/backend"
python3 -m venv .venv
.venv/bin/pip install -q -r requirements.txt

echo "Frontend: installing npm deps and building..."
cd "$ROOT/frontend"
npm ci --silent 2>/dev/null || npm install --silent
npm run build

echo "Done. Run with: ./run.sh (dev) or configure systemd (see README)."
