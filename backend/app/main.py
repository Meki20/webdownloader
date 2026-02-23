"""FastAPI app: crawl URLs, list found files, download."""
from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
import tempfile
import uuid
from contextlib import asynccontextmanager
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from queue import Queue

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from app.config import CORS_ORIGINS
from app.crawler import crawl_url
from app.middleware import APIKeyMiddleware, RateLimitMiddleware

_executor = ThreadPoolExecutor(max_workers=4)

# In-memory store (replace with DB if you need persistence)
crawls: dict[str, dict] = {}
found_files: dict[str, list] = {}  # crawl_id -> list of file dicts


@asynccontextmanager
async def lifespan(app: FastAPI):
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
async def start_crawl(url: str):
    """Start a new crawl for the given URL."""
    crawl_id = str(uuid.uuid4())
    crawls[crawl_id] = {
        "id": crawl_id,
        "url": url,
        "status": "running",
        "fileCount": 0,
        "error": None,
    }
    found_files[crawl_id] = []
    loop = asyncio.get_event_loop()
    loop.run_in_executor(_executor, _run_crawl_sync, crawl_id, url)
    return crawls[crawl_id]


@app.get("/api/crawls")
async def list_crawls():
    """List all crawls."""
    return list(crawls.values())


@app.get("/api/crawls/{crawl_id}")
async def get_crawl(crawl_id: str):
    """Get one crawl by ID."""
    if crawl_id not in crawls:
        raise HTTPException(status_code=404, detail="Crawl not found")
    return crawls[crawl_id]


@app.get("/api/crawls/{crawl_id}/files")
async def get_crawl_files(crawl_id: str):
    """Get all found files for a crawl."""
    if crawl_id not in crawls:
        raise HTTPException(status_code=404, detail="Crawl not found")
    return found_files.get(crawl_id, [])


@app.get("/api/files")
async def get_all_found_files():
    """Get all found files across all crawls (for the "Found files" tab)."""
    out = []
    for cid, files in found_files.items():
        c = crawls.get(cid, {})
        for f in files:
            out.append({**f, "crawlId": cid, "crawlUrl": c.get("url", "")})
    return out


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

    # Audio or non-merge: stream to stdout (original path)
    args = [
        sys.executable, "-m", "yt_dlp", "-o", "-", "-f", format_str,
        "--no-part", "--no-warnings", "--quiet",
        "-S", "res,vcodec:h264,acodec:aac",
        "--check-formats",
    ]
    if media_type == "video":
        args.extend(["--merge-output-format", "mp4/mkv", "--downloader", "ffmpeg"])
    if media_type == "audio":
        audio_fmt = (output_format or "mp3").strip().lower() or "mp3"
        if audio_fmt not in ("mp3", "m4a", "aac", "ogg", "wav", "flac", "opus"):
            audio_fmt = "mp3"
        args.extend(["-x", "--audio-format", audio_fmt])
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


def _ascii_fallback(name: str) -> str:
    """Return ASCII-only version for Content-Disposition fallback (latin-1 safe)."""
    return name.encode("ascii", "replace").decode("ascii") or "download"


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
