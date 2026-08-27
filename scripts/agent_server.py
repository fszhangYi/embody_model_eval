#!/usr/bin/env python3
"""Static file server + Agent Chat / Skills API (stdlib only).

Endpoints:
  GET    /api/health
  GET    /api/auth/status
  GET    /api/auth/me
  POST   /api/auth/login
  POST   /api/auth/logout
  GET    /api/users
  POST   /api/users
  PUT    /api/users/<username>
  DELETE /api/users/<username>
  GET    /api/skills
  GET    /api/skills/<id>
  GET    /api/skills/sources
  POST   /api/skills/import
  DELETE /api/skills/<id>
  GET    /api/agent/config
  PUT    /api/agent/config
  POST   /api/agent/probe
  GET    /api/pipeline/graphs
  PUT    /api/pipeline/graphs
  GET    /api/act-pipeline/spec
  GET    /api/act-pipeline/parse-args?scriptPath=
  GET    /api/act-pipeline/link
  POST   /api/act-pipeline/link
  DELETE /api/act-pipeline/link
  GET    /api/act-pipeline/jobs
  GET    /api/act-pipeline/jobs/<id>
  POST   /api/act-pipeline/jobs/<id>/cancel
  DELETE /api/act-pipeline/jobs/<id>
  POST   /api/act-pipeline/run
  GET    /api/fs/children?root=act|embody&path=<abs>&rootPath=<override>
  GET    /api/fs/roots
  GET    /api/sensors/arm
  GET    /api/sensors/arm/kin
  GET    /api/sensors/arm/kin/overview
  GET    /api/sensors/arm/kin/build-guide
  POST   /api/sensors/arm/test
  POST   /api/sensors/arm/refresh
  POST   /api/sensors/arm/fk
  POST   /api/chat   (body: message, skillIds?, history?, config?)
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import traceback
import urllib.error
import urllib.request
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))
from act_pipeline_runner import (
    cancel_job,
    create_act_link,
    delete_job,
    get_job,
    link_status,
    list_jobs,
    parse_script_args,
    pipeline_spec,
    remove_act_link,
    start_job,
)
from arm_kinematics import (
    compute_fk,
    get_arm_build_guide,
    get_arm_kin_bundle,
    get_arm_kin_overview,
    get_arm_status,
    refresh_arm,
    test_arm,
)
from auth import (
    active_usernames,
    auth_enabled,
    cookie_header_clear,
    cookie_header_set,
    destroy_session,
    init_auth,
    is_authenticated,
    parse_session_cookie,
    path_requires_auth,
    public_status,
    request_profile,
    request_user,
    try_login,
)
from users import (
    create_user,
    delete_user,
    is_admin,
    list_users_public,
    update_user,
)
from fs_browse import browse_roots, list_children

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
SKILLS_DIR = ROOT / "agent_skills"
CONFIG_PATH = SKILLS_DIR / ".agent_config.json"
PIPELINE_GRAPHS_PATH = ROOT / "config" / "pipeline_graphs.json"
SKILL_NAME_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$")
PIPELINE_GRAPH_KEY_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$")

SOURCE_ROOTS = {
    "user": Path.home() / ".cursor" / "skills",
    "builtin": Path.home() / ".cursor" / "skills-cursor",
}
CURSOR_HOME = Path.home() / ".cursor"
CURSOR_SCAN_SKIP = {".run", "chats", "projects", "ai-tracking", "sandbox-policies"}

# Served from repo root (not Vite dist). /assets/ is special: Vite bundles
# live in dist/assets/; repo assets/ holds favicons only.
STATIC_ROOT_PREFIXES = (
    "/data/",
    "/config/",
    "/models/",
    "/vendor/",
    "/agent_skills/",
    "/css/",
    "/js/",
    "/legacy/",
)


def _json_bytes(obj: Any, status: int = 200) -> tuple[int, bytes, str]:
    raw = json.dumps(obj, ensure_ascii=False, indent=2).encode("utf-8")
    return status, raw, "application/json; charset=utf-8"


def _read_json_body(handler: SimpleHTTPRequestHandler) -> Any:
    length = int(handler.headers.get("Content-Length") or 0)
    if length <= 0:
        return {}
    raw = handler.rfile.read(length)
    if not raw:
        return {}
    return json.loads(raw.decode("utf-8"))


def _parse_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    if not text.startswith("---"):
        return {}, text
    end = text.find("\n---", 3)
    if end < 0:
        return {}, text
    block = text[3:end].strip()
    body = text[end + 4 :].lstrip("\n")
    meta: dict[str, Any] = {}
    key = None
    buf: list[str] = []
    for line in block.splitlines():
        if key and (line.startswith("  ") or line.startswith("\t") or line.startswith(">-") or line.startswith("|")):
            buf.append(line.strip())
            continue
        if key and buf:
            meta[key] = " ".join(x for x in buf if x).strip()
            key, buf = None, []
        if ":" not in line:
            continue
        k, v = line.split(":", 1)
        k, v = k.strip(), v.strip()
        if v in (">-", ">", "|"):
            key, buf = k, []
        else:
            meta[k] = v.strip("\"'")
    if key and buf:
        meta[key] = " ".join(x for x in buf if x).strip()
    return meta, body


def list_skills_in(root: Path) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    if not root.is_dir():
        return out
    for child in sorted(root.iterdir()):
        if not child.is_dir() or child.name.startswith("."):
            continue
        skill_md = child / "SKILL.md"
        if not skill_md.is_file():
            continue
        text = skill_md.read_text(encoding="utf-8", errors="replace")
        meta, _ = _parse_frontmatter(text)
        out.append(
            {
                "id": child.name,
                "name": meta.get("name") or child.name,
                "description": meta.get("description") or "",
                "path": str(child),
                "bytes": skill_md.stat().st_size,
            }
        )
    return out


def scan_cursor_home_skills() -> list[dict[str, Any]]:
    """Recursively find SKILL.md under ~/.cursor (skills / skills-cursor / …)."""
    out: list[dict[str, Any]] = []
    if not CURSOR_HOME.is_dir():
        return out
    seen: set[str] = set()
    for skill_md in sorted(CURSOR_HOME.rglob("SKILL.md")):
        folder = skill_md.parent
        try:
            rel = folder.relative_to(CURSOR_HOME)
        except ValueError:
            continue
        parts = rel.parts
        if not parts:
            continue
        if parts[0] in CURSOR_SCAN_SKIP or any(p.startswith(".") for p in parts):
            continue
        if not SKILL_NAME_RE.match(folder.name):
            continue
        key = str(folder.resolve())
        if key in seen:
            continue
        seen.add(key)
        try:
            text = skill_md.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        meta, _ = _parse_frontmatter(text)
        group = parts[0]
        out.append(
            {
                "id": folder.name,
                "name": meta.get("name") or folder.name,
                "description": meta.get("description") or "",
                "path": str(folder),
                "rel": str(rel).replace("\\", "/"),
                "group": group,
                "bytes": skill_md.stat().st_size,
            }
        )
    out.sort(key=lambda s: (s.get("group") or "", s.get("id") or ""))
    return out


def load_skill_bundle(skill_id: str) -> dict[str, Any] | None:
    if not SKILL_NAME_RE.match(skill_id):
        return None
    folder = SKILLS_DIR / skill_id
    skill_md = folder / "SKILL.md"
    if not skill_md.is_file():
        return None
    text = skill_md.read_text(encoding="utf-8", errors="replace")
    meta, body = _parse_frontmatter(text)
    return {
        "id": skill_id,
        "name": meta.get("name") or skill_id,
        "description": meta.get("description") or "",
        "content": text,
        "body": body,
    }


def default_config() -> dict[str, Any]:
    return {
        "mode": "dry_run",
        "baseUrl": "",
        "apiKey": "",
        "model": "composer-2.5",
        "path": "/chat/completions",
        "systemPrompt": "你是评测助手。优先遵循用户选中的 Agent Skill 指令。",
    }


def load_config() -> dict[str, Any]:
    cfg = default_config()
    if CONFIG_PATH.is_file():
        try:
            stored = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
            if isinstance(stored, dict):
                cfg.update({k: stored[k] for k in cfg if k in stored})
        except Exception:
            pass
    env_key = os.environ.get("CURSOR_API_KEY") or os.environ.get("AGENT_API_KEY")
    if env_key and not cfg.get("apiKey"):
        cfg["apiKey"] = env_key
    return cfg


def save_config(patch: dict[str, Any]) -> dict[str, Any]:
    cfg = load_config()
    for k in default_config():
        if k in patch:
            cfg[k] = patch[k]
    SKILLS_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return cfg


def load_pipeline_graphs() -> dict[str, Any]:
    if not PIPELINE_GRAPHS_PATH.is_file():
        return {}
    try:
        data = json.loads(PIPELINE_GRAPHS_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}
    if not isinstance(data, dict):
        return {}
    graphs = data.get("graphs", data)
    return graphs if isinstance(graphs, dict) else {}


def _validate_pipeline_graph(g: Any) -> dict[str, Any] | None:
    if not isinstance(g, dict):
        return None
    nodes = g.get("nodes")
    if not isinstance(nodes, list) or not nodes:
        return None
    for n in nodes:
        if not isinstance(n, dict) or not n.get("id"):
            return None
    edges = g.get("edges")
    if edges is not None and not isinstance(edges, list):
        return None
    return g


def save_pipeline_graphs(graphs: dict[str, Any]) -> dict[str, Any]:
    cleaned: dict[str, Any] = {}
    for key, g in graphs.items():
        if not isinstance(key, str) or not PIPELINE_GRAPH_KEY_RE.match(key):
            continue
        if key in ("train", "infer"):
            continue
        valid = _validate_pipeline_graph(g)
        if valid is None:
            continue
        cleaned[key] = valid
    PIPELINE_GRAPHS_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": 1,
        "updated_at": __import__("datetime").datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "graphs": cleaned,
    }
    PIPELINE_GRAPHS_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return cleaned


def public_config(cfg: dict[str, Any]) -> dict[str, Any]:
    out = dict(cfg)
    key = out.get("apiKey") or ""
    out["apiKeySet"] = bool(key)
    out["apiKeyMasked"] = (key[:4] + "…" + key[-4:]) if len(key) > 8 else ("***" if key else "")
    out.pop("apiKey", None)
    return out


def normalize_history(raw: Any) -> list[dict[str, str]]:
    """Prior user/assistant turns only (no system). Caps length for safety."""
    if not isinstance(raw, list):
        return []
    out: list[dict[str, str]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "").strip()
        content = str(item.get("content") or "").strip()
        if role not in ("user", "assistant") or not content:
            continue
        out.append({"role": role, "content": content})
    return out[-40:]


def build_messages(
    user_message: str,
    skills: list[dict[str, Any]],
    system_prompt: str,
    history: list[dict[str, str]] | None = None,
) -> list[dict[str, str]]:
    parts = [system_prompt.strip() or "You are a helpful assistant."]
    if skills:
        parts.append("\n\n# Active Agent Skills\n")
        parts.append("The following skills are selected by the user. Follow them closely.\n")
        for s in skills:
            parts.append(f"\n## Skill: {s['name']} (`{s['id']}`)\n")
            if s.get("description"):
                parts.append(f"Description: {s['description']}\n")
            parts.append("\n```skill\n")
            parts.append(s["content"])
            parts.append("\n```\n")
    messages: list[dict[str, str]] = [{"role": "system", "content": "".join(parts)}]
    for turn in history or []:
        messages.append({"role": turn["role"], "content": turn["content"]})
    messages.append({"role": "user", "content": user_message})
    return messages


def http_json(url: str, payload: dict[str, Any], api_key: str, timeout: float = 120.0) -> dict[str, Any]:
    data = json.dumps(payload).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "embody-model-eval-agent-chat/1.0",
    }
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            try:
                parsed = json.loads(body)
            except json.JSONDecodeError:
                parsed = {"raw": body}
            return {"ok": True, "status": resp.status, "data": parsed}
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(err_body)
        except json.JSONDecodeError:
            parsed = {"raw": err_body}
        return {"ok": False, "status": e.code, "error": parsed, "message": str(e)}
    except Exception as e:
        return {"ok": False, "status": 0, "message": str(e)}


def http_get(url: str, api_key: str, timeout: float = 8.0) -> dict[str, Any]:
    headers = {
        "Accept": "application/json",
        "User-Agent": "embody-model-eval-agent-chat/1.0",
    }
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            try:
                parsed = json.loads(body)
            except json.JSONDecodeError:
                parsed = {"raw": body}
            return {"ok": True, "status": resp.status, "data": parsed}
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(err_body)
        except json.JSONDecodeError:
            parsed = {"raw": err_body}
        return {"ok": False, "status": e.code, "error": parsed, "message": str(e)}
    except Exception as e:
        return {"ok": False, "status": 0, "message": str(e)}


def merge_config_override(cfg: dict[str, Any], override: dict[str, Any] | None) -> dict[str, Any]:
    merged = dict(cfg)
    if not isinstance(override, dict):
        return merged
    for k in default_config():
        if k not in override or override[k] is None:
            continue
        if k == "apiKey" and override[k] == "":
            continue
        merged[k] = override[k]
    return merged


def probe_agent(cfg: dict[str, Any]) -> dict[str, Any]:
    """Lightweight connectivity check for the configured agent mode."""
    mode = (cfg.get("mode") or "dry_run").strip()
    api_key = cfg.get("apiKey") or ""

    if mode == "dry_run":
        return {
            "ok": True,
            "mode": mode,
            "message": "dry_run：本地回执模式，无需外部 Agent",
        }

    if mode == "cursor_sdk":
        try:
            import cursor_sdk  # type: ignore  # noqa: F401
        except Exception as e:
            return {"ok": False, "mode": mode, "message": f"cursor_sdk 不可用：{e}"}
        key = api_key or os.environ.get("CURSOR_API_KEY") or ""
        if not key:
            return {
                "ok": False,
                "mode": mode,
                "message": "缺少 CURSOR_API_KEY 或 API Key",
            }
        return {
            "ok": True,
            "mode": mode,
            "message": "cursor_sdk 已安装，API Key 已配置",
        }

    if mode == "dsh_agent":
        base = (
            (cfg.get("baseUrl") or "").strip()
            or os.environ.get("DSH_BRIDGE_URL", "").strip()
            or "http://127.0.0.1:8790"
        ).rstrip("/")
        health_url = base + "/health"
        resp = http_get(health_url, api_key, timeout=8.0)
        if not resp.get("ok"):
            msg = resp.get("message") or "无法连接 embody_dsh_agent bridge"
            return {
                "ok": False,
                "mode": mode,
                "message": msg,
                "url": health_url,
                "httpStatus": resp.get("status"),
                "detail": resp.get("error") or resp,
            }
        data = resp.get("data")
        if isinstance(data, dict) and data.get("ok") is False:
            return {
                "ok": False,
                "mode": mode,
                "message": data.get("error") or "dsh bridge /health 返回失败",
                "url": health_url,
                "httpStatus": resp.get("status"),
                "detail": data,
            }
        return {
            "ok": True,
            "mode": mode,
            "message": f"dsh bridge 可达 ({health_url})",
            "url": health_url,
            "httpStatus": resp.get("status"),
        }

    base = (cfg.get("baseUrl") or "").rstrip("/")
    if not base:
        return {"ok": False, "mode": mode, "message": "请填写 Base URL"}

    path = (cfg.get("path") or "").strip()
    if not path.startswith("/"):
        path = "/" + path if path else ""

    if mode == "openai":
        probe_url = base + "/models"
        resp = http_get(probe_url, api_key, timeout=12.0)
        status = resp.get("status") or 0
        if resp.get("ok"):
            return {
                "ok": True,
                "mode": mode,
                "message": f"OpenAI 兼容端点可达 ({probe_url})",
                "url": probe_url,
                "httpStatus": status,
            }
        if status in (401, 403):
            return {
                "ok": True,
                "mode": mode,
                "message": f"端点可达但鉴权失败 (HTTP {status})，请检查 API Key",
                "url": probe_url,
                "httpStatus": status,
                "authWarning": True,
            }
        msg = resp.get("message") or f"无法连接 {probe_url}"
        return {
            "ok": False,
            "mode": mode,
            "message": msg,
            "url": probe_url,
            "httpStatus": status,
            "detail": resp.get("error") or resp,
        }

    if mode == "webhook":
        webhook_path = path or "/"
        probe_url = base + webhook_path
        resp = http_json(
            probe_url,
            {"probe": True, "message": "connectivity check"},
            api_key,
            timeout=12.0,
        )
        status = resp.get("status") or 0
        if resp.get("ok") or status in (400, 401, 403, 404, 405, 422):
            note = ""
            if status in (401, 403):
                note = "（鉴权可能未通过，但网络可达）"
            elif not resp.get("ok"):
                note = f"（HTTP {status}，但网络可达）"
            return {
                "ok": True,
                "mode": mode,
                "message": f"Webhook 可达{note} ({probe_url})",
                "url": probe_url,
                "httpStatus": status,
            }
        msg = resp.get("message") or f"无法连接 {probe_url}"
        return {
            "ok": False,
            "mode": mode,
            "message": msg,
            "url": probe_url,
            "httpStatus": status,
            "detail": resp.get("error") or resp,
        }

    return {"ok": False, "mode": mode, "message": f"未知模式: {mode}"}


def try_dsh_agent(
    message: str,
    skills: list[dict[str, Any]],
    cfg: dict[str, Any],
    history: list[dict[str, str]],
    session_id: str | None = None,
) -> dict[str, Any]:
    """Forward chat to embody_dsh_agent bridge (DeepSeek Harness + skills/tools)."""
    base = (
        (cfg.get("baseUrl") or "").strip()
        or os.environ.get("DSH_BRIDGE_URL", "").strip()
        or "http://127.0.0.1:8790"
    ).rstrip("/")
    path = (cfg.get("path") or "/agent/run").strip() or "/agent/run"
    if not path.startswith("/"):
        path = "/" + path
    url = base + path

    parts: list[str] = []
    if skills:
        names = ", ".join(s.get("id") or s.get("name") or "?" for s in skills)
        parts.append(
            "用户在评测 Chat 中勾选了以下 Skill（若 harness 侧有同名 skill，请按需调用）："
            + names
        )
    if history:
        hist_lines = []
        for h in history[-12:]:
            hist_lines.append(f"{h.get('role')}: {h.get('content')}")
        parts.append("对话上文：\n" + "\n".join(hist_lines))
    parts.append("当前用户诉求：\n" + message)
    full_message = "\n\n".join(parts)

    payload_body: dict[str, Any] = {"message": full_message}
    if session_id:
        payload_body["sessionId"] = session_id

    # Agent 循环可能较久
    resp = http_json(url, payload_body, cfg.get("apiKey") or "", timeout=300.0)
    if not resp.get("ok"):
        return {
            "ok": False,
            "message": resp.get("message")
            or "无法连接 embody_dsh_agent 桥接（请确认 bridge_server 已在本机启动）",
            "status": resp.get("status"),
            "url": url,
            "error": resp.get("error"),
        }
    data = resp.get("data")
    if not isinstance(data, dict):
        return {"ok": False, "message": "dsh bridge 返回非 JSON 对象", "url": url, "raw": data}
    if data.get("ok") is False:
        return {
            "ok": False,
            "message": data.get("error") or "dsh_agent 执行失败",
            "url": url,
            "status": resp.get("status"),
            "raw": data,
        }
    reply = data.get("reply")
    if reply is None:
        reply = extract_openai_text(data)
    return {
        "ok": True,
        "reply": str(reply or ""),
        "sessionId": data.get("sessionId") or session_id,
        "finishReason": data.get("finishReason"),
        "url": url,
        "status": resp.get("status"),
        "raw": data,
    }


def extract_openai_text(data: Any) -> str:
    if not isinstance(data, dict):
        return str(data)
    choices = data.get("choices")
    if isinstance(choices, list) and choices:
        msg = choices[0].get("message") or {}
        content = msg.get("content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            bits = []
            for block in content:
                if isinstance(block, dict) and block.get("type") == "text":
                    bits.append(block.get("text") or "")
            return "".join(bits)
    if isinstance(data.get("result"), str):
        return data["result"]
    if isinstance(data.get("reply"), str):
        return data["reply"]
    if isinstance(data.get("output"), str):
        return data["output"]
    return json.dumps(data, ensure_ascii=False, indent=2)


def try_cursor_sdk(
    message: str,
    skills: list[dict[str, Any]],
    cfg: dict[str, Any],
    history: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    """Optional path: local Cursor SDK with staged project skills."""
    try:
        from cursor_sdk import Agent, AgentOptions, LocalAgentOptions  # type: ignore
    except Exception as e:
        return {"ok": False, "message": f"cursor_sdk unavailable: {e}"}

    # Stage selected skills into a temp project skills tree under agent_skills/.run
    run_root = SKILLS_DIR / ".run"
    proj_skills = run_root / ".cursor" / "skills"
    if run_root.exists():
        shutil.rmtree(run_root)
    proj_skills.mkdir(parents=True, exist_ok=True)
    for s in skills:
        dest = proj_skills / s["id"]
        dest.mkdir(parents=True, exist_ok=True)
        (dest / "SKILL.md").write_text(s["content"], encoding="utf-8")

    api_key = cfg.get("apiKey") or os.environ.get("CURSOR_API_KEY") or ""
    model = cfg.get("model") or "composer-2.5"
    sdk_message = message
    if history:
        transcript = "\n".join(f"{h['role']}: {h['content']}" for h in history)
        sdk_message = (
            "Previous conversation (for context):\n"
            f"{transcript}\n\n"
            f"Current user message:\n{message}"
        )
    try:
        with Agent.create(
            AgentOptions(
                api_key=api_key,
                model=model,
                local=LocalAgentOptions(
                    cwd=str(run_root),
                    setting_sources=["project"],
                ),
            )
        ) as agent:
            run = agent.send(sdk_message)
            result = run.wait()
            text = getattr(result, "result", None) or getattr(result, "text", None)
            if text is None and hasattr(run, "text"):
                try:
                    text = run.text()
                except Exception:
                    text = str(result)
            return {
                "ok": getattr(result, "status", "finished") != "error",
                "reply": text if isinstance(text, str) else str(result),
                "status": getattr(result, "status", "unknown"),
                "agentId": getattr(agent, "agent_id", None),
                "runId": getattr(result, "id", None),
            }
    except Exception as e:
        return {"ok": False, "message": str(e), "trace": traceback.format_exc()[-1200:]}


def run_chat(payload: dict[str, Any]) -> dict[str, Any]:
    message = (payload.get("message") or "").strip()
    if not message:
        return {"ok": False, "error": "message is required"}

    skill_ids = payload.get("skillIds") or payload.get("skills") or []
    if not isinstance(skill_ids, list):
        return {"ok": False, "error": "skillIds must be a list"}

    history = normalize_history(payload.get("history"))

    skills: list[dict[str, Any]] = []
    missing: list[str] = []
    for sid in skill_ids:
        sid = str(sid)
        bundle = load_skill_bundle(sid)
        if not bundle:
            missing.append(sid)
        else:
            skills.append(bundle)
    if missing:
        return {"ok": False, "error": f"unknown skills: {', '.join(missing)}"}

    cfg = merge_config_override(load_config(), payload.get("config"))

    messages = build_messages(message, skills, cfg.get("systemPrompt") or "", history)
    mode = (cfg.get("mode") or "dry_run").strip()

    meta = {
        "mode": mode,
        "model": cfg.get("model"),
        "skillIds": [s["id"] for s in skills],
        "skillCount": len(skills),
        "historyTurns": len(history),
    }

    if mode == "dry_run":
        receipt = {
            "note": "dry_run：未调用外部 Agent，仅返回打包后的诉求与 skill。",
            "messages": messages,
            "history": history,
        }
        hist_note = f"历史轮次: {len(history)}\n" if history else ""
        return {
            "ok": True,
            "reply": (
                "【Dry-run 回执】\n"
                f"模式: dry_run\n模型: {cfg.get('model')}\n"
                f"已选 skill: {', '.join(s['id'] for s in skills) or '(无)'}\n"
                f"{hist_note}\n"
                "—— System（摘要）——\n"
                + messages[0]["content"][:1800]
                + ("…\n" if len(messages[0]["content"]) > 1800 else "\n")
                + "\n—— 完整 messages 角色序列 ——\n"
                + " → ".join(m["role"] for m in messages)
                + "\n\n—— 本轮 User ——\n"
                + message
            ),
            "receipt": receipt,
            "meta": meta,
        }

    if mode == "cursor_sdk":
        out = try_cursor_sdk(message, skills, cfg, history)
        if not out.get("ok"):
            return {"ok": False, "error": out.get("message") or "cursor_sdk failed", "detail": out, "meta": meta}
        return {
            "ok": True,
            "reply": out.get("reply") or "",
            "meta": {**meta, "agentId": out.get("agentId"), "runId": out.get("runId"), "status": out.get("status")},
        }

    if mode == "dsh_agent":
        # embody_dsh_agent HTTP bridge（默认本机 8790；可由 baseUrl/path 覆盖）
        out = try_dsh_agent(
            message,
            skills,
            cfg,
            history,
            session_id=str(payload.get("sessionId") or "").strip() or None,
        )
        if not out.get("ok"):
            return {
                "ok": False,
                "error": out.get("message") or "dsh_agent failed",
                "detail": out,
                "meta": {**meta, "url": out.get("url"), "httpStatus": out.get("status")},
            }
        return {
            "ok": True,
            "reply": out.get("reply") or "",
            "meta": {
                **meta,
                "url": out.get("url"),
                "httpStatus": out.get("status"),
                "sessionId": out.get("sessionId"),
                "finishReason": out.get("finishReason"),
            },
            "raw": out.get("raw"),
        }

    base = (cfg.get("baseUrl") or "").rstrip("/")
    if not base:
        return {"ok": False, "error": "baseUrl is required for http modes", "meta": meta}

    if mode == "openai":
        path = cfg.get("path") or "/chat/completions"
        if not path.startswith("/"):
            path = "/" + path
        url = base + path
        payload_body = {
            "model": cfg.get("model") or "gpt-4o-mini",
            "messages": messages,
            "temperature": 0.2,
        }
        resp = http_json(url, payload_body, cfg.get("apiKey") or "")
        if not resp.get("ok"):
            return {
                "ok": False,
                "error": resp.get("message") or "HTTP error",
                "detail": resp.get("error") or resp,
                "meta": {**meta, "url": url, "httpStatus": resp.get("status")},
            }
        return {
            "ok": True,
            "reply": extract_openai_text(resp.get("data")),
            "meta": {**meta, "url": url, "httpStatus": resp.get("status")},
            "raw": resp.get("data"),
        }

    if mode == "webhook":
        path = cfg.get("path") or ""
        url = base + (path if path.startswith("/") else ("/" + path if path else ""))
        payload_body = {
            "message": message,
            "history": history,
            "skills": [{"id": s["id"], "name": s["name"], "description": s["description"], "content": s["content"]} for s in skills],
            "messages": messages,
            "model": cfg.get("model"),
        }
        resp = http_json(url, payload_body, cfg.get("apiKey") or "")
        if not resp.get("ok"):
            return {
                "ok": False,
                "error": resp.get("message") or "webhook error",
                "detail": resp.get("error") or resp,
                "meta": {**meta, "url": url, "httpStatus": resp.get("status")},
            }
        data = resp.get("data")
        reply = extract_openai_text(data) if isinstance(data, dict) else str(data)
        return {"ok": True, "reply": reply, "meta": {**meta, "url": url}, "raw": data}

    return {"ok": False, "error": f"unknown mode: {mode}", "meta": meta}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def translate_path(self, path: str) -> str:
        """Serve repo-root static assets; SPA from dist/ when built."""
        rel = unquote(urlparse(path).path)
        if rel == "/":
            rel = "/index.html"

        for prefix in STATIC_ROOT_PREFIXES:
            if rel == prefix.rstrip("/") or rel.startswith(prefix):
                return str(ROOT / rel.lstrip("/"))

        if DIST.is_dir() and (DIST / "index.html").is_file():
            candidate = DIST / rel.lstrip("/")
            if candidate.is_file():
                return str(candidate)

        # Favicons etc. in repo assets/ (Vite hashed chunks are in dist/assets/)
        if rel.startswith("/assets/"):
            root_asset = ROOT / rel.lstrip("/")
            if root_asset.is_file():
                return str(root_asset)

        if DIST.is_dir() and (DIST / "index.html").is_file():
            suffix = Path(rel).suffix.lower()
            if suffix in ("", ".html"):
                return str(DIST / "index.html")
            return str(DIST / rel.lstrip("/"))

        return str(ROOT / rel.lstrip("/"))

    def log_message(self, fmt: str, *args: Any) -> None:
        print("[%s] %s" % (self.log_date_time_string(), fmt % args), file=sys.stderr)

    def end_headers(self) -> None:  # noqa: N802
        # Dev-friendly: avoid stale ES modules / HTML after deploys
        try:
            path = unquote(urlparse(self.path).path).lower()
            if path.endswith((".js", ".mjs", ".css", ".html", ".json", ".svg")):
                self.send_header("Cache-Control", "no-store")
        except Exception:
            pass
        super().end_headers()

    def _send(
        self,
        status: int,
        body: bytes,
        content_type: str,
        *,
        set_cookie: str | None = None,
    ) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        if set_cookie:
            self.send_header("Set-Cookie", set_cookie)
        self.end_headers()
        self.wfile.write(body)

    def _send_json(
        self,
        obj: Any,
        status: int = 200,
        *,
        set_cookie: str | None = None,
    ) -> None:
        st, raw, ctype = _json_bytes(obj, status)
        self._send(st, raw, ctype, set_cookie=set_cookie)

    def _unauthorized(self) -> None:
        self._send_json(
            {
                "ok": False,
                "error": "unauthorized",
                "authRequired": True,
                "loginPath": "/login",
            },
            HTTPStatus.UNAUTHORIZED,
        )

    def _require_auth(self, path: str) -> bool:
        """Return True if the request may proceed."""
        if not path_requires_auth(path):
            return True
        if is_authenticated(self.headers.get("Cookie")):
            return True
        self._unauthorized()
        return False

    def _require_admin(self) -> dict[str, Any] | None:
        if not auth_enabled():
            self._send_json({"ok": False, "error": "auth disabled"}, HTTPStatus.BAD_REQUEST)
            return None
        prof = request_profile(self.headers.get("Cookie"))
        if not prof:
            self._unauthorized()
            return None
        if not is_admin(prof.get("username")):
            self._send_json({"ok": False, "error": "admin required"}, HTTPStatus.FORBIDDEN)
            return None
        return prof

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._send(204, b"", "text/plain")

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        if path == "/api/health":
            self._send_json(
                {
                    "ok": True,
                    "skillsDir": str(SKILLS_DIR),
                    "root": str(ROOT),
                    "authRequired": auth_enabled(),
                }
            )
            return
        if path == "/api/auth/status":
            self._send_json(public_status())
            return
        if path == "/api/auth/me":
            if not auth_enabled():
                self._send_json(
                    {"ok": True, "authRequired": False, "authenticated": True, "user": None}
                )
                return
            user = request_user(self.headers.get("Cookie"))
            if not user:
                self._send_json(
                    {
                        "ok": True,
                        "authRequired": True,
                        "authenticated": False,
                        "user": None,
                    }
                )
                return
            prof = request_profile(self.headers.get("Cookie")) or {"username": user, "role": "guest"}
            self._send_json(
                {
                    "ok": True,
                    "authRequired": True,
                    "authenticated": True,
                    "user": {
                        "username": prof.get("username") or user,
                        "role": prof.get("role") or "guest",
                    },
                }
            )
            return
        if not self._require_auth(path):
            return
        if path == "/api/users":
            if not self._require_admin():
                return
            active = active_usernames()
            rows = [
                {**u, "online": u.get("username") in active}
                for u in list_users_public()
            ]
            self._send_json({"ok": True, "users": rows})
            return
        if path == "/api/skills":
            SKILLS_DIR.mkdir(parents=True, exist_ok=True)
            self._send_json({"ok": True, "skills": list_skills_in(SKILLS_DIR)})
            return
        if path == "/api/skills/sources":
            scanned = scan_cursor_home_skills()
            # Keep legacy keys for older clients; primary list is `scanned`.
            sources = {}
            for key, root in SOURCE_ROOTS.items():
                sources[key] = {
                    "root": str(root),
                    "label": "用户 skills" if key == "user" else "Cursor 内置",
                    "skills": list_skills_in(root),
                }
            self._send_json(
                {
                    "ok": True,
                    "cursorHome": str(CURSOR_HOME),
                    "scanned": scanned,
                    "sources": sources,
                }
            )
            return
        m_skill = re.match(r"^/api/skills/([^/]+)$", path)
        if m_skill:
            sid = m_skill.group(1)
            bundle = load_skill_bundle(sid)
            if not bundle:
                self._send_json({"ok": False, "error": "not found"}, HTTPStatus.NOT_FOUND)
                return
            self._send_json({"ok": True, "skill": bundle})
            return
        if path == "/api/agent/config":
            self._send_json({"ok": True, "config": public_config(load_config())})
            return
        if path == "/api/pipeline/graphs":
            graphs = load_pipeline_graphs()
            self._send_json(
                {
                    "ok": True,
                    "path": str(PIPELINE_GRAPHS_PATH.relative_to(ROOT)),
                    "graphs": graphs,
                    "keys": sorted(graphs.keys()),
                }
            )
            return
        if path == "/api/fs/roots":
            self._send_json({"ok": True, "roots": browse_roots()})
            return
        if path == "/api/fs/children":
            qs = parse_qs(parsed.query)
            root_key = (qs.get("root") or ["act"])[0]
            target = (qs.get("path") or [""])[0]
            root_path = (qs.get("rootPath") or [""])[0] or None
            try:
                self._send_json(list_children(str(root_key), str(target), root_path))
            except (ValueError, PermissionError, NotADirectoryError) as e:
                self._send_json({"ok": False, "error": str(e)}, HTTPStatus.BAD_REQUEST)
            return
        if path == "/api/act-pipeline/spec":
            qs = parse_qs(parsed.query)
            act_root = (qs.get("actRoot") or [None])[0]
            embody_root = (qs.get("embodyRoot") or [None])[0]
            try:
                self._send_json(pipeline_spec(act_root, embody_root))
            except ValueError as e:
                self._send_json({"ok": False, "error": str(e)}, HTTPStatus.BAD_REQUEST)
            return
        if path == "/api/act-pipeline/parse-args":
            qs = parse_qs(parsed.query)
            script_path = (qs.get("scriptPath") or qs.get("path") or [""])[0]
            if not script_path:
                self._send_json({"ok": False, "error": "scriptPath required"}, HTTPStatus.BAD_REQUEST)
                return
            try:
                self._send_json(parse_script_args(str(script_path)))
            except (FileNotFoundError, ValueError) as e:
                self._send_json({"ok": False, "error": str(e)}, HTTPStatus.BAD_REQUEST)
            return
        if path == "/api/act-pipeline/link":
            qs = parse_qs(parsed.query)
            embody_root = (qs.get("embodyRoot") or [""])[0]
            act_root = (qs.get("actRoot") or [None])[0]
            if not embody_root:
                self._send_json({"ok": False, "error": "embodyRoot required"}, HTTPStatus.BAD_REQUEST)
                return
            try:
                self._send_json(link_status(embody_root, act_root))
            except ValueError as e:
                self._send_json({"ok": False, "error": str(e)}, HTTPStatus.BAD_REQUEST)
            return
        if path == "/api/act-pipeline/jobs":
            self._send_json({"ok": True, "jobs": list_jobs()})
            return
        m_act_job = re.match(r"^/api/act-pipeline/jobs/([^/]+)$", path)
        if m_act_job:
            job = get_job(m_act_job.group(1))
            if not job:
                self._send_json({"ok": False, "error": "not found"}, HTTPStatus.NOT_FOUND)
                return
            self._send_json({"ok": True, "job": job})
            return
        if path == "/api/sensors/arm":
            try:
                self._send_json(get_arm_status(run_check=False))
            except Exception as e:  # noqa: BLE001
                self._send_json(
                    {"ok": False, "available": False, "status": "error", "error": str(e)},
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                )
            return
        if path == "/api/sensors/arm/kin":
            try:
                self._send_json(get_arm_kin_bundle())
            except Exception as e:  # noqa: BLE001
                self._send_json({"ok": False, "error": str(e)}, HTTPStatus.INTERNAL_SERVER_ERROR)
            return
        if path == "/api/sensors/arm/kin/overview":
            try:
                self._send_json(get_arm_kin_overview())
            except Exception as e:  # noqa: BLE001
                self._send_json({"ok": False, "error": str(e)}, HTTPStatus.INTERNAL_SERVER_ERROR)
            return
        if path == "/api/sensors/arm/kin/build-guide":
            try:
                self._send_json(get_arm_build_guide())
            except Exception as e:  # noqa: BLE001
                self._send_json({"ok": False, "error": str(e)}, HTTPStatus.INTERNAL_SERVER_ERROR)
            return
        if path.startswith("/api/"):
            self._send_json({"ok": False, "error": "not found"}, HTTPStatus.NOT_FOUND)
            return
        super().do_GET()

    def do_PUT(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        if not self._require_auth(path):
            return
        m_user = re.match(r"^/api/users/([^/]+)$", path)
        if m_user:
            admin = self._require_admin()
            if not admin:
                return
            target = unquote(m_user.group(1))
            try:
                body = _read_json_body(self)
            except Exception as e:
                self._send_json({"ok": False, "error": f"invalid JSON: {e}"}, HTTPStatus.BAD_REQUEST)
                return
            if not isinstance(body, dict):
                self._send_json({"ok": False, "error": "body must be object"}, HTTPStatus.BAD_REQUEST)
                return
            try:
                row = update_user(
                    target,
                    role=str(body["role"]) if "role" in body else None,
                    enabled=bool(body["enabled"]) if "enabled" in body else None,
                    password=str(body["password"]) if body.get("password") else None,
                )
                self._send_json({"ok": True, "user": row})
            except ValueError as e:
                self._send_json({"ok": False, "error": str(e)}, HTTPStatus.BAD_REQUEST)
            return
        if path == "/api/agent/config":
            try:
                body = _read_json_body(self)
                cfg = save_config(body if isinstance(body, dict) else {})
                self._send_json({"ok": True, "config": public_config(cfg)})
            except Exception as e:
                self._send_json({"ok": False, "error": str(e)}, HTTPStatus.BAD_REQUEST)
            return
        if path == "/api/pipeline/graphs":
            try:
                body = _read_json_body(self)
                raw = body.get("graphs") if isinstance(body, dict) else None
                if not isinstance(raw, dict):
                    self._send_json(
                        {"ok": False, "error": "body.graphs must be an object"},
                        HTTPStatus.BAD_REQUEST,
                    )
                    return
                saved = save_pipeline_graphs(raw)
                self._send_json(
                    {
                        "ok": True,
                        "path": str(PIPELINE_GRAPHS_PATH.relative_to(ROOT)),
                        "keys": sorted(saved.keys()),
                        "n": len(saved),
                    }
                )
            except Exception as e:
                self._send_json({"ok": False, "error": str(e)}, HTTPStatus.BAD_REQUEST)
            return
        self._send_json({"ok": False, "error": "not found"}, HTTPStatus.NOT_FOUND)

    def do_DELETE(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        if not self._require_auth(path):
            return
        if not self._require_auth(path):
            return
        m_user_del = re.match(r"^/api/users/([^/]+)$", path)
        if m_user_del:
            admin = self._require_admin()
            if not admin:
                return
            target = unquote(m_user_del.group(1))
            if target == admin.get("username"):
                self._send_json({"ok": False, "error": "cannot delete yourself"}, HTTPStatus.BAD_REQUEST)
                return
            try:
                delete_user(target)
                self._send_json({"ok": True, "deleted": target})
            except ValueError as e:
                self._send_json({"ok": False, "error": str(e)}, HTTPStatus.BAD_REQUEST)
            return
        m = re.match(r"^/api/skills/([^/]+)$", path)
        if m:
            sid = m.group(1)
            if not SKILL_NAME_RE.match(sid):
                self._send_json({"ok": False, "error": "invalid skill id"}, HTTPStatus.BAD_REQUEST)
                return
            target = SKILLS_DIR / sid
            if not target.is_dir():
                self._send_json({"ok": False, "error": "not found"}, HTTPStatus.NOT_FOUND)
                return
            shutil.rmtree(target)
            self._send_json({"ok": True, "deleted": sid})
            return
        if path == "/api/act-pipeline/link":
            qs = parse_qs(parsed.query)
            embody_root = (qs.get("embodyRoot") or [""])[0]
            if not embody_root:
                self._send_json({"ok": False, "error": "embodyRoot required"}, HTTPStatus.BAD_REQUEST)
                return
            try:
                self._send_json(remove_act_link(embody_root))
            except ValueError as e:
                self._send_json({"ok": False, "error": str(e)}, HTTPStatus.BAD_REQUEST)
            return
        m_act_job_del = re.match(r"^/api/act-pipeline/jobs/([^/]+)$", path)
        if m_act_job_del:
            if not delete_job(m_act_job_del.group(1)):
                self._send_json({"ok": False, "error": "not found"}, HTTPStatus.NOT_FOUND)
                return
            self._send_json({"ok": True, "deleted": m_act_job_del.group(1)})
            return
        self._send_json({"ok": False, "error": "not found"}, HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        try:
            body = _read_json_body(self)
        except Exception as e:
            self._send_json({"ok": False, "error": f"invalid JSON: {e}"}, HTTPStatus.BAD_REQUEST)
            return

        if path == "/api/auth/login":
            if not isinstance(body, dict):
                self._send_json({"ok": False, "error": "body must be object"}, HTTPStatus.BAD_REQUEST)
                return
            result = try_login(
                str(body.get("username") or body.get("user") or ""),
                str(body.get("password") or ""),
            )
            if not result.get("ok"):
                self._send_json(result, HTTPStatus.UNAUTHORIZED)
                return
            token = result.get("token")
            payload = {
                "ok": True,
                "authRequired": result.get("authRequired", auth_enabled()),
                "user": result.get("user"),
            }
            self._send_json(
                payload,
                set_cookie=cookie_header_set(str(token)) if token else None,
            )
            return

        if path == "/api/auth/logout":
            token = parse_session_cookie(self.headers.get("Cookie"))
            destroy_session(token)
            self._send_json(
                {"ok": True, "authenticated": False},
                set_cookie=cookie_header_clear(),
            )
            return

        if not self._require_auth(path):
            return

        if path == "/api/users":
            admin = self._require_admin()
            if not admin:
                return
            if not isinstance(body, dict):
                self._send_json({"ok": False, "error": "body must be object"}, HTTPStatus.BAD_REQUEST)
                return
            try:
                row = create_user(
                    str(body.get("username") or ""),
                    str(body.get("password") or ""),
                    str(body.get("role") or "eval"),
                )
                self._send_json({"ok": True, "user": row})
            except ValueError as e:
                self._send_json({"ok": False, "error": str(e)}, HTTPStatus.BAD_REQUEST)
            return

        if path == "/api/skills/import":
            source = (body.get("source") if isinstance(body, dict) else None) or ""
            skill_id = (body.get("id") if isinstance(body, dict) else None) or ""
            rel = (body.get("rel") if isinstance(body, dict) else None) or ""

            src: Path | None = None
            if rel:
                # Import by path relative to ~/.cursor (from scan_cursor_home_skills).
                cand = (CURSOR_HOME / str(rel)).resolve()
                try:
                    cand.relative_to(CURSOR_HOME.resolve())
                except ValueError:
                    self._send_json({"ok": False, "error": "rel outside ~/.cursor"}, HTTPStatus.BAD_REQUEST)
                    return
                src = cand
                skill_id = src.name
            elif source in SOURCE_ROOTS and skill_id:
                if not SKILL_NAME_RE.match(skill_id):
                    self._send_json({"ok": False, "error": "invalid skill id"}, HTTPStatus.BAD_REQUEST)
                    return
                src = SOURCE_ROOTS[source] / skill_id
            else:
                self._send_json(
                    {"ok": False, "error": "provide rel (under ~/.cursor) or source+id"},
                    HTTPStatus.BAD_REQUEST,
                )
                return

            if not SKILL_NAME_RE.match(skill_id):
                self._send_json({"ok": False, "error": "invalid skill id"}, HTTPStatus.BAD_REQUEST)
                return
            if not src or not (src / "SKILL.md").is_file():
                self._send_json({"ok": False, "error": f"skill not found: {src}"}, HTTPStatus.NOT_FOUND)
                return
            SKILLS_DIR.mkdir(parents=True, exist_ok=True)
            dest = SKILLS_DIR / skill_id
            if dest.exists():
                shutil.rmtree(dest)
            shutil.copytree(src, dest)
            self._send_json({"ok": True, "skill": load_skill_bundle(skill_id)})
            return

        if path == "/api/chat":
            result = run_chat(body if isinstance(body, dict) else {})
            status = 200 if result.get("ok") else HTTPStatus.BAD_REQUEST
            self._send_json(result, status)
            return

        if path == "/api/agent/probe":
            payload = body if isinstance(body, dict) else {}
            cfg = merge_config_override(load_config(), payload.get("config"))
            result = probe_agent(cfg)
            status = 200 if result.get("ok") else HTTPStatus.BAD_GATEWAY
            self._send_json(result, status)
            return

        if path == "/api/act-pipeline/link":
            if not isinstance(body, dict):
                self._send_json({"ok": False, "error": "body must be object"}, HTTPStatus.BAD_REQUEST)
                return
            embody_root = body.get("embodyRoot") or body.get("embody_root") or ""
            act_root = body.get("actRoot") or body.get("act_root") or ""
            if not embody_root or not act_root:
                self._send_json(
                    {"ok": False, "error": "embodyRoot and actRoot required"},
                    HTTPStatus.BAD_REQUEST,
                )
                return
            try:
                self._send_json(create_act_link(str(embody_root), str(act_root)))
            except ValueError as e:
                self._send_json({"ok": False, "error": str(e)}, HTTPStatus.BAD_REQUEST)
            return

        if path == "/api/act-pipeline/run":
            if not isinstance(body, dict):
                self._send_json({"ok": False, "error": "body must be object"}, HTTPStatus.BAD_REQUEST)
                return
            step_id = body.get("stepId") or body.get("step_id")
            if not step_id:
                self._send_json({"ok": False, "error": "stepId required"}, HTTPStatus.BAD_REQUEST)
                return
            try:
                params = body.get("params") if isinstance(body.get("params"), dict) else {}
                act_root = body.get("actRoot") or body.get("act_root")
                embody_root = body.get("embodyRoot") or body.get("embody_root")
                job = start_job(
                    str(step_id),
                    params,
                    act_root=str(act_root) if act_root else None,
                    embody_root=str(embody_root) if embody_root else None,
                )
                self._send_json({"ok": True, "job": job})
            except Exception as e:
                self._send_json({"ok": False, "error": str(e)}, HTTPStatus.BAD_REQUEST)
            return

        m_cancel = re.match(r"^/api/act-pipeline/jobs/([^/]+)/cancel$", path)
        if m_cancel:
            try:
                job = cancel_job(m_cancel.group(1))
                if not job:
                    self._send_json({"ok": False, "error": "not found"}, HTTPStatus.NOT_FOUND)
                    return
                self._send_json({"ok": True, "job": job})
            except ValueError as e:
                self._send_json({"ok": False, "error": str(e)}, HTTPStatus.BAD_REQUEST)
            return

        if path == "/api/sensors/arm/test":
            try:
                self._send_json(test_arm())
            except Exception as e:  # noqa: BLE001
                self._send_json({"ok": False, "error": str(e)}, HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        if path == "/api/sensors/arm/refresh":
            try:
                self._send_json(refresh_arm(body if isinstance(body, dict) else {}))
            except Exception as e:  # noqa: BLE001
                self._send_json({"ok": False, "error": str(e)}, HTTPStatus.BAD_REQUEST)
            return

        if path == "/api/sensors/arm/fk":
            if not isinstance(body, dict):
                self._send_json({"ok": False, "error": "body must be object"}, HTTPStatus.BAD_REQUEST)
                return
            try:
                result = compute_fk(body)
                status = 200 if result.get("ok") else HTTPStatus.BAD_REQUEST
                self._send_json(result, status)
            except Exception as e:  # noqa: BLE001
                self._send_json({"ok": False, "error": str(e)}, HTTPStatus.BAD_REQUEST)
            return

        self._send_json({"ok": False, "error": "not found"}, HTTPStatus.NOT_FOUND)


def main() -> None:
    parser = argparse.ArgumentParser(description="Embody eval static + agent chat server")
    parser.add_argument("port", nargs="?", type=int, default=6006)
    parser.add_argument("--bind", default="0.0.0.0")
    args = parser.parse_args()
    SKILLS_DIR.mkdir(parents=True, exist_ok=True)
    auth_info = init_auth()
    refresh = ROOT / "scripts" / "refresh_data_index.py"
    if refresh.is_file():
        subprocess.run([sys.executable, str(refresh)], check=False)
    httpd = ThreadingHTTPServer((args.bind, args.port), Handler)
    print(f"Serving {ROOT} on http://{args.bind}:{args.port}/ (agent API enabled)", flush=True)
    if auth_info.get("enabled"):
        print(
            f"Auth: ON (user={auth_info.get('username')}, source={auth_info.get('source')}) → /login",
            flush=True,
        )
    else:
        print("Auth: OFF (EMBODY_AUTH_DISABLED)", flush=True)
    if (DIST / "index.html").is_file():
        print(f"React SPA: {DIST}", flush=True)
    else:
        print(f"React SPA: not built (run: cd frontend && npm run build)", flush=True)
    print(f"Skills dir: {SKILLS_DIR}", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nbye", flush=True)


if __name__ == "__main__":
    main()
