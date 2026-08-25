#!/usr/bin/env python3
"""Cookie session auth for embody_model_eval (stdlib only).

Credentials (first match wins):
  1. EMBODY_AUTH_DISABLED=1 → auth off
  2. EMBODY_AUTH_USER + EMBODY_AUTH_PASSWORD
  3. config/.auth.json  ({"username","password"} or password_hash)
  4. Auto-create config/.auth.json with a random password (printed once)

Public API paths (no cookie):
  /api/auth/status, /api/auth/login, /api/auth/logout, /api/auth/me, /api/health
"""

from __future__ import annotations

import hashlib
import json
import os
import secrets
import threading
import time
from http.cookies import SimpleCookie
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
AUTH_CONFIG_PATH = ROOT / "config" / ".auth.json"
COOKIE_NAME = "embody_session"
SESSION_TTL_SEC = 7 * 24 * 3600
PBKDF2_ITERATIONS = 120_000

_lock = threading.RLock()
_sessions: dict[str, dict[str, Any]] = {}
_state: dict[str, Any] = {
    "enabled": True,
    "username": "embody",
    "password_hash": "",
    "bootstrapped": False,
}


def _pbkdf2_hash(password: str, salt: bytes | None = None) -> str:
    if salt is None:
        salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS
    )
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def _verify_password(password: str, stored: str) -> bool:
    stored = (stored or "").strip()
    if not stored:
        return False
    if stored.startswith("pbkdf2_sha256$"):
        try:
            _, iters_s, salt_hex, digest_hex = stored.split("$", 3)
            iters = int(iters_s)
            salt = bytes.fromhex(salt_hex)
            digest = hashlib.pbkdf2_hmac(
                "sha256", password.encode("utf-8"), salt, iters
            )
            return secrets.compare_digest(digest.hex(), digest_hex)
        except Exception:
            return False
    # Legacy plaintext (only for bootstrap / example files)
    return secrets.compare_digest(password, stored)


def _env_truthy(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes", "on")


def _write_auth_file(username: str, password: str) -> None:
    AUTH_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "username": username,
        "password_hash": _pbkdf2_hash(password),
        # Keep plaintext only on first bootstrap so operator can recover; strip after read optional
        "password": password,
        "note": "Change password via EMBODY_AUTH_PASSWORD or edit this file. Do not commit.",
    }
    AUTH_CONFIG_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    try:
        os.chmod(AUTH_CONFIG_PATH, 0o600)
    except OSError:
        pass


def init_auth() -> dict[str, Any]:
    """Load or bootstrap credentials. Call once at server start."""
    with _lock:
        if _env_truthy("EMBODY_AUTH_DISABLED"):
            _state.update(enabled=False, username="", password_hash="", bootstrapped=True)
            return {"enabled": False, "username": None, "source": "disabled"}

        user = (os.environ.get("EMBODY_AUTH_USER") or "").strip() or "embody"
        password = (os.environ.get("EMBODY_AUTH_PASSWORD") or "").strip()
        source = "env"

        if not password and AUTH_CONFIG_PATH.is_file():
            try:
                raw = json.loads(AUTH_CONFIG_PATH.read_text(encoding="utf-8"))
            except Exception as e:
                raise RuntimeError(f"invalid {AUTH_CONFIG_PATH}: {e}") from e
            if isinstance(raw, dict):
                user = str(raw.get("username") or user).strip() or "embody"
                ph = str(raw.get("password_hash") or "").strip()
                pw = str(raw.get("password") or "").strip()
                if ph:
                    _state.update(
                        enabled=True, username=user, password_hash=ph, bootstrapped=True
                    )
                    return {"enabled": True, "username": user, "source": "file-hash"}
                if pw:
                    password = pw
                    source = "file"
                else:
                    raise RuntimeError(
                        f"{AUTH_CONFIG_PATH} needs password or password_hash"
                    )

        if not password:
            password = secrets.token_urlsafe(12)
            _write_auth_file(user, password)
            source = "bootstrap"
            print(
                f"[auth] created {AUTH_CONFIG_PATH.relative_to(ROOT)} "
                f"(user={user} password={password})",
                flush=True,
            )
            print(
                "[auth] set EMBODY_AUTH_PASSWORD or edit config/.auth.json to change it",
                flush=True,
            )
        elif source == "env":
            print(f"[auth] enabled via env (user={user})", flush=True)
        elif source == "file":
            # Upgrade plaintext file to hashed
            _write_auth_file(user, password)
            print(f"[auth] enabled via {AUTH_CONFIG_PATH.name} (user={user})", flush=True)

        _state.update(
            enabled=True,
            username=user,
            password_hash=_pbkdf2_hash(password),
            bootstrapped=True,
        )
        return {"enabled": True, "username": user, "source": source}


