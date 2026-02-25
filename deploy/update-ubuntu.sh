#!/usr/bin/env bash
# Update WebDownloader to the latest GitHub release (tag), rebuild frontend, restart service.
# On success: prints one line only. On failure: prints a single structured ERROR line for the frontend.
# For one-click update from the app UI, allow www-data to run this without password:
#   sudo visudo -f /etc/sudoers.d/webdownloader-update
#   www-data ALL=(ALL) NOPASSWD: /usr/bin/bash /opt/webdownloader/deploy/update-ubuntu.sh
set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)"
cd "$ROOT"

GITHUB_REPO="Meki20/webdownloader"
# Use token from env or from repo .env (for one-click update when running as www-data)
if [ -z "$GITHUB_TOKEN" ] && [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$ROOT/.env" 2>/dev/null || true
  set +a
fi
CURL_OPTS=(-sS -L -H "Accept: application/vnd.github.v3+json" -H "User-Agent: WebDownloader-update/1.0")
if [ -n "$GITHUB_TOKEN" ]; then
  CURL_OPTS+=(-H "Authorization: Bearer $GITHUB_TOKEN")
fi

RESP=$(curl "${CURL_OPTS[@]}" "https://api.github.com/repos/${GITHUB_REPO}/releases/latest")
TAG=$(echo "$RESP" | grep '"tag_name"' | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p')
if [ -z "$TAG" ]; then
  echo "ERROR: No release found. Updates are from GitHub releases only."
  exit 1
fi

git fetch origin tag "$TAG" || { echo "ERROR: Could not fetch release from GitHub."; exit 1; }
git reset --hard "$TAG" || { echo "ERROR: Could not checkout release."; exit 1; }

cd "$ROOT/backend"
.venv/bin/pip install -q -r requirements.txt || { echo "ERROR: Backend dependencies failed."; exit 1; }

cd "$ROOT/frontend"
npm ci --silent 2>/dev/null || npm install --silent
npm run build || { echo "ERROR: Frontend build failed."; exit 1; }

systemctl restart webdownloader 2>/dev/null || sudo systemctl restart webdownloader || { echo "ERROR: Could not restart service."; exit 1; }

echo "Update complete. Reload the page to use the new version."
