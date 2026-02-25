"""FastAPI app: crawl URLs, list found files, download."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import subprocess
import sys
import tempfile
import uuid
import zipfile
from contextlib import asynccontextmanager
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from queue import Queue

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from app.config import CORS_ORIGINS
from app.crawler import crawl_url, extract_playlist_entries, is_youtube_playlist_url
from app.middleware import APIKeyMiddleware, RateLimitMiddleware

_executor = ThreadPoolExecutor(max_workers=4)

# In-memory store (replace with DB if you need persistence)
crawls: dict[str, dict] = {}
found_files: dict[str, list] = {}  # crawl_id -> list of file dicts

# Per-client-IP storage (settings, history, download queue)
_settings_store: dict[str, dict] = {}
_history_store: dict[str, list] = {}
_queue_store: dict[str, list] = {}

# Persistent per-IP data: data/{history|settings|queue}/{sanitized_ip}.json
_DATA_DIR = Path(__file__).resolve().parent.parent / "data"
_HISTORY_DIR = _DATA_DIR / "history"
_SETTINGS_DIR = _DATA_DIR / "settings"
_QUEUE_DIR = _DATA_DIR / "queue"
_MAX_HISTORY_ENTRIES = 200


def _history_key(ip: str) -> str:
    """Consistent key for history store and filename (sanitized IP)."""
    s = re.sub(r"[^a-zA-Z0-9._-]", "_", ip)
    return s[:64] if len(s) > 64 else s


def _safe_ip_filename(ip: str) -> str:
    return _history_key(ip) + ".json"


def _load_history_from_disk() -> None:
    """Load all per-IP history files into _history_store."""
    if not _HISTORY_DIR.is_dir():
        return
    for path in _HISTORY_DIR.glob("*.json"):
        try:
            raw = path.read_text(encoding="utf-8")
            data = json.loads(raw)
            if isinstance(data, list):
                _history_store[path.stem] = data[: _MAX_HISTORY_ENTRIES]
        except Exception:
            pass


def _load_settings_from_disk() -> None:
    """Load all per-IP settings files into _settings_store."""
    if not _SETTINGS_DIR.is_dir():
        return
    for path in _SETTINGS_DIR.glob("*.json"):
        try:
            raw = path.read_text(encoding="utf-8")
            data = json.loads(raw)
            if isinstance(data, dict):
                _settings_store[path.stem] = data
        except Exception:
            pass


def _load_queue_from_disk() -> None:
    """Load all per-IP queue files into _queue_store."""
    if not _QUEUE_DIR.is_dir():
        return
    for path in _QUEUE_DIR.glob("*.json"):
        try:
            raw = path.read_text(encoding="utf-8")
            data = json.loads(raw)
            if isinstance(data, list):
                _queue_store[path.stem] = data
        except Exception:
            pass


_log = logging.getLogger(__name__)


def _save_history_for_ip(ip: str, entries: list) -> None:
    """Persist history for this IP to disk."""
    _HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    path = _HISTORY_DIR / _safe_ip_filename(ip)
    try:
        path.write_text(json.dumps(entries, ensure_ascii=False), encoding="utf-8")
    except Exception as e:
        _log.warning("Failed to save history for %s: %s", ip, e)


def _save_settings_for_ip(ip: str, data: dict) -> None:
    """Persist settings for this IP to disk."""
    _SETTINGS_DIR.mkdir(parents=True, exist_ok=True)
    path = _SETTINGS_DIR / _safe_ip_filename(ip)
    try:
        path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    except Exception as e:
        _log.warning("Failed to save settings for %s: %s", ip, e)


def _save_queue_for_ip(ip: str, entries: list) -> None:
    """Persist queue for this IP to disk."""
    _QUEUE_DIR.mkdir(parents=True, exist_ok=True)
    path = _QUEUE_DIR / _safe_ip_filename(ip)
    try:
        path.write_text(json.dumps(entries, ensure_ascii=False), encoding="utf-8")
    except Exception as e:
        _log.warning("Failed to save queue for %s: %s", ip, e)


def _client_ip(request: Request) -> str:
    """Client IP for per-user storage. Prefer proxy headers so behind nginx we get the real client."""
    host = request.client.host if request.client else ""
    # When behind nginx/proxy, connection is from 127.0.0.1 — use headers instead
    forwarded = request.headers.get("x-forwarded-for", "").strip()
    if forwarded:
        # Use rightmost (direct client of our proxy); fallback to first
        parts = [p.strip() for p in forwarded.split(",") if p.strip()]
        if parts:
            return parts[-1]
    real_ip = request.headers.get("x-real-ip", "").strip()
    if real_ip:
        return real_ip
    return host or "unknown"


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        _DATA_DIR.mkdir(parents=True, exist_ok=True)
        _HISTORY_DIR.mkdir(parents=True, exist_ok=True)
        _SETTINGS_DIR.mkdir(parents=True, exist_ok=True)
        _QUEUE_DIR.mkdir(parents=True, exist_ok=True)
    except PermissionError:
        _log.warning(
            "Cannot create backend/data (Permission denied). Create it and chown to the service user, e.g.: "
            "sudo mkdir -p /opt/webdownloader/backend/data/{history,settings,queue} && sudo chown -R www-data:www-data /opt/webdownloader/backend/data"
        )
    _load_history_from_disk()
    _load_settings_from_disk()
    _load_queue_from_disk()
    yield
    pass


app = FastAPI(title="WebDownloader", lifespan=lifespan)

app.add_middleware(APIKeyMiddleware)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health():
    """Liveness: is the process up."""
    return {"status": "ok"}


@app.get("/api/ready")
async def ready():
    """Readiness: can serve traffic."""
    return {"status": "ready"}


# Repo root (backend/app/main.py -> backend -> repo root)
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
_GITHUB_REPO = "Meki20/webdownloader"


def _github_headers() -> dict[str, str]:
    """Headers for GitHub API: User-Agent (required), Accept, optional Authorization from GITHUB_TOKEN."""
    headers = {
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "WebDownloader-update-check",
    }
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GITHUB_API_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token.strip()}"
    return headers


def _github_error_message(status_code: int, response: httpx.Response) -> str:
    """User-friendly message for GitHub API errors; 403 is often rate limit."""
    if status_code == 403:
        try:
            data = response.json()
            if "rate limit" in (data.get("message") or "").lower():
                return (
                    "GitHub rate limit exceeded (60/hour without token). "
                    "Set GITHUB_TOKEN on the server for higher limits, or try again later."
                )
        except Exception:
            pass
        return (
            "GitHub API forbidden (403). "
            "If rate limited: set GITHUB_TOKEN on the server or try again later."
        )
    if status_code == 404:
        return "No releases found"
    return f"GitHub API: {status_code}"


def _get_tag_commit_sha(tag_name: str) -> str | None:
    """Resolve a tag to its commit SHA via GitHub API. Returns None on failure."""
    ref_url = f"https://api.github.com/repos/{_GITHUB_REPO}/git/refs/tags/{tag_name}"
    ref_resp = httpx.get(ref_url, timeout=10, headers=_github_headers())
    if ref_resp.status_code != 200:
        return None
    obj = (ref_resp.json().get("object") or {})
    sha = (obj.get("sha") or "").strip()
    kind = (obj.get("type") or "").strip().lower()
    if kind == "commit":
        return sha if len(sha) == 40 else None
    if kind == "tag":
        tag_url = obj.get("url")
        if not tag_url:
            return None
        tag_resp = httpx.get(tag_url, timeout=10, headers=_github_headers())
        if tag_resp.status_code != 200:
            return None
        obj2 = (tag_resp.json().get("object") or {})
        sha2 = (obj2.get("sha") or "").strip()
        return sha2 if len(sha2) == 40 else None
    return None


def _updates_check_sync() -> dict:
    """
    Check if the installed commit is behind the latest GitHub release.
    Compares current HEAD commit SHA to the latest release's commit SHA (from GitHub API).
    """
    import subprocess as sp
    try:
        # Current HEAD commit SHA
        head = sp.run(
            ["git", "-C", str(_REPO_ROOT), "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if head.returncode != 0 or not (head.stdout or "").strip():
            return {"error": "Not a git repository or could not read HEAD"}
        current_sha = (head.stdout or "").strip()

        # Version info for display (tag or dev/short sha)
        version_info = _version_info_sync()
        current_version = (version_info.get("version") or "dev").strip() or "dev"

        # Latest release from GitHub
        r = httpx.get(
            f"https://api.github.com/repos/{_GITHUB_REPO}/releases/latest",
            timeout=10,
            headers=_github_headers(),
        )
        if r.status_code != 200:
            return {"error": _github_error_message(r.status_code, r)}
        data = r.json()
        latest_tag = (data.get("tag_name") or "").strip()
        if not latest_tag:
            return {"error": "No release tag in response"}

        # Resolve latest release tag to commit SHA
        latest_sha = _get_tag_commit_sha(latest_tag)
        if not latest_sha:
            return {"error": f"Could not resolve tag {latest_tag} to commit"}

        # Compare by commit: same commit = up to date
        if current_sha == latest_sha:
            return {
                "upToDate": True,
                "currentVersion": current_version,
                "latestTag": latest_tag,
                "currentSha": current_sha[:12],
                "latestSha": latest_sha[:12],
            }

        # Different commit: check how many commits we're behind (optional, requires fetch)
        behind = 1
        try:
            fetch = sp.run(
                ["git", "-C", str(_REPO_ROOT), "fetch", "origin", "tag", latest_tag, "--no-write-fetch-head"],
                capture_output=True,
                text=True,
                timeout=15,
            )
            if fetch.returncode == 0:
                rev_list = sp.run(
                    ["git", "-C", str(_REPO_ROOT), "rev-list", "--count", f"{current_sha}..{latest_tag}"],
                    capture_output=True,
                    text=True,
                    timeout=5,
                )
                if rev_list.returncode == 0 and (rev_list.stdout or "").strip().isdigit():
                    behind = max(1, int((rev_list.stdout or "").strip()))
        except Exception:
            pass

        return {
            "upToDate": False,
            "behind": behind,
            "currentVersion": current_version,
            "latestTag": latest_tag,
            "currentSha": current_sha[:12],
            "latestSha": latest_sha[:12],
        }
    except Exception as e:
        return {"error": str(e)}


def _updates_install_sync() -> str | None:
    """
    Run update script (Ubuntu/server only). Returns None on success, error message on failure.
    On non-Linux (e.g. Windows dev) returns a clear message instead of running sudo.
    """
    import subprocess as sp
    if sys.platform != "linux":
        return (
            "One-click update is only supported on Linux (e.g. Ubuntu server). "
            "On this machine, update manually: fetch the latest release tag, checkout, rebuild, and restart."
        )
    script = _REPO_ROOT / "deploy" / "update-ubuntu.sh"
    if not script.is_file():
        return "Update script not found (deploy/update-ubuntu.sh). Run updates manually on the server."
    try:
        result = sp.run(
            ["sudo", "bash", str(script)],
            capture_output=True,
            text=True,
            timeout=300,
            cwd=str(_REPO_ROOT),
        )
        if result.returncode != 0:
            out = (result.stderr or result.stdout or "").strip()
            # Prefer a single structured ERROR line for the frontend
            if out:
                for line in out.splitlines():
                    line = line.strip()
                    if line.upper().startswith("ERROR:"):
                        return line
            return out or f"Exit code {result.returncode}"
        return None
    except FileNotFoundError:
        return "sudo or update script not found. Install is only supported on Linux with sudo."
    except Exception as e:
        return str(e)


def _version_info_sync() -> dict:
    """Current version: tag if HEAD points at one, else find release whose tag = HEAD, else commit short SHA."""
    import subprocess as sp
    out: dict = {"version": "dev"}
    try:
        head_sha = None
        r_sha = sp.run(
            ["git", "-C", str(_REPO_ROOT), "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            timeout=2,
        )
        if r_sha.returncode == 0 and (r_sha.stdout or "").strip():
            head_sha = (r_sha.stdout or "").strip()
        # Prefer tag that points at current commit (works in detached HEAD at a tag)
        r_pt = sp.run(
            ["git", "-C", str(_REPO_ROOT), "tag", "-l", "--points-at", "HEAD"],
            capture_output=True,
            text=True,
            timeout=2,
        )
        tag = None
        if r_pt.returncode == 0 and (r_pt.stdout or "").strip():
            tag = (r_pt.stdout or "").strip().splitlines()[0].strip()
        if not tag:
            r = sp.run(
                ["git", "-C", str(_REPO_ROOT), "describe", "--tags", "--exact-match"],
                capture_output=True,
                text=True,
                timeout=2,
            )
            if r.returncode == 0 and (r.stdout or "").strip():
                tag = (r.stdout or "").strip()
        if tag:
            out["version"] = tag
            out["tag"] = tag
            try:
                resp = httpx.get(
                    f"https://api.github.com/repos/{_GITHUB_REPO}/releases/tags/{tag}",
                    timeout=10,
                    headers=_github_headers(),
                )
                if resp.status_code == 200:
                    data = resp.json()
                    out["name"] = data.get("name") or tag
                    out["body"] = data.get("body") or ""
                    out["published_at"] = data.get("published_at") or ""
                    out["html_url"] = data.get("html_url") or ""
            except Exception:
                pass
        elif head_sha:
            # No local tag at HEAD: find a release whose tag points to this commit via GitHub API
            try:
                list_resp = httpx.get(
                    f"https://api.github.com/repos/{_GITHUB_REPO}/releases",
                    timeout=10,
                    headers=_github_headers(),
                )
                if list_resp.status_code == 200:
                    for release in list_resp.json():
                        t = (release.get("tag_name") or "").strip()
                        if not t:
                            continue
                        ref_resp = httpx.get(
                            f"https://api.github.com/repos/{_GITHUB_REPO}/git/refs/tags/{t}",
                            timeout=5,
                            headers=_github_headers(),
                        )
                        if ref_resp.status_code != 200:
                            continue
                        obj = (ref_resp.json().get("object") or {})
                        if obj.get("type") == "tag":
                            # annotated tag: need one more request for the commit
                            obj_resp = httpx.get(
                                obj.get("url"),
                                timeout=5,
                                headers=_github_headers(),
                            )
                            if obj_resp.status_code == 200:
                                obj = obj_resp.json().get("object") or {}
                        ref_sha = (obj.get("sha") or "").strip()
                        if ref_sha and (ref_sha == head_sha or ref_sha.startswith(head_sha) or head_sha.startswith(ref_sha)):
                            out["version"] = t
                            out["tag"] = t
                            out["name"] = release.get("name") or t
                            out["body"] = release.get("body") or ""
                            out["published_at"] = release.get("published_at") or ""
                            out["html_url"] = release.get("html_url") or ""
                            break
            except Exception:
                pass
            if out["version"] == "dev":
                r_short = sp.run(
                    ["git", "-C", str(_REPO_ROOT), "rev-parse", "--short", "HEAD"],
                    capture_output=True,
                    text=True,
                    timeout=2,
                )
                if r_short.returncode == 0 and (r_short.stdout or "").strip():
                    out["version"] = (r_short.stdout or "").strip()
    except Exception:
        pass
    return out


@app.get("/api/version")
async def get_version():
    """Current version and release notes for the installed release (from GitHub)."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_executor, _version_info_sync)


