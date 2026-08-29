"""Inspect pi05 project: YAML configs, norm_stats, checkpoints, health checks."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import yaml

from pi05_pipeline_runner import PI05_ROOT, ACT_ROBOT_ROOT, pipeline_spec

# Prefer the trained hww tree when present (rich artifacts under artifacts/).
HWW_PI05_ROOT = Path(os.environ.get("HWW_PI05_ROOT", "/root/autodl-tmp/hww/pi05_jax_sft"))


def default_analysis_root() -> Path:
    if HWW_PI05_ROOT.is_dir() and (HWW_PI05_ROOT / "artifacts" / "checkpoints").is_dir():
        return HWW_PI05_ROOT.resolve()
    return Path(PI05_ROOT).expanduser().resolve()


try:
    yaml_load = yaml.safe_load
except Exception:  # pragma: no cover
    yaml_load = None  # type: ignore[assignment]


def _read_yaml(path: Path) -> Any:
    text = path.read_text(encoding="utf-8")
    if yaml_load is None:
        return {"_raw": text}
    return yaml_load(text)


def _safe_stat(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        st = path.stat()
        return {
            "path": str(path),
            "isDir": path.is_dir(),
            "size": st.st_size,
            "mtime": st.st_mtime,
        }
    except OSError:
        return None


def list_configs(pi05_root: str | None = None) -> dict[str, Any]:
    pi05 = Path(pi05_root or default_analysis_root()).expanduser().resolve()
    cfg_dir = pi05 / "configs"
    items: list[dict[str, Any]] = []
    if cfg_dir.is_dir():
        for p in sorted(cfg_dir.glob("*.yaml")):
            info = _safe_stat(p) or {"path": str(p)}
            brief: dict[str, Any] = {}
            try:
                data = _read_yaml(p)
                if isinstance(data, dict):
                    proj = data.get("project") or {}
                    train = data.get("training") or {}
                    model = data.get("model") or {}
                    data_cfg = data.get("data") or {}
                    brief = {
                        "projectName": proj.get("name"),
                        "expName": proj.get("exp_name"),
                        "repoId": data_cfg.get("repo_id"),
                        "batchSize": train.get("batch_size"),
                        "fsdpDevices": train.get("fsdp_devices"),
                        "numTrainSteps": train.get("num_train_steps"),
                        "paligemma": model.get("paligemma_variant"),
                        "actionExpert": model.get("action_expert_variant"),
                        "maxEpisodes": data_cfg.get("max_episodes"),
                    }
            except Exception as e:  # noqa: BLE001
                brief = {"error": str(e)}
            items.append({**info, "name": p.name, "brief": brief})
    return {"ok": True, "pi05Root": str(pi05), "configs": items}


def inspect_config(config_path: str, pi05_root: str | None = None) -> dict[str, Any]:
    pi05 = Path(pi05_root or default_analysis_root()).expanduser().resolve()
    path = Path(config_path).expanduser()
    if not path.is_absolute():
        path = pi05 / path
    path = path.resolve()
    if not path.is_file():
        raise FileNotFoundError(str(path))
    # stay under pi05 when possible
    try:
        path.relative_to(pi05)
    except ValueError:
        pass
    data = _read_yaml(path)
    text = path.read_text(encoding="utf-8")
    return {
        "ok": True,
        "path": str(path),
        "name": path.name,
        "yaml": data,
        "text": text,
    }


_VARIANT_META: dict[str, dict[str, Any]] = {
    "dummy": {
        "approxParams": "~tiny",
        "width": 64,
        "depth": 4,
        "mlpDim": 128,
        "lora": False,
        "short": "dummy",
    },
    "gemma_300m": {
        "approxParams": "~311M",
        "width": 1024,
        "depth": 18,
        "mlpDim": 4096,
        "lora": False,
        "short": "Gemma 300M",
    },
    "gemma_300m_lora": {
        "approxParams": "~311M + LoRA",
        "width": 1024,
        "depth": 18,
        "mlpDim": 4096,
        "lora": True,
        "loraRank": 32,
        "short": "Gemma 300M LoRA",
    },
    "gemma_2b": {
        "approxParams": "~2B",
        "width": 2048,
        "depth": 18,
        "mlpDim": 16384,
        "lora": False,
        "short": "Gemma 2B",
    },
    "gemma_2b_lora": {
        "approxParams": "~2B + LoRA",
        "width": 2048,
        "depth": 18,
        "mlpDim": 16384,
        "lora": True,
        "loraRank": 16,
        "short": "Gemma 2B LoRA",
    },
}


def _variant_meta(name: str | None) -> dict[str, Any]:
    key = str(name or "").strip() or "unknown"
    base = _VARIANT_META.get(key, {
        "approxParams": "—",
        "width": None,
        "depth": None,
        "mlpDim": None,
        "lora": key.endswith("_lora"),
        "short": key or "—",
    })
    return {"variant": key, **base}


def _num_list(v: Any, limit: int = 64) -> list[float]:
    if not isinstance(v, (list, tuple)):
        return []
    out: list[float] = []
    for item in v[:limit]:
        try:
            out.append(float(item))
        except (TypeError, ValueError):
            continue
    return out


def _norm_groups(raw: Any) -> list[dict[str, Any]]:
    """Flatten openpi-style {norm_stats: {state: {mean,std,...}, ...}} for charts."""
    root = raw
    if isinstance(raw, dict) and isinstance(raw.get("norm_stats"), dict):
        root = raw["norm_stats"]
    if not isinstance(root, dict):
        return []
    groups: list[dict[str, Any]] = []
    for name, block in root.items():
        if not isinstance(block, dict):
            continue
        mean = _num_list(block.get("mean"))
        std = _num_list(block.get("std"))
        q01 = _num_list(block.get("q01"))
        q99 = _num_list(block.get("q99"))
        dim = max(len(mean), len(std), len(q01), len(q99))
        if dim <= 0:
            continue
        groups.append(
            {
                "name": str(name),
                "dim": dim,
                "mean": mean,
                "std": std,
                "q01": q01,
                "q99": q99,
            }
        )
    return groups


def build_model_structure(yaml_data: Any) -> dict[str, Any] | None:
    """Derive a π0.5 Netron-ish graph from training YAML (no weight parse needed)."""
    if not isinstance(yaml_data, dict):
        return None
    model = yaml_data.get("model") or {}
    data_cfg = yaml_data.get("data") or {}
    if not isinstance(model, dict):
        model = {}
    if not isinstance(data_cfg, dict):
        data_cfg = {}

    pg = _variant_meta(model.get("paligemma_variant"))
    ex = _variant_meta(model.get("action_expert_variant"))
    horizon = model.get("action_horizon")
    max_tok = model.get("max_token_len")
    discrete = bool(model.get("discrete_state_input"))

    cams: list[str] = []
    for key, label in (
        ("chest_image_prefix", "chest"),
        ("top_image_prefix", "top"),
        ("wrist_image_prefix", "wrist"),
    ):
        if data_cfg.get(key):
            cams.append(label)
    if not cams:
        cams = ["cam×N"]

    nodes = [
        {
            "id": "images",
            "label": "Images",
            "role": "input",
            "column": 0,
            "row": 0,
            "detail": " · ".join(cams),
            "tags": cams,
        },
        {
            "id": "state",
            "label": "State",
            "role": "input",
            "column": 0,
            "row": 1,
            "detail": "discrete tokens" if discrete else "continuous",
            "tags": ["discrete" if discrete else "cont."],
        },
        {
            "id": "prompt",
            "label": "Language",
            "role": "input",
            "column": 0,
            "row": 2,
            "detail": f"≤{max_tok} tok" if max_tok is not None else "task prompt",
            "tags": ["prompt"],
        },
        {
            "id": "siglip",
            "label": "SigLIP",
            "role": "vision",
            "column": 1,
            "row": 0,
            "detail": "vision encoder",
            "tags": ["vision"],
        },
        {
            "id": "tokenize",
            "label": "Tokenize",
            "role": "embed",
            "column": 1,
            "row": 1,
            "detail": "state + text",
            "tags": ["embed"],
        },
        {
            "id": "paligemma",
            "label": "PaliGemma",
            "role": "backbone",
            "column": 2,
            "row": 0,
            "detail": f"{pg.get('short')} · w{pg.get('width')} · L{pg.get('depth')}",
            "tags": [str(pg.get("approxParams") or ""), "LoRA" if pg.get("lora") else "full"],
            "variant": pg,
        },
        {
            "id": "expert",
            "label": "Action Expert",
            "role": "expert",
            "column": 3,
            "row": 0,
            "detail": f"{ex.get('short')} · w{ex.get('width')} · L{ex.get('depth')}",
            "tags": [str(ex.get("approxParams") or ""), "LoRA" if ex.get("lora") else "full"],
            "variant": ex,
        },
        {
            "id": "actions",
            "label": "Actions",
            "role": "output",
            "column": 4,
            "row": 0,
            "detail": f"horizon {horizon}" if horizon is not None else "action chunk",
            "tags": [f"H={horizon}" if horizon is not None else "chunk"],
        },
    ]
    edges = [
        {"from": "images", "to": "siglip"},
        {"from": "state", "to": "tokenize"},
        {"from": "prompt", "to": "tokenize"},
        {"from": "siglip", "to": "paligemma"},
        {"from": "tokenize", "to": "paligemma"},
        {"from": "paligemma", "to": "expert"},
        {"from": "expert", "to": "actions"},
    ]
    return {
        "family": "pi0.5",
        "nodes": nodes,
        "edges": edges,
        "meta": {
            "actionHorizon": horizon,
            "maxTokenLen": max_tok,
            "discreteStateInput": discrete,
            "paligemma": pg,
            "actionExpert": ex,
            "repoId": data_cfg.get("repo_id"),
            "cameras": cams,
        },
    }


def _find_norm_stats(pi05: Path, assets_hint: str | None = None) -> list[dict[str, Any]]:
    roots: list[Path] = []
    if assets_hint:
        roots.append(Path(assets_hint))
    roots.append(pi05 / "artifacts" / "assets")
    # hww-style: norm_stats often lives beside exported pytorch steps
    roots.append(pi05 / "artifacts" / "checkpoints")
    found: list[dict[str, Any]] = []
    seen: set[str] = set()
    for root in roots:
        if not root.is_dir():
            continue
        for p in root.rglob("norm_stats.json"):
            key = str(p.resolve())
            if key in seen:
                continue
            seen.add(key)
            entry: dict[str, Any] = {"path": key, **(_safe_stat(p) or {})}
            try:
                raw = json.loads(p.read_text(encoding="utf-8"))
                entry["keys"] = list(raw.keys())[:40] if isinstance(raw, dict) else []
                entry["preview"] = raw if isinstance(raw, dict) else {"value": raw}
                entry["groups"] = _norm_groups(raw)
            except Exception as e:  # noqa: BLE001
                entry["error"] = str(e)
            found.append(entry)
            if len(found) >= 80:
                return found
    return found


def _step_file_brief(step_dir: Path) -> dict[str, Any]:
    """Cheap per-step inventory (no torch / no full weight load)."""
    files: dict[str, Any] = {}
    total = 0
    for name in ("model.safetensors", "optimizer.pt", "metadata.pt", "params", "train_state"):
        p = step_dir / name
        st = _safe_stat(p)
        if not st:
            continue
        files[name] = {"size": st["size"], "mtime": st.get("mtime"), "isDir": st.get("isDir")}
        if not st.get("isDir"):
            total += int(st["size"] or 0)
    assets = step_dir / "assets"
    has_assets = assets.is_dir()
    return {
        "files": files,
        "totalBytes": total,
        "hasModel": "model.safetensors" in files or "params" in files,
        "hasOptimizer": "optimizer.pt" in files,
        "hasMetadata": "metadata.pt" in files,
        "hasAssets": has_assets,
    }


def _infer_adaptation(project: str, exp: str, step_meta: dict[str, Any] | None = None) -> str:
    """Tag run as full_ft | lora | mixed from path + optional metadata variants."""
    blob = f"{project}/{exp}".lower()
    pg = ""
    ex = ""
    if isinstance(step_meta, dict):
        model = step_meta.get("model") if isinstance(step_meta.get("model"), dict) else {}
        pg = str(model.get("paligemma_variant") or "")
        ex = str(model.get("action_expert_variant") or "")
    if "lora" in blob or pg.endswith("_lora") or ex.endswith("_lora"):
        if (pg.endswith("_lora") and not ex.endswith("_lora")) or ("lora" in blob and "full" not in blob):
            return "mixed" if (pg.endswith("_lora") ^ ex.endswith("_lora")) or (
                "lora" in blob and "full_ft" not in blob
            ) else "lora"
        if pg.endswith("_lora") and ex.endswith("_lora"):
            return "lora"
        if pg.endswith("_lora") != ex.endswith("_lora"):
            return "mixed"
        return "lora"
    if "full_ft" in blob or (pg == "gemma_2b" and ex == "gemma_300m"):
        return "full_ft"
    if pg.endswith("_lora") or ex.endswith("_lora"):
        return "mixed" if (pg.endswith("_lora") != ex.endswith("_lora")) else "lora"
    return "full_ft" if pg and ex and not pg.endswith("_lora") and not ex.endswith("_lora") else "unknown"


def resolve_analysis_paths(
    pi05_root: str | None = None,
    checkpoint_path: str | None = None,
) -> dict[str, Any]:
    """Map UI selection → π0.5 root + optional checkpoints scope.

    Preferred UI path is a project/exp under ``artifacts/checkpoints/``, e.g.
    ``…/artifacts/checkpoints/pi05_act_robot_smoke``. Selecting the π0.5 repo
    root still works (scans all projects).
    """
    scope: Path | None = None
    focus_step: Path | None = None
    ckpt_target = (checkpoint_path or "").strip()
    root_arg = (pi05_root or "").strip()

    if ckpt_target:
        target = Path(ckpt_target).expanduser().resolve()
        if not target.exists():
            raise ValueError(f"路径不存在: {target}")
        parts = target.parts
        if "artifacts" in parts and "checkpoints" in parts:
            idx = parts.index("checkpoints")
            if idx == 0 or parts[idx - 1] != "artifacts":
                raise ValueError(f"无法从路径解析 artifacts/checkpoints: {target}")
            ckpt_base = Path(*parts[: idx + 1])
            pi05 = ckpt_base.parent.parent
            rest = parts[idx + 1 :]
            if len(rest) >= 1:
                scope = ckpt_base.joinpath(*rest[:2]) if len(rest) >= 2 else ckpt_base / rest[0]
            if len(rest) >= 3:
                focus_step = ckpt_base.joinpath(*rest[:3])
            elif len(rest) == 2 and (target / "model.safetensors").is_file():
                # selected a step dir that looks like a weight export
                focus_step = target
                scope = target.parent
            return {
                "pi05": pi05,
                "checkpointBase": ckpt_base,
                "scope": scope,
                "focusStep": focus_step,
                "selectedPath": target,
            }
        # Bare project name under default tree, or a π0.5 root mistaken as ckpt
        if (target / "artifacts" / "checkpoints").is_dir():
            pi05 = target
            return {
                "pi05": pi05,
                "checkpointBase": pi05 / "artifacts" / "checkpoints",
                "scope": None,
                "focusStep": None,
                "selectedPath": target,
            }
        # Treat as project/exp folder under some checkpoints root
        if target.is_dir():
            parent = target.parent
            if parent.name == "checkpoints" and parent.parent.name == "artifacts":
                return {
                    "pi05": parent.parent.parent,
                    "checkpointBase": parent,
                    "scope": target,
                    "focusStep": None,
                    "selectedPath": target,
                }
            grand = parent.parent
            if grand.name == "checkpoints" and grand.parent.name == "artifacts":
                return {
                    "pi05": grand.parent.parent,
                    "checkpointBase": grand,
                    "scope": parent,
                    "focusStep": target if any(
                        (target / n).exists() for n in ("model.safetensors", "metadata.pt", "params")
                    ) else None,
                    "selectedPath": target,
                }

    pi05 = Path(root_arg or default_analysis_root()).expanduser().resolve()
    if not pi05.is_dir():
        raise ValueError(f"不是有效目录: {pi05}")
    return {
        "pi05": pi05,
        "checkpointBase": pi05 / "artifacts" / "checkpoints",
        "scope": None,
        "focusStep": None,
        "selectedPath": pi05,
    }


def _collect_exp_run(project: Path, exp: Path) -> dict[str, Any]:
    steps: list[dict[str, Any]] = []
    meta_cfg: dict[str, Any] | None = None
    for step_dir in sorted(exp.iterdir(), key=lambda p: p.name):
        if not step_dir.is_dir():
            continue
        brief = _step_file_brief(step_dir)
        steps.append(
            {
                "name": step_dir.name,
                "path": str(step_dir),
                **(_safe_stat(step_dir) or {}),
                **brief,
            }
        )
        meta_pt = step_dir / "metadata.pt"
        if meta_cfg is None and meta_pt.is_file():
            try:
                import torch

                obj = torch.load(meta_pt, map_location="cpu", weights_only=False)
                if isinstance(obj, dict) and isinstance(obj.get("config"), dict):
                    meta_cfg = obj["config"]
            except Exception:  # noqa: BLE001
                meta_cfg = None
    latest = steps[-1] if steps else None
    adaptation = _infer_adaptation(project.name, exp.name, meta_cfg)
    return {
        "project": project.name,
        "exp": exp.name,
        "path": str(exp),
        "steps": steps[-40:],
        "stepCount": len(steps),
        "latestStep": latest["name"] if latest else None,
        "latestPath": latest["path"] if latest else None,
        "totalBytes": sum(int(s.get("totalBytes") or 0) for s in steps),
        "hasModel": any(s.get("hasModel") for s in steps),
        "adaptation": adaptation,
    }


def list_checkpoints(
    pi05_root: str | None = None,
    route: str | None = None,
    checkpoint_path: str | None = None,
) -> dict[str, Any]:
    from pi05_pipeline_runner import normalize_route, ROUTE_FULL_FT

    resolved = resolve_analysis_paths(pi05_root, checkpoint_path)
    pi05: Path = resolved["pi05"]
    base: Path = resolved["checkpointBase"]
    scope: Path | None = resolved["scope"]
    route = normalize_route(route)
    runs: list[dict[str, Any]] = []

    def add_project(project: Path) -> None:
        if not project.is_dir():
            return
        for exp in sorted(project.iterdir()):
            if exp.is_dir():
                runs.append(_collect_exp_run(project, exp))

    if base.is_dir():
        if scope is None:
            for project in sorted(base.iterdir()):
                add_project(project)
        elif scope.parent == base:
            # project directory
            add_project(scope)
        elif scope.parent.parent == base:
            # exp directory
            runs.append(_collect_exp_run(scope.parent, scope))
        elif scope.is_dir() and scope.parent.is_dir():
            # step or odd nesting: use parent as exp if under base
            try:
                scope.relative_to(base)
            except ValueError:
                pass
            else:
                if scope.parent.parent == base:
                    runs.append(_collect_exp_run(scope.parent.parent, scope.parent))
                elif scope.parent == base:
                    add_project(scope)

    def sort_key(r: dict[str, Any]) -> tuple:
        adapt = r.get("adaptation") or ""
        prefer = 0 if (route == ROUTE_FULL_FT and adapt == "full_ft") or (
            route != ROUTE_FULL_FT and adapt in ("lora", "mixed")
        ) else 1
        return (prefer, -int(r.get("totalBytes") or 0), r["project"], r["exp"])

    runs.sort(key=sort_key)
    return {
        "ok": True,
        "checkpointRoot": str(base),
        "scope": str(scope) if scope else None,
        "selectedPath": str(resolved["selectedPath"]),
        "pi05Root": str(pi05),
        "runs": runs,
        "route": route,
    }


def list_prepare_summaries(pi05_root: str | None = None) -> list[dict[str, Any]]:
    pi05 = Path(pi05_root or default_analysis_root()).expanduser().resolve()
    prep = pi05 / "artifacts" / "prepare"
    out: list[dict[str, Any]] = []
    if not prep.is_dir():
        return out
    for p in sorted(prep.glob("*.json")):
        entry: dict[str, Any] = {"path": str(p), "name": p.name, **(_safe_stat(p) or {})}
        try:
            raw = json.loads(p.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                entry["summary"] = {
                    "repoId": raw.get("repo_id"),
                    "episodes": raw.get("episodes"),
                    "frames": raw.get("frames"),
                    "datasetFormat": raw.get("dataset_format"),
                    "skipped": len(raw.get("skipped") or []) if isinstance(raw.get("skipped"), list) else raw.get("skipped"),
                    "configPath": raw.get("config_path"),
                }
                entry["preview"] = {
                    k: raw[k]
                    for k in (
                        "repo_id",
                        "episodes",
                        "frames",
                        "dataset_format",
                        "episode_start_index",
                        "episode_end_index",
                    )
                    if k in raw
                }
        except Exception as e:  # noqa: BLE001
            entry["error"] = str(e)
        out.append(entry)
    return out


def _read_safetensors_header(path: Path) -> dict[str, Any]:
    import struct

    with path.open("rb") as f:
        header_len = struct.unpack("<Q", f.read(8))[0]
        if header_len <= 0 or header_len > 256 * 1024 * 1024:
            raise ValueError(f"invalid safetensors header length: {header_len}")
        raw = f.read(header_len)
    meta = json.loads(raw.decode("utf-8"))
    if not isinstance(meta, dict):
        raise ValueError("safetensors header is not an object")
    return meta


def _tensor_elements(shape: Any) -> int:
    if not isinstance(shape, (list, tuple)) or not shape:
        return 0
    n = 1
    for d in shape:
        try:
            n *= int(d)
        except (TypeError, ValueError):
            return 0
    return n


def _module_prefix(key: str) -> str:
    if key.startswith("paligemma_with_expert.paligemma"):
        return "paligemma"
    if key.startswith("paligemma_with_expert.gemma_expert"):
        return "gemma_expert"
    if key.startswith("action_in_proj") or key.startswith("action_out_proj"):
        return "action_proj"
    if key.startswith("time_mlp"):
        return "time_mlp"
    if key.startswith("state_proj"):
        return "state_proj"
    parts = key.split(".")
    return parts[0] if parts else key


_MODULE_LABELS = {
    "paligemma": "PaliGemma",
    "gemma_expert": "Action Expert",
    "action_proj": "Action Proj",
    "time_mlp": "Time MLP",
    "state_proj": "State Proj",
}


def _weight_structure_from_safetensors(meta: dict[str, Any]) -> dict[str, Any]:
    keys = [k for k in meta.keys() if k != "__metadata__"]
    modules: dict[str, dict[str, Any]] = {}
    total_elems = 0
    dtype_counts: dict[str, int] = {}
    for key in keys:
        info = meta.get(key) or {}
        if not isinstance(info, dict):
            continue
        shape = info.get("shape") or []
        elems = _tensor_elements(shape)
        total_elems += elems
        dtype = str(info.get("dtype") or "?")
        dtype_counts[dtype] = dtype_counts.get(dtype, 0) + 1
        pref = _module_prefix(key)
        bucket = modules.setdefault(
            pref,
            {"id": pref, "label": _MODULE_LABELS.get(pref, pref), "tensors": 0, "elements": 0, "children": {}},
        )
        bucket["tensors"] += 1
        bucket["elements"] += elems
        # one more level for paligemma vision vs language when possible
        child_id = None
        if pref == "paligemma":
            if "vision_tower" in key or "vision_model" in key:
                child_id = "vision"
            elif "language_model" in key or "lm_head" in key:
                child_id = "language"
            elif "multi_modal" in key:
                child_id = "mm_projector"
        elif pref == "gemma_expert":
            if "layers." in key:
                child_id = "transformer"
            else:
                child_id = "other"
        if child_id:
            ch = bucket["children"].setdefault(
                child_id, {"id": child_id, "label": child_id, "tensors": 0, "elements": 0}
            )
            ch["tensors"] += 1
            ch["elements"] += elems

    module_list = []
    for mid, m in modules.items():
        children = sorted(m["children"].values(), key=lambda c: -c["elements"])
        module_list.append(
            {
                "id": mid,
                "label": m["label"],
                "params": m["tensors"],
                "elements": m["elements"],
                "children": children,
            }
        )
    module_list.sort(key=lambda m: -m["elements"])

    # Netron-ish graph columns from real modules
    nodes = []
    edges = []
    col_map = {
        "paligemma": 0,
        "gemma_expert": 1,
        "state_proj": 1,
        "time_mlp": 2,
        "action_proj": 3,
    }
    for m in module_list:
        nodes.append(
            {
                "id": m["id"],
                "label": m["label"],
                "column": col_map.get(m["id"], 2),
                "row": 0,
                "params": m["params"],
                "elements": m["elements"],
                "children": m.get("children") or [],
            }
        )
    id_set = {n["id"] for n in nodes}
    if "paligemma" in id_set and "gemma_expert" in id_set:
        edges.append({"from": "paligemma", "to": "gemma_expert"})
    if "gemma_expert" in id_set and "action_proj" in id_set:
        edges.append({"from": "gemma_expert", "to": "action_proj"})
    if "time_mlp" in id_set and "gemma_expert" in id_set:
        edges.append({"from": "time_mlp", "to": "gemma_expert"})

    return {
        "tensorCount": len(keys),
        "totalElements": total_elems,
        "approxParams": f"{total_elems / 1e9:.2f}B" if total_elems >= 1e9 else f"{total_elems / 1e6:.1f}M",
        "dtypeBreakdown": [{"dtype": k, "count": v} for k, v in sorted(dtype_counts.items())],
        "modules": module_list,
        "modelGraph": {"nodes": nodes, "edges": edges},
        "sampleKeys": keys[:24],
    }


def _summarize_train_config(cfg: Any) -> dict[str, Any]:
    if not isinstance(cfg, dict):
        return {}
    model = cfg.get("model") if isinstance(cfg.get("model"), dict) else {}
    data = cfg.get("data") if isinstance(cfg.get("data"), dict) else {}
    lr = cfg.get("lr_schedule") if isinstance(cfg.get("lr_schedule"), dict) else {}
    opt = cfg.get("optimizer") if isinstance(cfg.get("optimizer"), dict) else {}
    policy = cfg.get("policy_metadata") if isinstance(cfg.get("policy_metadata"), dict) else {}
    return {
        "name": cfg.get("name"),
        "projectName": cfg.get("project_name"),
        "expName": cfg.get("exp_name"),
        "batchSize": cfg.get("batch_size"),
        "numTrainSteps": cfg.get("num_train_steps"),
        "numWorkers": cfg.get("num_workers"),
        "repoId": data.get("repo_id"),
        "taskName": data.get("task_name"),
        "paligemma": model.get("paligemma_variant"),
        "actionExpert": model.get("action_expert_variant"),
        "actionDim": model.get("action_dim"),
        "actionHorizon": model.get("action_horizon"),
        "maxTokenLen": model.get("max_token_len"),
        "discreteStateInput": model.get("discrete_state_input"),
        "dtype": model.get("dtype"),
        "peakLr": lr.get("peak_lr"),
        "decayLr": lr.get("decay_lr"),
        "warmupSteps": lr.get("warmup_steps"),
        "clipGrad": opt.get("clip_gradient_norm"),
        "cameras": list((policy.get("camera_mapping") or {}).keys())
        if isinstance(policy.get("camera_mapping"), dict)
        else [],
        "stateSemantics": policy.get("state_semantics"),
        "actionSemantics": policy.get("action_semantics"),
    }


def _yamlish_from_train_config(cfg: Any) -> dict[str, Any] | None:
    """Adapt openpi TrainConfig snapshot into build_model_structure input shape."""
    if not isinstance(cfg, dict):
        return None
    model = cfg.get("model") if isinstance(cfg.get("model"), dict) else {}
    data = cfg.get("data") if isinstance(cfg.get("data"), dict) else {}
    policy = cfg.get("policy_metadata") if isinstance(cfg.get("policy_metadata"), dict) else {}
    cams = []
    mapping = policy.get("camera_mapping") if isinstance(policy.get("camera_mapping"), dict) else {}
    for _src, dst in mapping.items():
        label = str(dst).replace("_image", "").replace("image", "") or str(_src)
        cams.append(label)
    data_out = {
        "repo_id": data.get("repo_id"),
        "chest_image_prefix": "chest" if any("chest" in c or "base" in c for c in cams) else None,
        "top_image_prefix": "top" if any("top" in c or "right" in c for c in cams) else None,
        "wrist_image_prefix": "wrist" if any("wrist" in c or "left" in c for c in cams) else None,
    }
    # if mapping empty, leave prefixes unset → structure falls back to cam×N
    if not cams:
        data_out = {"repo_id": data.get("repo_id")}
    else:
        # force camera list via prefixes for structure tags
        data_out = {
            "repo_id": data.get("repo_id"),
            "chest_image_prefix": next((c for c in cams if "chest" in c or "base" in c), cams[0]),
            "top_image_prefix": next((c for c in cams if "top" in c), cams[1] if len(cams) > 1 else None),
            "wrist_image_prefix": next((c for c in cams if "wrist" in c), cams[-1] if cams else None),
        }
    return {
        "model": {
            "action_horizon": model.get("action_horizon"),
            "max_token_len": model.get("max_token_len"),
            "discrete_state_input": model.get("discrete_state_input"),
            "paligemma_variant": model.get("paligemma_variant"),
            "action_expert_variant": model.get("action_expert_variant"),
        },
        "data": data_out,
    }


def inspect_checkpoint(step_path: str, pi05_root: str | None = None) -> dict[str, Any]:
    """Deep-inspect one exported step under artifacts/checkpoints/.../<step>/."""
    pi05 = Path(pi05_root or default_analysis_root()).expanduser().resolve()
    path = Path(step_path).expanduser().resolve()
    if not path.is_dir():
        raise FileNotFoundError(str(path))
    brief = _step_file_brief(path)
    result: dict[str, Any] = {
        "ok": True,
        "path": str(path),
        "name": path.name,
        "pi05Root": str(pi05),
        **brief,
    }

    meta_path = path / "metadata.pt"
    if meta_path.is_file():
        try:
            import torch

            md = torch.load(str(meta_path), map_location="cpu", weights_only=False)
            if isinstance(md, dict):
                cfg = md.get("config")
                result["metadata"] = {
                    "globalStep": md.get("global_step"),
                    "timestamp": md.get("timestamp"),
                    "config": _summarize_train_config(cfg),
                    "rawConfigKeys": list(cfg.keys()) if isinstance(cfg, dict) else [],
                }
                yamlish = _yamlish_from_train_config(cfg)
                if yamlish:
                    result["modelStructure"] = build_model_structure(yamlish)
        except Exception as e:  # noqa: BLE001
            result["metadataError"] = str(e)

    weights = path / "model.safetensors"
    if weights.is_file():
        try:
            header = _read_safetensors_header(weights)
            result["weights"] = _weight_structure_from_safetensors(header)
            # Prefer real module graph for structure card when available
            if result.get("weights", {}).get("modelGraph"):
                result["weightGraph"] = result["weights"]["modelGraph"]
        except Exception as e:  # noqa: BLE001
            result["weightsError"] = str(e)

    # norm_stats bundled in step assets
    step_norms = []
    assets = path / "assets"
    if assets.is_dir():
        for p in assets.rglob("norm_stats.json"):
            try:
                raw = json.loads(p.read_text(encoding="utf-8"))
                step_norms.append(
                    {
                        "path": str(p),
                        "groups": _norm_groups(raw),
                        "keys": list(raw.keys())[:20] if isinstance(raw, dict) else [],
                    }
                )
            except Exception as e:  # noqa: BLE001
                step_norms.append({"path": str(p), "error": str(e)})
    result["normStats"] = step_norms
    return result


def analyze(
    pi05_root: str | None = None,
    config_path: str | None = None,
    checkpoint_path: str | None = None,
    route: str | None = None,
) -> dict[str, Any]:
    from pi05_pipeline_runner import normalize_route, ROUTE_FULL_FT

    try:
        resolved = resolve_analysis_paths(pi05_root, checkpoint_path)
    except ValueError as e:
        return {"ok": False, "error": str(e)}

    pi05: Path = resolved["pi05"]
    act = ACT_ROBOT_ROOT
    route_n = normalize_route(route)
    focus_step: Path | None = resolved.get("focusStep")
    try:
        spec = pipeline_spec(str(pi05), str(act), route_n)
    except ValueError as e:
        return {"ok": False, "error": str(e)}

    assets_hint = None
    config_info = None
    yaml_data: Any = None
    if config_path:
        config_info = inspect_config(config_path, str(pi05))
        yaml_data = config_info.get("yaml")
        if isinstance(yaml_data, dict):
            paths = yaml_data.get("paths") or {}
            assets = paths.get("assets_base_dir")
            if assets:
                ap = Path(str(assets))
                if not ap.is_absolute():
                    ap = pi05 / ap
                assets_hint = str(ap)
    elif (pi05 / "configs").is_dir():
        preferred_names = (
            ["pi05_tonglu0630_full_ft_two_view.yaml", "pi05_tonglu0630_mlu_example_terminal_two_camera.yaml"]
            if route_n == ROUTE_FULL_FT
            else ["pi05_act_robot_smoke.yaml", "pi05_lora_example.yaml"]
        )
        picked = None
        for name in preferred_names:
            cand = pi05 / "configs" / name
            if cand.is_file():
                picked = cand
                break
        candidates = ([picked] if picked else []) + sorted((pi05 / "configs").glob("*.yaml"))
        seen: set[str] = set()
        for p in candidates:
            if p is None or str(p) in seen:
                continue
            seen.add(str(p))
            try:
                yaml_data = _read_yaml(p)
                config_info = {
                    "ok": True,
                    "path": str(p),
                    "name": p.name,
                    "yaml": yaml_data,
                    "text": p.read_text(encoding="utf-8"),
                }
                break
            except Exception:  # noqa: BLE001
                continue

    ckpt_info = None
    # Prefer explicit step; otherwise leave deep inspect to a later step pick
    # unless a step path with weights was selected.
    if focus_step and focus_step.is_dir():
        try:
            ckpt_info = inspect_checkpoint(str(focus_step), str(pi05))
        except Exception as e:  # noqa: BLE001
            ckpt_info = {"ok": False, "error": str(e), "path": str(focus_step)}
    elif checkpoint_path:
        cand = Path(str(checkpoint_path)).expanduser().resolve()
        if cand.is_dir() and (
            (cand / "model.safetensors").is_file()
            or (cand / "metadata.pt").is_file()
            or (cand / "params").exists()
        ):
            try:
                ckpt_info = inspect_checkpoint(str(cand), str(pi05))
            except Exception as e:  # noqa: BLE001
                ckpt_info = {"ok": False, "error": str(e), "path": str(cand)}

    if isinstance(ckpt_info, dict) and ckpt_info.get("modelStructure"):
        model_structure = ckpt_info["modelStructure"]
    else:
        model_structure = build_model_structure(yaml_data)

    health_hint = (
        "Tl 全参主线：需预训练权重（pi05_base_pytorch） + ≥8×~80GB GPU；batch=256。"
        if route_n == ROUTE_FULL_FT
        else "LoRA 冒烟辅线：单卡 32GB 用双 LoRA + 小 batch；HF/tmp 缓存须在数据盘。"
    )

    ckpt_listing = list_checkpoints(str(pi05), route_n, checkpoint_path or str(resolved["selectedPath"]))

    return {
        "ok": True,
        "pi05Root": str(pi05),
        "route": route_n,
        "healthHint": health_hint,
        "defaultRoot": str(default_analysis_root()),
        "selectedPath": str(resolved["selectedPath"]),
        "checkpointScope": str(resolved["scope"]) if resolved.get("scope") else None,
        "checks": spec.get("checks") or {},
        "paths": {
            **(spec.get("paths") or {}),
            "artifactsCheckpoints": str(pi05 / "artifacts" / "checkpoints"),
            "artifactsAssets": str(pi05 / "artifacts" / "assets"),
            "artifactsPrepare": str(pi05 / "artifacts" / "prepare"),
        },
        "configs": list_configs(str(pi05)).get("configs") or [],
        "checkpoints": ckpt_listing,
        "normStats": _find_norm_stats(pi05, assets_hint),
        "prepare": list_prepare_summaries(str(pi05)),
        "config": config_info,
        "modelStructure": model_structure,
        "checkpoint": ckpt_info,
        "presets": {
            "hww": str(HWW_PI05_ROOT),
            "pi05": str(Path(PI05_ROOT).expanduser().resolve()),
        },
    }
