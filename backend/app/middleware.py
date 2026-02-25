"""Rate limiting and API key middleware."""
from __future__ import annotations

import time
from collections import defaultdict

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from app.config import API_KEY, RATE_LIMIT_PER_MINUTE

# Per-IP: list of request timestamps in the last minute (pruned each check).
_rate: dict[str, list[float]] = defaultdict(list)


def _get_client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _rate_limit_exceeded(ip: str) -> bool:
    if RATE_LIMIT_PER_MINUTE <= 0:
        return False
    now = time.monotonic()
    window_start = now - 60
    # Keep only timestamps in the last minute
    _rate[ip] = [t for t in _rate[ip] if t > window_start]
    if len(_rate[ip]) >= RATE_LIMIT_PER_MINUTE:
        return True
    _rate[ip].append(now)
    return False


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Reject request with 429 if IP exceeds RATE_LIMIT_PER_MINUTE."""

    async def dispatch(self, request: Request, call_next):
        if request.url.path.startswith("/api/health") or request.url.path.startswith("/api/ready"):
            return await call_next(request)
        if request.url.path.startswith("/api/updates/check"):
            return await call_next(request)
        ip = _get_client_ip(request)
        if _rate_limit_exceeded(ip):
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many requests. Try again later."},
            )
        return await call_next(request)


class APIKeyMiddleware(BaseHTTPMiddleware):
    """When API_KEY is set, require X-API-Key header on /api/* (except health/ready)."""

    async def dispatch(self, request: Request, call_next):
        if not API_KEY:
            return await call_next(request)
        if request.url.path.startswith("/api/health") or request.url.path.startswith("/api/ready"):
            return await call_next(request)
        if request.url.path.startswith("/api/updates/check"):
            return await call_next(request)
        if request.url.path.startswith("/api/settings") or request.url.path.startswith("/api/history") or request.url.path.startswith("/api/queue"):
            return await call_next(request)
        if not request.url.path.startswith("/api/"):
            return await call_next(request)
        key = request.headers.get("X-API-Key", "").strip()
        if key != API_KEY:
            return JSONResponse(
                status_code=401,
                content={"detail": "Invalid or missing API key"},
            )
        return await call_next(request)


def require_api_key(request: Request) -> bool:
    """Return True if request is allowed (no API_KEY set, or valid key provided)."""
    if not API_KEY:
        return True
    key = request.headers.get("X-API-Key", "").strip()
    return key == API_KEY
