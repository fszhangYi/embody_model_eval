#!/usr/bin/env python3
"""Multi-user account store for embody_model_eval (stdlib only).

Persists to config/users.json. Migrates legacy config/.auth.json on first load.
Roles: admin | eval | guest
"""

from __future__ import annotations

import hashlib
import json
import os
import secrets
import threading
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
USERS_CONFIG_PATH = ROOT / "config" / "users.json"
LEGACY_AUTH_PATH = ROOT / "config" / ".auth.json"
PBKDF2_ITERATIONS = 120_000

VALID_ROLES = frozenset({"admin", "eval", "guest"})
_lock = threading.RLock()
_users: list[dict[str, Any]] = []


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
    return secrets.compare_digest(password, stored)


def _load_file() -> list[dict[str, Any]]:
    if not USERS_CONFIG_PATH.is_file():
        return []
    try:
        raw = json.loads(USERS_CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception as e:
        raise RuntimeError(f"invalid {USERS_CONFIG_PATH}: {e}") from e
    if isinstance(raw, dict) and isinstance(raw.get("users"), list):
        return [u for u in raw["users"] if isinstance(u, dict)]
    if isinstance(raw, list):
        return [u for u in raw if isinstance(u, dict)]
    raise RuntimeError(f"{USERS_CONFIG_PATH} must contain a users array")


def _save_file(users: list[dict[str, Any]]) -> None:
    USERS_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {"version": 1, "users": users}
    USERS_CONFIG_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    try:
        os.chmod(USERS_CONFIG_PATH, 0o600)
    except OSError:
        pass


def _migrate_legacy_auth() -> list[dict[str, Any]]:
    if not LEGACY_AUTH_PATH.is_file():
        return []
    try:
        raw = json.loads(LEGACY_AUTH_PATH.read_text(encoding="utf-8"))
    except Exception:
        return []
    if not isinstance(raw, dict):
        return []
    username = str(raw.get("username") or "embody").strip() or "embody"
    ph = str(raw.get("password_hash") or "").strip()
    pw = str(raw.get("password") or "").strip()
    if not ph and pw:
        ph = _pbkdf2_hash(pw)
    if not ph:
        return []
    return [
        {
            "username": username,
            "role": "admin",
            "enabled": True,
            "password_hash": ph,
        }
    ]


def init_users() -> dict[str, Any]:
    """Load users.json or migrate from .auth.json."""
    global _users
    with _lock:
        if USERS_CONFIG_PATH.is_file():
            _users = _load_file()
            source = "users.json"
        else:
            migrated = _migrate_legacy_auth()
            if migrated:
                _users = migrated
                _save_file(_users)
                source = "migrated-auth"
            else:
                _users = []
                source = "empty"
        return {"count": len(_users), "source": source, "path": str(USERS_CONFIG_PATH)}


def list_users_public() -> list[dict[str, Any]]:
    """User rows without password hashes."""
    with _lock:
        out: list[dict[str, Any]] = []
        for u in _users:
            out.append(
                {
                    "username": str(u.get("username") or ""),
                    "role": str(u.get("role") or "guest"),
                    "enabled": bool(u.get("enabled", True)),
                }
            )
        return out


def find_user(username: str) -> dict[str, Any] | None:
    u = (username or "").strip()
    if not u:
        return None
    with _lock:
        for row in _users:
            if str(row.get("username") or "") == u:
                return dict(row)
    return None


def verify_login(username: str, password: str) -> dict[str, Any] | None:
    row = find_user(username)
    if not row or not row.get("enabled", True):
        return None
    ph = str(row.get("password_hash") or "")
    if not _verify_password(password or "", ph):
        return None
    return {
        "username": str(row.get("username") or ""),
        "role": str(row.get("role") or "guest"),
    }


def _normalize_role(role: str) -> str:
    r = (role or "guest").strip().lower()
    return r if r in VALID_ROLES else "guest"


def create_user(username: str, password: str, role: str = "eval") -> dict[str, Any]:
    u = (username or "").strip()
    if not u:
        raise ValueError("username required")
    if not password:
        raise ValueError("password required")
    if len(u) > 64:
        raise ValueError("username too long")
    with _lock:
        if find_user(u):
            raise ValueError("username already exists")
        row = {
            "username": u,
            "role": _normalize_role(role),
            "enabled": True,
            "password_hash": _pbkdf2_hash(password),
        }
        _users.append(row)
        _save_file(_users)
        return {"username": u, "role": row["role"], "enabled": True}


def update_user(
    username: str,
    *,
    role: str | None = None,
    enabled: bool | None = None,
    password: str | None = None,
) -> dict[str, Any]:
    u = (username or "").strip()
    with _lock:
        for i, row in enumerate(_users):
            if str(row.get("username") or "") != u:
                continue
            if role is not None:
                row["role"] = _normalize_role(role)
            if enabled is not None:
                row["enabled"] = bool(enabled)
            if password:
                row["password_hash"] = _pbkdf2_hash(password)
            _users[i] = row
            _save_file(_users)
            return {
                "username": u,
                "role": str(row.get("role") or "guest"),
                "enabled": bool(row.get("enabled", True)),
            }
    raise ValueError("user not found")


def delete_user(username: str) -> None:
    u = (username or "").strip()
    with _lock:
        before = len(_users)
        _users[:] = [row for row in _users if str(row.get("username") or "") != u]
        if len(_users) == before:
            raise ValueError("user not found")
        if not _users:
            raise ValueError("cannot delete last user")
        _save_file(_users)


def bootstrap_admin(username: str, password: str) -> dict[str, Any]:
    """Create the first admin account (idempotent if username exists)."""
    existing = find_user(username)
    if existing:
        return {
            "username": existing["username"],
            "role": str(existing.get("role") or "admin"),
            "enabled": bool(existing.get("enabled", True)),
        }
    return create_user(username, password, role="admin")


def is_admin(username: str | None) -> bool:
    if not username:
        return False
    row = find_user(username)
    return bool(row and row.get("enabled", True) and str(row.get("role")) == "admin")
