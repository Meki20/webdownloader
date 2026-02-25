# WebDownloader

A web app that crawls links (YouTube, Instagram, or any URL), finds media (videos, audio, images), and lets you download them — similar to JDownloader. **Deployment-ready**: configurable CORS, rate limiting, optional API key, health checks. Runs on **Windows** and **Ubuntu Linux** (including as a systemd service).

## Stack

- **Backend:** Python, FastAPI, yt-dlp, BeautifulSoup, httpx
- **Frontend:** Vite, React, TypeScript
- **Video downloads:** **ffmpeg** must be installed and on `PATH` so yt-dlp can merge video+audio into a single playable file (e.g. `.mkv`). [Download ffmpeg](https://ffmpeg.org/download.html) (Windows: add to PATH; Ubuntu: `sudo apt install ffmpeg`).

## Setup

### Backend

```bash
cd backend
python -m venv .venv
# Windows:  .venv\Scripts\activate
# Linux/Mac:  source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**. The frontend proxies `/api` to the backend.

## Run (single script)

From the project root, after dependencies are installed once:

| Platform | Command |
|----------|---------|
| **Windows (PowerShell)** | `.\run.ps1` |
| **Windows (Cmd)** | `run.bat` |
| **Linux / macOS** | `chmod +x run.sh && ./run.sh` |

This starts the backend (port 8000) and then the frontend (http://localhost:5173). The script waits until the backend is listening before starting the frontend, so the proxy works. Stop with Ctrl+C; the script will stop the backend as well.

If you see `ECONNREFUSED 127.0.0.1:8000`, the backend isn’t running: use the run script so both start together, or start the backend first in another terminal (`cd backend` then `uvicorn app.main:app --reload --port 8000`). If the script says "Backend did not start", check `backend_err.log` (e.g. missing dependencies: `pip install -r backend/requirements.txt`).

## Ubuntu: serve on LAN (all devices)

To run WebDownloader on an Ubuntu server so every device on your LAN can use it (phones, tablets, other PCs):

1. **Copy the project to the server** (e.g. `/opt/webdownloader`):
   ```bash
   sudo mkdir -p /opt/webdownloader
   sudo chown "$USER" /opt/webdownloader
   # Copy or clone the repo into /opt/webdownloader (git clone … or scp/rsync).
   ```

2. **Install and build** (from project root):
   ```bash
   cd /opt/webdownloader
   chmod +x deploy/install-ubuntu.sh
   ./deploy/install-ubuntu.sh
   ```
   This installs system deps (Python, Node, **ffmpeg**), creates the backend venv, and builds the frontend. **ffmpeg** is required for video downloads.

3. **Install the systemd service**:
   ```bash
   sudo cp deploy/webdownloader.service /etc/systemd/system/
   sudo nano /etc/systemd/system/webdownloader.service
   ```
   Set `User`, `Group`, `WorkingDirectory`, `PATH`, and `ExecStart` to your install path (default is `/opt/webdownloader`). Save and exit.

4. **Enable and start**:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable webdownloader
   sudo systemctl start webdownloader
   sudo systemctl status webdownloader
   ```

5. **Open from any device on your LAN**: **http://YOUR_SERVER_IP:8000** (e.g. `http://192.168.1.10:8000`). The service listens on `0.0.0.0:8000` and serves the built frontend; no separate frontend server or proxy is needed.

**If the service fails with exit code 203 (EXEC):** systemd could not run the executable. Fix the paths and permissions:

1. **Use the path where the app is actually installed.** The service file uses `/opt/webdownloader` by default. If you installed elsewhere (e.g. `/home/you/WebDownloader`), set that as `APP_ROOT` and run:
   ```bash
   APP_ROOT=/path/to/WebDownloader   # your actual install path
   sudo sed -i "s|/opt/webdownloader|$APP_ROOT|g" /etc/systemd/system/webdownloader.service
   ```
2. **Check that the venv and uvicorn exist:**
   ```bash
   ls -la "$APP_ROOT/backend/.venv/bin/uvicorn"
   ```
   If missing, create the venv and install deps: `cd "$APP_ROOT" && ./deploy/install-ubuntu.sh` (or `cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`).
3. **Ensure the service user can run the app.** If using `User=www-data`, give it access:
   ```bash
   sudo chown -R www-data:www-data "$APP_ROOT"
   ```
   Or for a quick test, set `User=` and `Group=` to your own user in the service file so it runs as you.
4. Reload and restart: `sudo systemctl daemon-reload && sudo systemctl restart webdownloader`, then `sudo journalctl -u webdownloader -n 30` to see logs.

## Running behind nginx

To put WebDownloader behind nginx (e.g. to use port 80/443, HTTPS, or another site on the same server):

1. **Install nginx** (if needed): `sudo apt install nginx`
2. **Copy and enable the site config**:
   ```bash
   sudo cp deploy/nginx-webdownloader.conf /etc/nginx/sites-available/webdownloader
   sudo ln -s /etc/nginx/sites-available/webdownloader /etc/nginx/sites-enabled/
   ```
3. **Optional:** Edit `/etc/nginx/sites-available/webdownloader` and set `server_name` to your domain; for HTTPS, uncomment the `listen 443 ssl` block and set `ssl_certificate` and `ssl_certificate_key`.
4. **Test and reload nginx**: `sudo nginx -t && sudo systemctl reload nginx`
5. **Ensure the backend is running** (e.g. `sudo systemctl start webdownloader`). Nginx proxies to `http://127.0.0.1:8000`.

**Optional — bind backend only to localhost:** If you only want the app reachable via nginx (not on port 8000), change the systemd service `ExecStart` to use `--host 127.0.0.1` instead of `--host 0.0.0.0`, then `sudo systemctl daemon-reload && sudo systemctl restart webdownloader`.

### Updates (from GitHub)

- **Manual:** From the project root run `sudo ./deploy/update-ubuntu.sh` to pull from `origin/main`, rebuild the frontend, and restart the service.
- **From the app (Settings → Updates):** Use "Check for updates" and "Install update" for a one-click update. For that to work, allow the service user to run the update script without a password:
  ```bash
  sudo visudo -f /etc/sudoers.d/webdownloader-update
  ```
  Add one line (replace `/opt/webdownloader` if you installed elsewhere):
  ```
  www-data ALL=(ALL) NOPASSWD: /opt/webdownloader/deploy/update-ubuntu.sh
  ```
  Save and exit. The repo must be a git clone (e.g. from [github.com/Meki20/webdownloader](https://github.com/Meki20/webdownloader)); the script runs `git fetch origin main` and `git reset --hard origin/main`.

- **If "Check for updates" returns 503:** The service user (`www-data`) needs read access to the git repo. Run: `sudo chown -R www-data:www-data /opt/webdownloader` (use your install path). Ensure `git` is installed (`apt install git`).

## SaaS / production deployment

Set environment variables (e.g. in systemd `Environment=` or a `.env` file in the backend directory):

| Variable | Description | Example |
|----------|-------------|---------|
| `CORS_ORIGINS` | Allowed origins (comma-separated), or `*` for all | `https://app.example.com` or `*` |
| `RATE_LIMIT_PER_MINUTE` | Max requests per IP per minute (0 = disabled) | `60` |
| `API_KEY` | If set, all `/api/*` requests must send `X-API-Key` (except `/api/health`, `/api/ready`) | `your-secret-key` |
| `LOG_LEVEL` | Logging level | `INFO` |

Copy `backend/.env.example` to `backend/.env` and edit. Health checks:

- **GET /api/health** — liveness
- **GET /api/ready** — readiness

## Usage

1. **Home** — Paste a URL (YouTube, Instagram, or any webpage) and click **Find files**. Recent crawls are listed below.
2. **Downloads** — All discovered videos, audio, and images. Choose quality and format, then **Download**. List can be sorted by recent, type, or title.
3. **History** — Persistent list of URLs you’ve crawled. Edit title, **Find again**, or remove.
4. **Settings** — Theme (light/dark/system) and about.

Crawls run in the background; the list refreshes every few seconds until the crawl finishes.