@app.get("/api/updates/check")
async def updates_check():
    """Check if the app is behind the latest GitHub release."""
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(_executor, _updates_check_sync)
    if "error" in result:
        raise HTTPException(status_code=503, detail=result["error"])
    return result


@app.post("/api/updates/install")
async def updates_install():
    """Checkout latest GitHub release, rebuild frontend, restart service. Linux only (sudo + update script)."""
    loop = asyncio.get_event_loop()
    err = await loop.run_in_executor(_executor, _updates_install_sync)
    if err:
        # 503 when install is not supported on this environment (e.g. Windows); 500 for real failures
        status = 503 if "only supported on Linux" in err or "only supported on Linux with sudo" in err else 500
        raise HTTPException(status_code=status, detail=err)
    return {"ok": True}


def _run_crawl_sync(crawl_id: str, url: str) -> None:
    try:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        files = loop.run_until_complete(crawl_url(url))
        found_files[crawl_id] = files
        crawls[crawl_id]["status"] = "completed"
        crawls[crawl_id]["fileCount"] = len(files)
    except Exception as e:
        crawls[crawl_id]["status"] = "failed"
        crawls[crawl_id]["error"] = str(e)
    finally:
        loop.close()


@app.post("/api/crawls")
async def start_crawl(request: Request, url: str):
    """Start a new crawl for the given URL."""
    ip = _client_ip(request)
    crawl_id = str(uuid.uuid4())
    crawls[crawl_id] = {
        "id": crawl_id,
        "url": url,
        "status": "running",
        "fileCount": 0,
        "error": None,
        "ip": ip,
    }
    found_files[crawl_id] = []
    loop = asyncio.get_event_loop()
    loop.run_in_executor(_executor, _run_crawl_sync, crawl_id, url)
    return crawls[crawl_id]


