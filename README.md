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

1. **Clone the repo at the latest release** (from `/opt`; requires `git` and `curl`):
   ```bash
   cd /opt
   sudo git clone https://github.com/Meki20/webdownloader.git
   cd webdownloader
   TAG=$(curl -sS -H "Accept: application/vnd.github.v3+json" -H "User-Agent: WebDownloader/1.0" "https://api.github.com/repos/Meki20/webdownloader/releases/latest" | grep '"tag_name"' | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p')
   git fetch origin tag "$TAG" && git checkout "$TAG"
   ```

2. **Give yourself ownership, then run the install script**:
   ```bash
   sudo chown -R "$USER" /opt/webdownloader
   chmod +x /opt/webdownloader/deploy/install-ubuntu.sh
   /opt/webdownloader/deploy/install-ubuntu.sh
   ```
   The script installs system deps (Python, Node, **ffmpeg**), creates the backend venv, builds the frontend, installs the systemd service, and starts it. **ffmpeg** is required for video downloads.

3. **Allow one-click updates from the app** (Settings → Updates). Add a sudoers rule so the service user can run the update script without a password:
   ```bash
   sudo visudo -f /etc/sudoers.d/webdownloader-update
   ```
   Add this line (use your install path if different):
   ```
   www-data ALL=(ALL) NOPASSWD: /opt/webdownloader/deploy/update-ubuntu.sh
   ```
   Save and exit.

4. **Give the service user ownership of the app** so it can read the git repo (for “Check for updates”) and run the update script:
   ```bash
   sudo chown -R www-data:www-data /opt/webdownloader
   sudo systemctl restart webdownloader
   ```

5. **Open from any device on your LAN**: **http://YOUR_SERVER_IP:8000** (e.g. `http://192.168.1.10:8000`). The service listens on `0.0.0.0:8000` and serves the built frontend.

**If the service fails with exit code 203 (EXEC):** systemd could not run the executable. Check that the venv exists: `ls -la /opt/webdownloader/backend/.venv/bin/uvicorn`. If missing, run the install script again from the repo root. If you installed elsewhere than `/opt/webdownloader`, edit the service: `sudo nano /etc/systemd/system/webdownloader.service` and fix paths, then `sudo systemctl daemon-reload && sudo systemctl restart webdownloader`. View logs: `sudo journalctl -u webdownloader -n 30`.

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

- **Manual:** From the project root run `sudo ./deploy/update-ubuntu.sh` to install the latest [GitHub release](https://github.com/Meki20/webdownloader/releases), rebuild the frontend, and restart the service.
- **From the app (Settings → Updates):** Use "Check for updates" and "Install update" for a one-click update. This only works if you completed steps 3 and 4 above (sudoers rule for `www-data` and `chown -R www-data:www-data`). The script fetches the latest release tag from GitHub and checks out that tag; updates are from releases only.
- **Optional:** Put `GITHUB_TOKEN=ghp_...` in `/opt/webdownloader/.env` so the app and the update script get a higher GitHub API rate limit and avoid 403 errors.

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
