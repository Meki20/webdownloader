"""App config from environment. SaaS-ready."""
from __future__ import annotations

import os
from pathlib import Path

try:
    from dotenv import load_dotenv
    _d = Path(__file__).resolve().parent.parent
    for _p in (_d, _d.parent):
        _f = _p / ".env"
        if _f.is_file():
            load_dotenv(_f)
            break
except ImportError:
    pass

# CORS: comma-separated origins, or "*" for allow all. Default allows local dev.
CORS_ORIGINS: list[str] = [
    o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if o.strip()
]
if os.getenv("CORS_ORIGINS", "").strip() == "*":
    CORS_ORIGINS = ["*"]

# Rate limit: max requests per minute per IP (0 = disabled). Disabled by default; set to enable.
RATE_LIMIT_PER_MINUTE: int = max(0, int(os.getenv("RATE_LIMIT_PER_MINUTE", "0")))

# Optional API key: if set, requests must include X-API-Key header (except health).
API_KEY: str | None = os.getenv("API_KEY", "").strip() or None

# Log level
LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO").strip().upper()
