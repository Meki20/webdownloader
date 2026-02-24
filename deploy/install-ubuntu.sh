#!/usr/bin/env bash
# Install WebDownloader on Ubuntu for LAN or local use.
# Run from project root, e.g. /opt/webdownloader: ./deploy/install-ubuntu.sh
set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)"
cd "$ROOT"

echo "Installing system deps (Python, Node, ffmpeg for video)..."
sudo apt-get update -qq
sudo apt-get install -y -qq curl python3-venv python3-pip nodejs npm ffmpeg >/dev/null 2>&1 || true

echo "Backend: creating venv and installing Python deps (may take 1–2 min)..."
cd "$ROOT/backend"
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

echo "Frontend: installing npm deps and building..."
cd "$ROOT/frontend"
npm ci --silent 2>/dev/null || npm install --silent
npm run build

echo "Installing systemd service..."
sed "s|/opt/webdownloader|$ROOT|g" "$ROOT/deploy/webdownloader.service" | sudo tee /etc/systemd/system/webdownloader.service > /dev/null
sudo systemctl daemon-reload
sudo systemctl enable webdownloader
sudo systemctl start webdownloader

echo "Done. Service installed and started. Open http://$(hostname -I | awk '{print $1}'):8000 (or http://YOUR_SERVER_IP:8000) from your LAN."