def _crawls_for_ip(ip: str) -> list[dict]:
    return [c for c in crawls.values() if c.get("ip") == ip]


@app.get("/api/crawls")
async def list_crawls(request: Request):
    """List all crawls for this client IP."""
    return _crawls_for_ip(_client_ip(request))


@app.get("/api/crawls/{crawl_id}")
async def get_crawl(request: Request, crawl_id: str):
    """Get one crawl by ID (must belong to this client IP)."""
    if crawl_id not in crawls:
        raise HTTPException(status_code=404, detail="Crawl not found")
    if crawls[crawl_id].get("ip") != _client_ip(request):
        raise HTTPException(status_code=404, detail="Crawl not found")
    return crawls[crawl_id]


@app.get("/api/crawls/{crawl_id}/files")
async def get_crawl_files(request: Request, crawl_id: str):
    """Get all found files for a crawl (must belong to this client IP)."""
    if crawl_id not in crawls:
        raise HTTPException(status_code=404, detail="Crawl not found")
    if crawls[crawl_id].get("ip") != _client_ip(request):
        raise HTTPException(status_code=404, detail="Crawl not found")
    return found_files.get(crawl_id, [])


@app.get("/api/files")
async def get_all_found_files(request: Request):
    """Get all found files across this client IP's crawls."""
    ip = _client_ip(request)
    out = []
    for cid, files in found_files.items():
        c = crawls.get(cid, {})
        if c.get("ip") != ip:
            continue
        for f in files:
            out.append({**f, "crawlId": cid, "crawlUrl": c.get("url", "")})
    return out


