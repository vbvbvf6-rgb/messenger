"""# backend/main.py
FastAPI app initialization, DB bootstrap, and Socket.IO mounting.
"""

from datetime import datetime
from collections import defaultdict
import time

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from socketio import ASGIApp, AsyncServer

from .database import Base, engine
from .routes import ensure_default_room, hash_pin, router
from .sockets import register_socket_handlers
from .p2p_sockets import register_p2p_handlers


# Rate limiting: simple in-memory store (ip -> [(timestamp, request_count)])
rate_limit_store = defaultdict(list)

class RateLimitMiddleware(BaseHTTPMiddleware):
    """Simple rate limiting to prevent DDoS attacks"""
    
    async def dispatch(self, request: Request, call_next):
        # Allow static files and docs
        if request.url.path.startswith("/static") or request.url.path in ["/docs", "/openapi.json"]:
            return await call_next(request)
        
        # Get client IP
        client_ip = request.client.host if request.client else "unknown"
        
        # Check rate limit: max 150 requests per minute per IP
        current_time = time.time()
        window = 60  # 1 minute window
        
        # Clean old entries
        rate_limit_store[client_ip] = [
            ts for ts in rate_limit_store[client_ip]
            if current_time - ts < window
        ]
        
        # Count requests in window
        request_count = len(rate_limit_store[client_ip])
        
        if request_count >= 150:
            return JSONResponse({"detail": "Rate limit exceeded. Max 150 requests per minute."}, status_code=429)
        
        # Add current request timestamp
        rate_limit_store[client_ip].append(current_time)
        
        return await call_next(request)


def _ensure_user_columns():
    # Lightweight startup migration for existing SQLite databases.
    with engine.connect() as conn:
        rows = conn.exec_driver_sql("PRAGMA table_info(users)").fetchall()
        columns = {row[1] for row in rows}
        if "pin_hash" not in columns:
            conn.exec_driver_sql("ALTER TABLE users ADD COLUMN pin_hash VARCHAR(128) NOT NULL DEFAULT ''")
        if "last_active_at" not in columns:
            conn.exec_driver_sql("ALTER TABLE users ADD COLUMN last_active_at DATETIME")
        if "twofa_enabled" not in columns:
            conn.exec_driver_sql("ALTER TABLE users ADD COLUMN twofa_enabled BOOLEAN NOT NULL DEFAULT 0")
        if "twofa_secret" not in columns:
            conn.exec_driver_sql("ALTER TABLE users ADD COLUMN twofa_secret VARCHAR(64)")
        if "is_banned" not in columns:
            conn.exec_driver_sql("ALTER TABLE users ADD COLUMN is_banned BOOLEAN NOT NULL DEFAULT 0")
        if "banned_at" not in columns:
            conn.exec_driver_sql("ALTER TABLE users ADD COLUMN banned_at DATETIME")
        if "banned_reason" not in columns:
            conn.exec_driver_sql("ALTER TABLE users ADD COLUMN banned_reason VARCHAR(255)")
        # Fill null values in legacy DB rows.
        conn.exec_driver_sql("UPDATE users SET pin_hash = ? WHERE pin_hash = '' OR pin_hash IS NULL", (hash_pin("00000"),))
        conn.exec_driver_sql(
            "UPDATE users SET last_active_at = ? WHERE last_active_at IS NULL",
            (datetime.utcnow().isoformat(),),
        )
        conn.commit()


def _ensure_room_columns():
    with engine.connect() as conn:
        rows = conn.exec_driver_sql("PRAGMA table_info(rooms)").fetchall()
        columns = {row[1] for row in rows}
        if "is_private" not in columns:
            conn.exec_driver_sql("ALTER TABLE rooms ADD COLUMN is_private BOOLEAN NOT NULL DEFAULT 0")
        conn.commit()


# Create DB tables on startup (acts as auto-migration for this demo project).
Base.metadata.create_all(bind=engine)
_ensure_user_columns()
_ensure_room_columns()
ensure_default_room()

app = FastAPI(title="DrOidgram API")

# Add rate limiting middleware before CORS
app.add_middleware(RateLimitMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory="static"), name="static")
app.include_router(router)

sio = AsyncServer(async_mode="asgi", cors_allowed_origins="*")
register_socket_handlers(sio)
register_p2p_handlers(sio)

# Socket.IO + FastAPI unified ASGI app.
asgi_app = ASGIApp(socketio_server=sio, other_asgi_app=app)
