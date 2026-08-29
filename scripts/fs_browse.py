"""Safe filesystem listing for path picker (scoped to act_robot / embody roots)."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from act_pipeline_runner import ACT_ROBOT_ROOT, EMBODY_ROOT
from pi05_pipeline_runner import PI05_ROOT

ROOTS: dict[str, Path] = {
    "act": ACT_ROBOT_ROOT.resolve(),
    "embody": EMBODY_ROOT.resolve(),
    "pi05": PI05_ROOT.resolve(),
}


def _resolve_under(root: Path, path: str) -> Path:
    root = root.resolve()
    if not path or path in (".", "/"):
        return root
    target = Path(path).expanduser()
    if not target.is_absolute():
        target = root / target
    target = target.resolve()
    try:
        target.relative_to(root)
    except ValueError as e:
        raise PermissionError(f"path outside root: {path}") from e
    return target


def list_children(root_key: str, path: str = "", root_path: str | None = None) -> dict[str, Any]:
    if root_path:
        root = Path(root_path).expanduser().resolve()
        if not root.is_dir():
            raise NotADirectoryError(str(root))
        effective_key = "custom"
    elif root_key in ROOTS:
        root = ROOTS[root_key].resolve()
        effective_key = root_key
    else:
        raise ValueError(f"unknown root: {root_key}")
    target = _resolve_under(root, path)
    if not target.is_dir():
        raise NotADirectoryError(str(target))

    entries: list[dict[str, Any]] = []
    try:
        names = sorted(os.listdir(target), key=lambda s: s.lower())
    except OSError as e:
        raise PermissionError(str(e)) from e

    for name in names:
        if name.startswith(".") or name == "__pycache__":
            continue
        child = target / name
        try:
            is_dir = child.is_dir()
        except OSError:
            continue
        entries.append(
            {
                "name": name,
                "path": str(child.resolve()),
                "isDir": is_dir,
            }
        )

    entries.sort(key=lambda e: (not e["isDir"], e["name"].lower()))
    return {
        "ok": True,
        "rootKey": effective_key,
        "root": str(root),
        "path": str(target),
        "entries": entries,
    }


def browse_roots() -> dict[str, str]:
    return {k: str(v) for k, v in ROOTS.items()}


def stat_path(path: str, expect: str | None = None) -> dict[str, Any]:
    """Read-only path probe for setup health rows.

    expect:
      - dir / file: exact type
      - pytorch_base: directory containing model.safetensors, or the safetensors file itself
      - None: any existing path

    reason codes (for UI copy):
      empty | missing | not_dir | not_file | dir_ok | file_ok
      | pytorch_ok_file | pytorch_ok_dir | pytorch_missing_weights | pytorch_wrong_type
    """
    raw = (path or "").strip()
    if not raw:
        return {
            "ok": True,
            "path": "",
            "exists": False,
            "isFile": False,
            "isDir": False,
            "healthy": False,
            "expect": expect,
            "reason": "empty",
        }
    p = Path(raw).expanduser()
    try:
        p = p.resolve(strict=False)
    except OSError:
        return {
            "ok": True,
            "path": raw,
            "exists": False,
            "isFile": False,
            "isDir": False,
            "healthy": False,
            "expect": expect,
            "reason": "missing",
        }

    exists = p.exists()
    is_file = exists and p.is_file()
    is_dir = exists and p.is_dir()
    healthy = exists
    detail = None
    reason = "missing" if not exists else "ok"

    if expect == "dir":
        healthy = is_dir
        reason = "dir_ok" if is_dir else ("missing" if not exists else "not_dir")
    elif expect == "file":
        healthy = is_file
        reason = "file_ok" if is_file else ("missing" if not exists else "not_file")
    elif expect == "pytorch_base":
        if is_file and p.name == "model.safetensors":
            healthy = True
            reason = "pytorch_ok_file"
        elif is_dir:
            weights = p / "model.safetensors"
            detail = str(weights)
            if weights.is_file():
                healthy = True
                reason = "pytorch_ok_dir"
            else:
                healthy = False
                reason = "pytorch_missing_weights"
        elif not exists:
            healthy = False
            reason = "missing"
            detail = str(p / "model.safetensors")
        else:
            healthy = False
            reason = "pytorch_wrong_type"
            detail = str(p / "model.safetensors")
    elif not exists:
        reason = "missing"
    elif is_dir:
        reason = "dir_ok"
    elif is_file:
        reason = "file_ok"

    return {
        "ok": True,
        "path": str(p),
        "exists": exists,
        "isFile": is_file,
        "isDir": is_dir,
        "healthy": healthy,
        "expect": expect,
        "detail": detail,
        "reason": reason,
    }
