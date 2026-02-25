#!/usr/bin/env bash
# Update WebDownloader from git (pull main), rebuild frontend, restart service.
# Run from project root or with full path: sudo ./deploy/update-ubuntu.sh
# For one-click update from the app UI, allow www-data to run this without password:
#   sudo visudo -f /etc/sudoers.d/webdownloader-update
#   www-data ALL=(ALL) NOPASSWD: /opt/webdownloader/deploy/update-ubuntu.sh
set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)"
cd "$ROOT"

echo "Pulling from origin/main..."
git fetch origin main
git reset --hard origin/main

echo "Backend: updating Python deps..."
cd "$ROOT/backend"
.venv/bin/pip install -q -r requirements.txt

echo "Frontend: installing deps and building..."
cd "$ROOT/frontend"
npm ci --silent 2>/dev/null || npm install --silent
npm run build

echo "Restarting webdownloader service..."
systemctl restart webdownloader 2>/dev/null || sudo systemctl restart webdownloader

echo "Update complete."