# --- Per-IP settings, history, queue ---

_SETTINGS_DEFAULTS = {
    "defaultFormats": {"video": "mp4", "audio": "mp3", "image": "png"},
    "defaultQualityIndex": 0,
    "namingTemplate": "%name%",
    "downloadConcurrency": 3,
    "theme": "system",
}


def _ensure_settings_loaded(key: str, ip: str) -> None:
    """Load settings from disk if not in memory (e.g. after restart)."""
    if key in _settings_store:
        return
    path = _SETTINGS_DIR / _safe_ip_filename(ip)
    if path.is_file():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                _settings_store[key] = data
        except Exception:
            pass


@app.get("/api/settings")
async def get_settings(request: Request):
    """Get settings for this client IP (persisted to disk)."""
    ip = _client_ip(request)
    key = _history_key(ip)
    _ensure_settings_loaded(key, ip)
    stored = _settings_store.get(key, {})
    return {**_SETTINGS_DEFAULTS, **stored}


@app.post("/api/settings")
async def post_settings(request: Request):
    """Save settings for this client IP. Persisted to disk."""
    try:
        body = await request.json()
    except Exception:
        body = {}
    if not isinstance(body, dict):
        body = {}
    ip = _client_ip(request)
    key = _history_key(ip)
    current = _settings_store.get(key, {})
    _settings_store[key] = {**current, **body}
    _save_settings_for_ip(ip, _settings_store[key])
    return _settings_store[key]


@app.get("/api/history")
async def get_history(request: Request):
    """Get history entries for this client IP (persisted to disk)."""
    key = _history_key(_client_ip(request))
    if key not in _history_store:
        # Lazy-load from disk if we have a file (e.g. server restarted)
        path = _HISTORY_DIR / _safe_ip_filename(_client_ip(request))
        if path.is_file():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(data, list):
                    _history_store[key] = data[: _MAX_HISTORY_ENTRIES]
            except Exception:
                pass
    return _history_store.get(key, [])


@app.post("/api/history")
async def post_history(request: Request):
    """Replace history for this client IP (full array). Persisted to disk."""
    try:
        body = await request.json()
    except Exception:
        body = []
    entries = list(body)[:_MAX_HISTORY_ENTRIES] if isinstance(body, list) else []
    ip = _client_ip(request)
    key = _history_key(ip)
    _history_store[key] = entries
    _save_history_for_ip(ip, entries)
    return _history_store[key]


def _ensure_queue_loaded(key: str, ip: str) -> None:
    """Load queue from disk if not in memory (e.g. after restart)."""
    if key in _queue_store:
        return
    path = _QUEUE_DIR / _safe_ip_filename(ip)
    if path.is_file():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, list):
                _queue_store[key] = data
        except Exception:
            pass


@app.get("/api/queue")
async def get_queue(request: Request):
    """Get download queue for this client IP (persisted to disk)."""
    ip = _client_ip(request)
    key = _history_key(ip)
    _ensure_queue_loaded(key, ip)
    return _queue_store.get(key, [])


@app.post("/api/queue")
async def post_queue(request: Request):
    """Replace download queue for this client IP. Persisted to disk."""
    try:
        body = await request.json()
    except Exception:
        body = []
    queue = list(body) if isinstance(body, list) else []
    ip = _client_ip(request)
    key = _history_key(ip)
    _queue_store[key] = queue
    _save_queue_for_ip(ip, queue)
    return _queue_store[key]


# Browser-like headers so YouTube/other CDNs don't return 403 on proxy download
_DOWNLOAD_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
}


# Larger chunks = fewer yields and better throughput (proxy + yt-dlp streams)
_STREAM_CHUNK_SIZE = 1024 * 1024  # 1 MB


