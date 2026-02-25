#!/usr/bin/env bash
# Update WebDownloader to the latest GitHub release (tag), rebuild frontend, restart service.
# Run from project root or with full path: sudo ./deploy/update-ubuntu.sh
# For one-click update from the app UI, allow www-data to run this without password:
#   sudo visudo -f /etc/sudoers.d/webdownloader-update
#   www-data ALL=(ALL) NOPASSWD: /opt/webdownloader/deploy/update-ubuntu.sh
set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)"
cd "$ROOT"

GITHUB_REPO="Meki20/webdownloader"
echo "Fetching latest release from GitHub..."
TAG=$(curl -sS -H "Accept: application/vnd.github.v3+json" "https://api.github.com/repos/${GITHUB_REPO}/releases/latest" | grep '"tag_name"' | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p')
if [ -z "$TAG" ]; then
  echo "No release found. Updates are from GitHub releases only."
  exit 1
fi
echo "Checking out release $TAG..."
git fetch origin tag "$TAG"
git reset --hard "$TAG"

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
