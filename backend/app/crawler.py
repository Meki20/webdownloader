"""Extract media (video, audio, images) from URLs using yt-dlp and generic HTML parsing."""
from __future__ import annotations

import uuid
from typing import Any

import httpx
import yt_dlp
from bs4 import BeautifulSoup

# Media extensions we consider as downloadable
MEDIA_EXTENSIONS = {
    "video": (".mp4", ".webm", ".mkv", ".avi", ".mov", ".m4v", ".ogv"),
    "audio": (".mp3", ".m4a", ".wav", ".ogg", ".flac", ".aac", ".wma"),
    "image": (".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg", ".ico"),
}


def _normalize_url(url: str, base: str) -> str:
    if not url or url.startswith("data:"):
        return ""
    if url.startswith("//"):
        return "https:" + url
    if url.startswith("/"):
        from urllib.parse import urlparse
        parsed = urlparse(base)
        return f"{parsed.scheme}://{parsed.netloc}{url}"
    if not url.startswith("http"):
        return ""
    return url


def _is_media_url(url: str) -> tuple[str | None, str]:
    """Return (type, url) if URL looks like media, else (None, '')."""
    url_lower = url.lower().split("?")[0]
    for kind, exts in MEDIA_EXTENSIONS.items():
        if any(url_lower.endswith(ext) or ext + "?" in url_lower for ext in exts):
            return (kind, url)
    # Common CDN path patterns
    if "/video/" in url or "video" in url_lower or "videos" in url_lower:
        return ("video", url)
    if "/audio/" in url or "audio" in url_lower or "/mp3" in url_lower:
        return ("audio", url)
    if "/image/" in url or "img" in url_lower or "images" in url_lower or "photo" in url_lower:
        return ("image", url)
    return (None, "")


# Browser-like headers to reduce 403 from YouTube and others
_YTDLP_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
}