def _ytdlp_format_string(quality: str | None, format_id: str | None, media_type: str | None) -> str:
    """Build yt-dlp format so video gets merged video+audio (full playable file)."""
    import re
    if media_type == "audio":
        return format_id or "best"
    # Video: use merge format so we get video+audio, not video-only (small / unsupported)
    if quality and quality != "direct" and quality != "default":
        m = re.match(r"^(\d+)p?$", str(quality).strip().lower())
        if m:
            h = m.group(1)
            return f"bestvideo[height<={h}]+bestaudio/best"
    return "bestvideo+bestaudio/best"


def _ffmpeg_convert_video_to_pipe_args(output_format: str, compatible_audio: bool = False) -> list[str]:
    """Convert to target format. compatible_audio=True re-encodes to AAC (slower but plays everywhere)."""
    of = output_format.strip().lower()
    movflags = "-movflags", "frag_keyframe+empty_moov+default_base_moof"
    # MP4: copy = full speed; compatible_audio = re-encode to AAC for Opus/old players
    if of == "mp4":
        if compatible_audio:
            return [
                "ffmpeg", "-i", "pipe:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "128k",
                *movflags, "-f", "mp4", "pipe:1",
            ]
        return ["ffmpeg", "-i", "pipe:0", "-c", "copy", *movflags, "-f", "mp4", "pipe:1"]
    if of == "flv":
        if compatible_audio:
            return ["ffmpeg", "-i", "pipe:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-f", "flv", "pipe:1"]
        return ["ffmpeg", "-i", "pipe:0", "-c", "copy", "-f", "flv", "pipe:1"]
    if of == "webm":
        return ["ffmpeg", "-i", "pipe:0", "-c:v", "libvpx-vp9", "-speed", "4", "-c:a", "libopus", "-f", "webm", "pipe:1"]
    if of == "avi":
        return ["ffmpeg", "-i", "pipe:0", "-c:v", "mpeg4", "-c:a", "mp3", "-f", "avi", "pipe:1"]
    return ["ffmpeg", "-i", "pipe:0", "-c", "copy", *movflags, "-f", "mp4", "pipe:1"]


def _ffmpeg_convert_video_to_file_args(
    input_path: str, output_path: str, output_format: str, compatible_audio: bool = False
) -> list[str]:
    """Convert to file. faststart = moov at start so duration/seek work in players."""
    of = output_format.strip().lower()
    movflags = "-movflags", "faststart"
    if of == "mp4":
        if compatible_audio:
            return [
                "ffmpeg", "-y", "-i", input_path, "-c:v", "copy", "-c:a", "aac", "-b:a", "128k",
                *movflags, output_path,
            ]
        return ["ffmpeg", "-y", "-i", input_path, "-c", "copy", *movflags, output_path]
    if of == "flv":
        if compatible_audio:
            return ["ffmpeg", "-y", "-i", input_path, "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", output_path]
        return ["ffmpeg", "-y", "-i", input_path, "-c", "copy", output_path]
    if of == "webm":
        return ["ffmpeg", "-y", "-i", input_path, "-c:v", "libvpx-vp9", "-speed", "4", "-c:a", "libopus", output_path]
    if of == "avi":
        return ["ffmpeg", "-y", "-i", input_path, "-c:v", "mpeg4", "-c:a", "mp3", output_path]
    return ["ffmpeg", "-y", "-i", input_path, "-c", "copy", *movflags, output_path]