def auth_enabled() -> bool:
    return bool(_state.get("enabled"))


def public_status() -> dict[str, Any]:
    return {
        "ok": True,
        "authRequired": auth_enabled(),
        "usernameHint": _state.get("username") if auth_enabled() else None,
    }


def parse_session_cookie(cookie_header: str | None) -> str | None:
    if not cookie_header:
        return None
    jar = SimpleCookie()
    try:
        jar.load(cookie_header)
    except Exception:
        return None
    morsel = jar.get(COOKIE_NAME)
    if not morsel:
        return None
    token = (morsel.value or "").strip()
    return token or None


def _purge_expired() -> None:
    now = time.time()
    dead = [k for k, v in _sessions.items() if float(v.get("expires", 0)) < now]
    for k in dead:
        _sessions.pop(k, None)


def session_user(token: str | None) -> str | None:
    if not token:
        return None
    with _lock:
        _purge_expired()
        row = _sessions.get(token)
        if not row:
            return None
        if float(row.get("expires", 0)) < time.time():
            _sessions.pop(token, None)
            return None
        # Sliding expiry
        row["expires"] = time.time() + SESSION_TTL_SEC
        return str(row.get("username") or "")


def create_session(username: str) -> str:
    token = secrets.token_urlsafe(32)
    with _lock:
        _sessions[token] = {
            "username": username,
            "expires": time.time() + SESSION_TTL_SEC,
            "created": time.time(),
        }
    return token


def destroy_session(token: str | None) -> None:
    if not token:
        return
    with _lock:
        _sessions.pop(token, None)


def try_login(username: str, password: str) -> dict[str, Any]:
    if not auth_enabled():
        return {"ok": True, "authRequired": False, "user": None, "token": None}
    u = (username or "").strip()
    p = password or ""
    expected_user = str(_state.get("username") or "")
    ph = str(_state.get("password_hash") or "")
    if not u or not p:
        return {"ok": False, "error": "请输入用户名和密码"}
    if not secrets.compare_digest(u, expected_user) or not _verify_password(p, ph):
        return {"ok": False, "error": "用户名或密码错误"}
    token = create_session(u)
    return {"ok": True, "authRequired": True, "user": {"username": u}, "token": token}


def cookie_header_set(token: str) -> str:
    # Not Secure by default (HTTP AutoDL); SameSite=Lax for CSRF mitigation
    return (
        f"{COOKIE_NAME}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={SESSION_TTL_SEC}"
    )


def cookie_header_clear() -> str:
    return f"{COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"


def request_user(cookie_header: str | None) -> str | None:
    if not auth_enabled():
        return None
    return session_user(parse_session_cookie(cookie_header))


def is_authenticated(cookie_header: str | None) -> bool:
    if not auth_enabled():
        return True
    return request_user(cookie_header) is not None


# Paths / prefixes that stay reachable without a session when auth is on.
PUBLIC_API_PATHS = {
    "/api/health",
    "/api/auth/status",
    "/api/auth/login",
    "/api/auth/logout",
    "/api/auth/me",
}

PROTECTED_STATIC_PREFIXES = (
    "/data/",
    "/config/",
    "/agent_skills/",
    "/models/",
)


def path_requires_auth(path: str) -> bool:
    if not auth_enabled():
        return False
    if path in PUBLIC_API_PATHS:
        return False
    if path.startswith("/api/"):
        return True
    for prefix in PROTECTED_STATIC_PREFIXES:
        if path == prefix.rstrip("/") or path.startswith(prefix):
            return True
    return False