def extract_with_ytdlp(url: str) -> list[dict[str, Any]]:
    """Use yt-dlp to extract media from supported sites (YouTube, Instagram, etc.)."""
    files: list[dict[str, Any]] = []
    opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": False,
        "skip_download": True,
        "http_headers": _YTDLP_HEADERS,
        "noplaylist": True,  # Single video per URL to avoid format/403 issues with playlists
    }

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
            if not info:
                return files
            # Normalize to dict and make JSON-serializable
            raw = ydl.sanitize_info(info) or {}
    except Exception as e:
        err_msg = str(e).lower()
        # Instagram (and similar): "There is no video in this post" — try flat extract to get image/thumbnail
        if "no video" in err_msg or "there is no video" in err_msg:
            try:
                flat_opts = {**opts, "extract_flat": True}
                with yt_dlp.YoutubeDL(flat_opts) as ydl:
                    info = ydl.extract_info(url, download=False)
                    if not info:
                        return files
                    raw = ydl.sanitize_info(info) or {}
                    thumb = raw.get("thumbnail") or raw.get("thumb") or ""
                    if not thumb and raw.get("thumbnails"):
                        for t in raw.get("thumbnails") or []:
                            if isinstance(t, dict) and t.get("url"):
                                thumb = t.get("url", "")
                                break
                    if thumb:
                        title = raw.get("title") or "Media"
                        files.append({
                            "id": str(uuid.uuid4()),
                            "title": title,
                            "type": "image",
                            "thumbnail": thumb,
                            "source": "yt-dlp",
                            "url": thumb,
                            "qualities": [{"url": thumb, "label": "default"}],
                        })
            except Exception:
                pass
        return files

    title = raw.get("title") or "Media"
    thumb = raw.get("thumbnail") or raw.get("thumb") or ""
    if not thumb and raw.get("thumbnails"):
        for t in (raw["thumbnails"] or []):
            if isinstance(t, dict) and t.get("url"):
                thumb = t.get("url", "")
                break
            if isinstance(t, str):
                thumb = t
                break

    def _make_file(ftitle: str, ftype: str, thumbnail: str, qualities: list[dict[str, Any]]) -> dict[str, Any]:
        if not qualities:
            return None
        seen_u = set()
        by_url = []
        for q in qualities:
            u = q.get("url", "")
            if u and u not in seen_u:
                seen_u.add(u)
                by_url.append(q)
        # One entry per quality label (e.g. one 144p, one 240p) to avoid "144p 144p 144p"
        seen_label: set[str] = set()
        deduped = []
        for q in by_url:
            label = (q.get("label") or "default").strip()
            if label not in seen_label:
                seen_label.add(label)
                deduped.append(q)
        if not deduped:
            return None
        return {
            "id": str(uuid.uuid4()),
            "title": ftitle,
            "type": ftype,
            "thumbnail": thumbnail,
            "source": "yt-dlp",
            "url": deduped[0]["url"],
            "qualities": deduped,
        }

    def _format_label(f: dict) -> str:
        h = f.get("height")
        if h:
            return f"{h}p"
        abr = f.get("abr")
        if abr:
            return f"{abr}k"
        return f.get("format_id") or "default"

    # Video formats → one file with multiple qualities
    video_qualities: list[dict[str, Any]] = []
    if "url" in raw and raw.get("url"):
        video_qualities.append({"url": raw["url"], "label": "direct", "format_id": None})
    for f in raw.get("formats") or []:
        furl = f.get("url") or f.get("fragment_base_url")
        if not furl:
            continue
        ext = (f.get("ext") or "mp4").lower()
        if ext in ("m3u8", "m3u"):
            continue
        vcodec = f.get("vcodec") or ""
        acodec = f.get("acodec") or ""
        if vcodec and vcodec != "none":
            video_qualities.append({
                "url": furl,
                "label": _format_label(f),
                "format_id": f.get("format_id"),
            })
        elif acodec and acodec != "none":
            # Audio-only: add to a separate audio file below
            pass
    if video_qualities:
        entry = _make_file(title, "video", thumb, video_qualities)
        if entry:
            files.append(entry)

    # Audio-only formats → one file with multiple qualities
    audio_qualities: list[dict[str, Any]] = []
    for f in raw.get("formats") or []:
        furl = f.get("url") or f.get("fragment_base_url")
        if not furl:
            continue
        vcodec = f.get("vcodec") or "none"
        if vcodec == "none" and (f.get("acodec") or "none") != "none":
            audio_qualities.append({
                "url": furl,
                "label": _format_label(f),
                "format_id": f.get("format_id"),
            })
    if audio_qualities:
        entry = _make_file(f"{title} (audio)", "audio", thumb, audio_qualities)
        if entry:
            files.append(entry)

    # Thumbnails → one image file with multiple qualities
    thumb_qualities: list[dict[str, str]] = []
    for t in raw.get("thumbnails") or []:
        turl = t.get("url")
        if turl:
            turl = _normalize_url(turl, url)
            if turl:
                label = t.get("id") or t.get("resolution") or "default"
                thumb_qualities.append({"url": turl, "label": str(label)})
    if thumb and not any(q.get("url") == thumb for q in thumb_qualities):
        thumb_qualities.append({"url": thumb, "label": "cover"})
    if thumb_qualities:
        entry = _make_file(f"{title} (thumbnail)", "image", thumb, thumb_qualities)
        if entry:
            files.append(entry)

    # Entries (playlist items): each entry = one video file with qualities
    for entry in raw.get("entries") or []:
        if not entry:
            continue
        entry_title = entry.get("title") or "Item"
        entry_thumb = entry.get("thumbnail") or ""
        eq: list[dict[str, Any]] = []
        if entry.get("url"):
            eq.append({"url": entry["url"], "label": "direct", "format_id": None})
        for f in entry.get("formats") or []:
            furl = f.get("url")
            if furl and (f.get("vcodec") or "none") != "none":
                eq.append({"url": furl, "label": _format_label(f), "format_id": f.get("format_id")})
        if eq:
            efile = _make_file(entry_title, "video", entry_thumb, eq)
            if efile:
                files.append(efile)

    return files