def _run_ytdlp_to_queue(
    page_url: str,
    format_str: str,
    chunk_queue: Queue,
    media_type: str | None = None,
    output_format: str | None = None,
    compatible_audio: bool = False,
) -> None:
    """Run yt-dlp; put output into chunk_queue. Video: temp file + native concurrent fragments (fast). Windows-safe."""
    conv_fmt = (output_format or "").strip().lower() if output_format else ""

    # Video with merge: download to temp file using NATIVE downloader + concurrent fragments (fast).
    # --downloader ffmpeg would bypass concurrent-fragments and is the bottleneck (see yt-dlp docs).
    # Use a path that does NOT exist yet (no mkstemp): yt-dlp creates the file; mkstemp leaves an empty file.
    if media_type == "video" and "+" in format_str:
        temp_dir = tempfile.mkdtemp()
        temp_path = os.path.join(temp_dir, "video.mkv")
        try:
            chunk_queue.put({"progress": {"phase": "downloading"}})
            args = [
                sys.executable, "-m", "yt_dlp", "-o", temp_path, "-f", format_str,
                "--no-part", "--no-warnings", "--quiet",
                "--merge-output-format", "mp4/mkv",  # prefer MP4 (plays everywhere) when codecs allow
                "--concurrent-fragments", "16",  # parallel DASH/HLS download (native only)
                "-S", "res,vcodec:h264,acodec:aac",  # prefer compatible codecs for all players
                "--check-formats",  # only select actually downloadable formats
                page_url,
            ]
            proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            proc.wait(timeout=600)
            if proc.returncode != 0:
                chunk_queue.put(None)
                return
            out_file = Path(temp_path)
            if not out_file.is_file():
                # yt-dlp may output .mp4 when --merge-output-format mp4/mkv picks mp4
                merged = list(Path(temp_dir).glob("*.mkv")) + list(Path(temp_dir).glob("*.mp4"))
                out_file = merged[0] if len(merged) == 1 else None
            if out_file is None or not (out_file.is_file() and out_file.stat().st_size > 0):
                chunk_queue.put(None)
                return
            out_path = str(out_file)
            stream_path = out_path
            if conv_fmt in ("mp4", "webm", "avi", "flv"):
                chunk_queue.put({"progress": {"phase": "converting"}})
                converted_path = os.path.join(temp_dir, f"out.{conv_fmt}")
                ffmpeg_args = _ffmpeg_convert_video_to_file_args(out_path, converted_path, conv_fmt, compatible_audio)
                proc_ff = subprocess.Popen(ffmpeg_args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                proc_ff.wait(timeout=600)
                if proc_ff.returncode == 0 and Path(converted_path).is_file() and Path(converted_path).stat().st_size > 0:
                    stream_path = converted_path
            file_size = Path(stream_path).stat().st_size
            chunk_queue.put({"progress": {"phase": "streaming", "size": file_size}})
            with open(stream_path, "rb") as f:
                while True:
                    chunk = f.read(_STREAM_CHUNK_SIZE)
                    if not chunk:
                        break
                    chunk_queue.put(chunk)
        finally:
            chunk_queue.put(None)
            try:
                for p in Path(temp_dir).iterdir():
                    p.unlink(missing_ok=True)
                Path(temp_dir).rmdir()
            except Exception:
                pass
        return

    # Audio: download to temp file then stream (yt-dlp does not apply -x when -o "-" is used).
    if media_type == "audio":
        audio_fmt = (output_format or "mp3").strip().lower() or "mp3"
        if audio_fmt not in ("mp3", "m4a", "aac", "ogg", "wav", "flac", "opus"):
            audio_fmt = "mp3"
        temp_dir = tempfile.mkdtemp()
        out_tpl = os.path.join(temp_dir, "audio.%(ext)s")
        try:
            chunk_queue.put({"progress": {"phase": "downloading"}})
            args = [
                sys.executable, "-m", "yt_dlp", "-o", out_tpl,
                "-x", "--audio-format", audio_fmt,
                "-f", "bestaudio/best",
                "--no-part", "--no-warnings", "--quiet",
                "--no-playlist",
                page_url,
            ]
            proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            proc.wait(timeout=600)
            if proc.returncode != 0:
                chunk_queue.put(None)
                return
            # yt-dlp may write audio.opus, audio.m4a, etc.
            candidates = list(Path(temp_dir).glob("audio.*"))
            out_file = candidates[0] if len(candidates) == 1 else None
            if out_file is None or not (out_file.is_file() and out_file.stat().st_size > 0):
                chunk_queue.put(None)
                return
            file_size = out_file.stat().st_size
            chunk_queue.put({"progress": {"phase": "streaming", "size": file_size}})
            with open(out_file, "rb") as f:
                while True:
                    chunk = f.read(_STREAM_CHUNK_SIZE)
                    if not chunk:
                        break
                    chunk_queue.put(chunk)
        finally:
            chunk_queue.put(None)
            try:
                for p in Path(temp_dir).iterdir():
                    p.unlink(missing_ok=True)
                Path(temp_dir).rmdir()
            except Exception:
                pass
        return

    # Video (non-merge) or other: stream to stdout
    args = [
        sys.executable, "-m", "yt_dlp", "-o", "-", "-f", format_str,
        "--no-part", "--no-warnings", "--quiet",
        "-S", "res,vcodec:h264,acodec:aac",
        "--check-formats",
    ]
    if media_type == "video":
        args.extend(["--merge-output-format", "mp4/mkv", "--downloader", "ffmpeg"])
    args.append(page_url)

    proc_ydl = subprocess.Popen(
        args,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    proc_ff = None
    try:
        if media_type == "video" and conv_fmt in ("mp4", "webm", "avi", "flv"):
            ffmpeg_args = _ffmpeg_convert_video_to_pipe_args(conv_fmt, compatible_audio)
            proc_ff = subprocess.Popen(
                ffmpeg_args,
                stdin=proc_ydl.stdout,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
            )
            proc_ydl.stdout.close()
            reader = proc_ff
        else:
            reader = proc_ydl
        while True:
            chunk = reader.stdout.read(_STREAM_CHUNK_SIZE)
            if not chunk:
                break
            chunk_queue.put(chunk)
    finally:
        chunk_queue.put(None)
        if proc_ff is not None:
            try:
                proc_ff.wait(timeout=30)
            except Exception:
                proc_ff.kill()
                proc_ff.wait()
        if proc_ydl.poll() is None:
            proc_ydl.kill()
            proc_ydl.wait()


async def _stream_from_ytdlp_queue(chunk_queue: Queue):
    """Read from an already-fed queue; worker must be started before this runs."""
    loop = asyncio.get_event_loop()
    while True:
        chunk = await loop.run_in_executor(_executor, chunk_queue.get)
        if chunk is None:
            break
        if isinstance(chunk, dict):
            yield (json.dumps(chunk) + "\n").encode("utf-8")
        else:
            yield chunk


def _stream_ytdlp(
    page_url: str,
    format_str: str,
    media_type: str | None = None,
    output_format: str | None = None,
    compatible_audio: bool = False,
):
    """Sync wrapper: create queue, start worker immediately, return async generator that reads queue."""
    chunk_queue: Queue = Queue()
    loop = asyncio.get_event_loop()
    loop.run_in_executor(
        _executor,
        _run_ytdlp_to_queue,
        page_url,
        format_str,
        chunk_queue,
        media_type,
        output_format,
        compatible_audio,
    )
    return _stream_from_ytdlp_queue(chunk_queue)


async def _stream_from_url(url: str):
    """Yield chunks from URL; keep httpx stream open for the duration."""
    async with httpx.AsyncClient(
        follow_redirects=True, timeout=60.0, headers=_DOWNLOAD_HEADERS
    ) as client:
        async with client.stream("GET", url) as r:
            r.raise_for_status()
            async for chunk in r.aiter_bytes(chunk_size=_STREAM_CHUNK_SIZE):
                yield chunk


def _run_ffmpeg_image_to_queue(image_url: str, output_format: str, chunk_queue: Queue) -> None:
    """Convert image at URL to given format via ffmpeg; put stdout into chunk_queue. Windows-safe."""
    of = output_format.strip().lower()
    if of == "jpeg":
        of = "jpg"
    if of not in ("png", "jpg", "webp"):
        of = "png"
    # Single image: -frames:v 1, then format/codec
    codec = {"png": "png", "jpg": "mjpeg", "webp": "libwebp"}[of]
    proc = subprocess.Popen(
        ["ffmpeg", "-i", image_url, "-frames:v", "1", "-f", "image2", "-c:v", codec, "pipe:1"],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    try:
        while True:
            chunk = proc.stdout.read(_STREAM_CHUNK_SIZE)
            if not chunk:
                break
            chunk_queue.put(chunk)
    finally:
        chunk_queue.put(None)
        try:
            proc.wait(timeout=30)
        except Exception:
            proc.kill()
            proc.wait()


async def _stream_ffmpeg_image(image_url: str, output_format: str):
    """Stream image converted to output_format via ffmpeg (for proxy downloads)."""
    chunk_queue: Queue = Queue()
    loop = asyncio.get_event_loop()
    loop.run_in_executor(_executor, _run_ffmpeg_image_to_queue, image_url, output_format, chunk_queue)
    while True:
        chunk = await loop.run_in_executor(_executor, chunk_queue.get)
        if chunk is None:
            break
        yield chunk


def _safe_filename(name: str, max_len: int = 200) -> str:
    """Return a safe filename (no path, no control chars)."""
    import re
    if not name or not name.strip():
        return "download"
    name = name.strip()
    name = re.sub(r'[/\\:*?"<>|\x00-\x1f]', "_", name)
    name = name[:max_len].strip() or "download"
    return name


_PLAYLIST_ZIP_MAX_ENTRIES = 100
_PLAYLIST_DOWNLOAD_TIMEOUT_PER_ITEM = 420  # 7 min per video


def _build_playlist_zip_sync(
    playlist_url: str,
    media_type: str,
    output_format: str | None,
) -> tuple[str | None, str | None, str | None]:
    """Download each playlist item and zip. Returns (zip_path, zip_filename, temp_dir) or (None, None, None) on failure."""
    entries, playlist_title = extract_playlist_entries(playlist_url, max_entries=_PLAYLIST_ZIP_MAX_ENTRIES)
    if not entries:
        return (None, None, None)
    temp_dir = tempfile.mkdtemp()
    try:
        out_format = (output_format or "").strip().lower()
        if media_type == "video":
            out_format = out_format or "mp4"
            if out_format not in ("mp4", "mkv", "webm", "avi", "flv"):
                out_format = "mp4"
        elif media_type == "audio":
            out_format = out_format or "mp3"
            if out_format not in ("mp3", "m4a", "aac", "ogg", "wav", "flac", "opus"):
                out_format = "mp3"
        elif media_type == "image":
            out_format = out_format or "jpg"

        for i, entry in enumerate(entries):
            video_url = entry.get("url") or ""
            if not video_url.startswith("http"):
                continue
            title = _safe_filename(entry.get("title") or "item", max_len=150)
            out_tpl = os.path.join(temp_dir, f"{i + 1:03d} - {title}.%(ext)s")

            if media_type == "video":
                args = [
                    sys.executable, "-m", "yt_dlp", "-o", out_tpl,
                    "-f", "bestvideo+bestaudio/best",
                    "--merge-output-format", "mp4/mkv",
                    "--no-part", "--no-warnings", "--quiet",
                    "--restrict-filenames",
                    "--concurrent-fragments", "8",
                    "-S", "res,vcodec:h264,acodec:aac",
                    "--check-formats",
                    video_url,
                ]
            elif media_type == "audio":
                args = [
                    sys.executable, "-m", "yt_dlp", "-o", out_tpl,
                    "-x", "--audio-format", out_format,
                    "--no-part", "--no-warnings", "--quiet",
                    "--restrict-filenames",
                    video_url,
                ]
            else:
                # image: thumbnails only
                args = [
                    sys.executable, "-m", "yt_dlp", "-o", out_tpl,
                    "--write-thumbnail", "--skip-download",
                    "--no-warnings", "--quiet",
                    "--restrict-filenames",
                    "--convert-subs", "no",
                    video_url,
                ]
            proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            proc.wait(timeout=_PLAYLIST_DOWNLOAD_TIMEOUT_PER_ITEM)
            if proc.returncode != 0:
                _log.warning("Playlist item %s failed: %s", i + 1, video_url[:80])

        # Build zip of all downloaded files (not subdirs)
        zip_name = _safe_filename(playlist_title, max_len=120) + ".zip"
        zip_path = os.path.join(temp_dir, zip_name)
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for f in Path(temp_dir).iterdir():
                if f.is_file() and f.suffix.lower() == ".zip" and f.name == zip_name:
                    continue
                if f.is_file():
                    zf.write(f, f.name)
        return (zip_path, zip_name, temp_dir)
    except Exception as e:
        _log.exception("Playlist zip build failed: %s", e)
        try:
            for p in Path(temp_dir).iterdir():
                p.unlink(missing_ok=True)
            Path(temp_dir).rmdir()
        except Exception:
            pass
        return (None, None, None)


def _stream_playlist_zip(zip_path: str, temp_dir: str):
    """Yield chunks from zip file, then clean up temp_dir."""
    try:
        with open(zip_path, "rb") as f:
            while True:
                chunk = f.read(_STREAM_CHUNK_SIZE)
                if not chunk:
                    break
                yield chunk
    finally:
        try:
            for p in Path(temp_dir).iterdir():
                p.unlink(missing_ok=True)
            Path(temp_dir).rmdir()
        except Exception:
            pass


def _ascii_fallback(name: str) -> str:
    """Return ASCII-only version for Content-Disposition fallback (latin-1 safe)."""
    return name.encode("ascii", "replace").decode("ascii") or "download"


@app.get("/api/playlist-entries")
async def get_playlist_entries(url: str):
    """Return playlist entries (id, title, url, thumbnail) and playlist title for a YouTube playlist URL."""
    if not url or not url.startswith("http"):
        raise HTTPException(status_code=400, detail="Invalid URL")
    if not is_youtube_playlist_url(url):
        raise HTTPException(status_code=400, detail="URL is not a YouTube playlist")
    entries, playlist_title = extract_playlist_entries(url, max_entries=_PLAYLIST_ZIP_MAX_ENTRIES)
    return {"entries": entries, "title": playlist_title}


@app.get("/api/playlist-zip")
async def download_playlist_as_zip(
    request: Request,
    url: str,
    media_type: str,
    output_format: str | None = None,
):
    """Download entire YouTube playlist as a ZIP (videos, audio, or images/thumbnails)."""
    from urllib.parse import quote
    if not url or not url.startswith("http"):
        raise HTTPException(status_code=400, detail="Invalid URL")
    if not is_youtube_playlist_url(url):
        raise HTTPException(status_code=400, detail="URL is not a YouTube playlist")
    mt = (media_type or "").strip().lower()
    if mt not in ("video", "audio", "image"):
        raise HTTPException(status_code=400, detail="media_type must be video, audio, or image")
    loop = asyncio.get_event_loop()
    zip_path, zip_filename, temp_dir = await loop.run_in_executor(
        _executor,
        _build_playlist_zip_sync,
        url,
        mt,
        output_format,
    )
    if not zip_path or not temp_dir:
        raise HTTPException(status_code=502, detail="Playlist download or zip failed")
    headers = {}
    if zip_filename:
        safe = _safe_filename(zip_filename)
        try:
            ascii_only = _ascii_fallback(safe)
            if ascii_only == safe:
                headers["Content-Disposition"] = f'attachment; filename="{safe}"'
            else:
                encoded = quote(safe, safe="")
                headers["Content-Disposition"] = (
                    f"attachment; filename=\"{ascii_only}\"; filename*=UTF-8''{encoded}"
                )
        except Exception:
            headers["Content-Disposition"] = f'attachment; filename="{_ascii_fallback(safe)}"'
    return StreamingResponse(
        _stream_playlist_zip(zip_path, temp_dir),
        media_type="application/zip",
        headers=headers,
    )


@app.get("/api/download")
async def download_file(
    url: str,
    filename: str | None = None,
    output_format: str | None = None,
    media_type: str | None = None,
):
    """Stream a file from its URL (proxy). Optional output_format + media_type to convert (e.g. image -> png)."""
    from urllib.parse import quote
    if not url or not url.startswith("http"):
        raise HTTPException(status_code=400, detail="Invalid URL")
    try:
        headers = {}
        if filename:
            safe = _safe_filename(filename)
            if safe and safe != "download":
                # HTTP headers must be latin-1; use RFC 5987 for Unicode
                try:
                    ascii_only = _ascii_fallback(safe)
                    if ascii_only == safe:
                        headers["Content-Disposition"] = f'attachment; filename="{safe}"'
                    else:
                        encoded = quote(safe, safe="")
                        headers["Content-Disposition"] = (
                            f"attachment; filename=\"{ascii_only}\"; filename*=UTF-8''{encoded}"
                        )
                except Exception:
                    headers["Content-Disposition"] = f'attachment; filename="{_ascii_fallback(safe)}"'
        if media_type == "image" and output_format and output_format.strip().lower() in ("png", "jpg", "jpeg", "webp"):
            return StreamingResponse(
                _stream_ffmpeg_image(url, output_format),
                media_type="application/octet-stream",
                headers=headers,
            )
        return StreamingResponse(
            _stream_from_url(url),
            media_type="application/octet-stream",
            headers=headers,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.get("/api/download-ytdlp")
async def download_with_ytdlp(
    url: str,
    quality: str | None = None,
    format_id: str | None = None,
    media_type: str | None = None,
    output_format: str | None = None,
    compatible_audio: str | None = None,
    filename: str | None = None,
):
    """Download via yt-dlp. compatible_audio=1 re-encodes to AAC (slower, works in all players). Default: copy = full speed."""
    from urllib.parse import quote
    if not url or not url.startswith("http"):
        raise HTTPException(status_code=400, detail="Invalid URL")
    try:
        format_str = _ytdlp_format_string(quality, format_id, media_type)
        reencode_aac = compatible_audio and str(compatible_audio).strip().lower() in ("1", "true", "yes")
        headers = {}
        if filename:
            safe = _safe_filename(filename)
            if safe and safe != "download":
                try:
                    ascii_only = _ascii_fallback(safe)
                    if ascii_only == safe:
                        headers["Content-Disposition"] = f'attachment; filename="{safe}"'
                    else:
                        encoded = quote(safe, safe="")
                        headers["Content-Disposition"] = (
                            f"attachment; filename=\"{ascii_only}\"; filename*=UTF-8''{encoded}"
                        )
                except Exception:
                    headers["Content-Disposition"] = f'attachment; filename="{_ascii_fallback(safe)}"'
        return StreamingResponse(
            _stream_ytdlp(url, format_str, media_type, output_format, reencode_aac),
            media_type="application/octet-stream",
            headers=headers,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


# Production: serve built frontend from frontend/dist when present (e.g. on Ubuntu)
# Path is backend/app/main.py -> parent.parent = backend -> sibling frontend/dist
_FRONTEND_DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
if _FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=str(_FRONTEND_DIST), html=True), name="static")
else:
    @app.get("/")
    async def root():
        return RedirectResponse(url="/index.html")
