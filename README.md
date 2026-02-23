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

## Ubuntu Linux as a service

For production on Ubuntu, run the app as a systemd service (backend only; it serves the built frontend).

1. **Install and build** (from project root):

   ```bash
   chmod +x deploy/install-ubuntu.sh
   ./deploy/install-ubuntu.sh
   ```

   Or manually: `cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && cd ..` then `cd frontend && npm ci && npm run build && cd ..`.

2. **Install the service**: `sudo cp deploy/webdownloader.service /etc/systemd/system/`, then edit `User`, `Group`, `WorkingDirectory`, and paths to your install (e.g. `/opt/webdownloader`).

3. **Enable and start**: `sudo systemctl daemon-reload && sudo systemctl enable webdownloader && sudo systemctl start webdownloader`. Open **http://your-server:8000**.

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