def extract_from_html(page_url: str, html: str) -> list[dict[str, Any]]:
    """Parse HTML and collect video/audio/image URLs; group same element as one file with qualities."""
    files: list[dict[str, Any]] = []
    seen_urls: set[str] = set()
    soup = BeautifulSoup(html, "html.parser")

    # og:image / og:video (e.g. Instagram, Facebook) when page has no direct media
    for prop, content in (("og:image", "image"), ("og:video", "video"), ("og:video:url", "video")):
        tag = soup.find("meta", property=prop)
        if tag and tag.get("content"):
            u = _normalize_url(tag["content"], page_url)
            if u and u not in seen_urls:
                seen_urls.add(u)
                files.append({
                    "id": str(uuid.uuid4()),
                    "url": u,
                    "title": "Media",
                    "type": content,
                    "thumbnail": u if content == "image" else "",
                    "source": "html",
                    "qualities": [{"url": u, "label": "default"}],
                })

    def add_one(url: str, title: str, kind: str) -> None:
        u = _normalize_url(url, page_url)
        if not u or u in seen_urls:
            return
        seen_urls.add(u)
        kind_resolved, _ = _is_media_url(u)
        if not kind_resolved:
            kind_resolved = kind
        files.append({
            "id": str(uuid.uuid4()),
            "url": u,
            "title": title or "Media",
            "type": kind_resolved,
            "thumbnail": u if kind_resolved == "image" else "",
            "source": "html",
            "qualities": [{"url": u, "label": "default"}],
        })

    def add_group(qualities: list[tuple[str, str]], title: str, kind: str, thumbnail: str = "") -> None:
        deduped: list[dict[str, str]] = []
        for u, label in qualities:
            u = _normalize_url(u, page_url)
            if not u or u in seen_urls:
                continue
            seen_urls.add(u)
            deduped.append({"url": u, "label": label})
        if not deduped:
            return
        kind_resolved = kind
        for u, _ in qualities:
            k, _ = _is_media_url(u)
            if k:
                kind_resolved = k
                break
        files.append({
            "id": str(uuid.uuid4()),
            "url": deduped[0]["url"],
            "title": title or "Media",
            "type": kind_resolved,
            "thumbnail": thumbnail or (deduped[0]["url"] if kind_resolved == "image" else ""),
            "source": "html",
            "qualities": deduped,
        })

    # <video>: one file per video element with src + all <source> as qualities
    for tag in soup.find_all("video"):
        qs: list[tuple[str, str]] = []
        if tag.get("src"):
            qs.append((tag["src"], "default"))
        for i, src in enumerate(tag.find_all("source", src=True)):
            qs.append((src["src"], f"source{i + 1}"))
        if qs:
            add_group(qs, "Video", "video", tag.get("poster") or "")
        elif tag.get("poster"):
            add_one(tag["poster"], "Video poster", "image")

    # <audio>: one file per audio element
    for tag in soup.find_all("audio"):
        qs: list[tuple[str, str]] = []
        if tag.get("src"):
            qs.append((tag["src"], "default"))
        for i, src in enumerate(tag.find_all("source", src=True)):
            qs.append((src["src"], f"source{i + 1}"))
        if qs:
            add_group(qs, "Audio", "audio", "")
        elif tag.get("src"):
            add_one(tag["src"], "Audio", "audio")

    # <img>: single URL or srcset → one file with qualities
    for tag in soup.find_all("img", src=True):
        srcset = tag.get("data-srcset") or tag.get("srcset")
        if srcset:
            qs = []
            for part in srcset.split(","):
                p = part.strip().split()
                u = p[0] if p else ""
                if u:
                    qs.append((u, p[1] if len(p) > 1 else "default"))
            if qs:
                add_group(qs, tag.get("alt") or "Image", "image", tag["src"])
            else:
                add_one(tag["src"], tag.get("alt") or "Image", "image")
        else:
            add_one(tag["src"], tag.get("alt") or "Image", "image")

    # <a href> single links
    for tag in soup.find_all("a", href=True):
        href = tag.get("href", "")
        kind, _ = _is_media_url(href)
        if kind:
            add_one(href, (tag.get_text() or "").strip() or "File", kind)

    for tag in soup.find_all(attrs={"data-src": True}):
        add_one(tag["data-src"], "Media", "image")
    for tag in soup.find_all(attrs={"data-video-src": True}):
        add_one(tag["data-video-src"], "Video", "video")
    for tag in soup.find_all(attrs={"data-srcset": True}):
        qs = []
        for part in tag["data-srcset"].split(","):
            u = part.strip().split()[0] if part.strip() else ""
            if u:
                qs.append((u, "default"))
        if qs:
            add_group(qs, "Image", "image", qs[0][0])
        else:
            for part in tag["data-srcset"].split(","):
                u = part.strip().split()[0] if part.strip() else ""
                if u:
                    add_one(u, "Image", "image")

    return files


async def crawl_url(url: str) -> list[dict[str, Any]]:
    """Crawl a URL: try yt-dlp first, then fall back to generic HTML."""
    files = extract_with_ytdlp(url)
    if files:
        return files
    # Fallback: fetch HTML and parse
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=15.0) as client:
            r = await client.get(url)
            r.raise_for_status()
            files = extract_from_html(url, r.text)
    except Exception:
        pass
    return files
