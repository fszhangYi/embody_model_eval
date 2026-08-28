"""Embodied dataset format detection, inspection, and conversion (API stubs).

Lineage taxonomy (11 categories, Plan B):
  Open X-Embodiment, OpenVLA, Octo, RT-X, LeRobot, robomimic, ACT, ALOHA,
  OpenPI (π0), Diffusion Policy (Zarr), and other.
"""

from __future__ import annotations

import base64
import json
import mimetypes
import os
from pathlib import Path
from typing import Any

MAX_INSPECT_CHARS = 12_000
MAX_FIELD_CHARS = 2_048
IMAGE_PREVIEW_MAX_BYTES = 5 * 1024 * 1024

LINEAGE_FORMATS = (
    "open_x",
    "openvla",
    "octo",
    "rtx",
    "lerobot",
    "robomimic",
    "act",
    "aloha",
    "openpi",
    "diffusion_policy",
    "other",
)

HDF5_LINEAGES = ("robomimic", "act", "aloha")
RLDS_LINEAGES = ("open_x", "openvla", "octo", "rtx")
LEROBOT_LINEAGES = ("lerobot", "openpi")
CLASSIC_LINEAGES = HDF5_LINEAGES + RLDS_LINEAGES + LEROBOT_LINEAGES + ("diffusion_policy",)

FORMAT_CATALOG: list[dict[str, Any]] = [
    {
        "id": "open_x",
        "labelKey": "datasetConverter.format.open_x",
        "extensions": ["tfrecord"],
        "containers": ["dir"],
        "descKey": "datasetConverter.format.open_xDesc",
    },
    {
        "id": "openvla",
        "labelKey": "datasetConverter.format.openvla",
        "extensions": ["tfrecord"],
        "containers": ["dir"],
        "descKey": "datasetConverter.format.openvlaDesc",
    },
    {
        "id": "octo",
        "labelKey": "datasetConverter.format.octo",
        "extensions": ["tfrecord"],
        "containers": ["dir"],
        "descKey": "datasetConverter.format.octoDesc",
    },
    {
        "id": "rtx",
        "labelKey": "datasetConverter.format.rtx",
        "extensions": ["tfrecord"],
        "containers": ["dir"],
        "descKey": "datasetConverter.format.rtxDesc",
    },
    {
        "id": "lerobot",
        "labelKey": "datasetConverter.format.lerobot",
        "extensions": ["parquet", "mp4", "json", "jsonl"],
        "containers": ["dir"],
        "descKey": "datasetConverter.format.lerobotDesc",
    },
    {
        "id": "robomimic",
        "labelKey": "datasetConverter.format.robomimic",
        "extensions": ["hdf5", "h5"],
        "containers": ["file", "dir"],
        "descKey": "datasetConverter.format.robomimicDesc",
    },
    {
        "id": "act",
        "labelKey": "datasetConverter.format.act",
        "extensions": ["hdf5", "h5"],
        "containers": ["file", "dir"],
        "descKey": "datasetConverter.format.actDesc",
    },
    {
        "id": "aloha",
        "labelKey": "datasetConverter.format.aloha",
        "extensions": ["hdf5", "h5"],
        "containers": ["file", "dir"],
        "descKey": "datasetConverter.format.alohaDesc",
    },
    {
        "id": "openpi",
        "labelKey": "datasetConverter.format.openpi",
        "extensions": ["parquet", "mp4", "json", "jsonl"],
        "containers": ["dir"],
        "descKey": "datasetConverter.format.openpiDesc",
    },
    {
        "id": "diffusion_policy",
        "labelKey": "datasetConverter.format.diffusion_policy",
        "extensions": ["zarr"],
        "containers": ["dir"],
        "descKey": "datasetConverter.format.diffusion_policyDesc",
    },
    {
        "id": "other",
        "labelKey": "datasetConverter.format.other",
        "extensions": [],
        "containers": ["file", "dir"],
        "descKey": "datasetConverter.format.otherDesc",
    },
]

INSPECTABLE_EXTENSIONS = {
    "json",
    "jsonl",
    "yaml",
    "yml",
    "pkl",
    "pickle",
    "hdf5",
    "h5",
    "parquet",
    "npy",
    "npz",
    "txt",
    "md",
    "csv",
    "jpg",
    "jpeg",
    "png",
    "webp",
    "gif",
    "bmp",
    "zarr",
}

IMAGE_EXTENSIONS = {"jpg", "jpeg", "png", "webp", "gif", "bmp"}


def _build_conversion_matrix() -> list[dict[str, Any]]:
    edges: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()

    def add(src: str, dst: str) -> None:
        if src == dst or src == "other" and dst == "other":
            return
        key = (src, dst)
        if key in seen:
            return
        seen.add(key)
        edges.append({"from": src, "to": dst, "status": "planned"})

    for group in (HDF5_LINEAGES, RLDS_LINEAGES, LEROBOT_LINEAGES):
        for src in group:
            for dst in group:
                add(src, dst)

    for h in HDF5_LINEAGES:
        for l in LEROBOT_LINEAGES:
            add(h, l)
        for r in RLDS_LINEAGES:
            add(h, r)
    for l in LEROBOT_LINEAGES:
        for r in RLDS_LINEAGES:
            add(l, r)

    for hub in HDF5_LINEAGES + LEROBOT_LINEAGES + RLDS_LINEAGES:
        add("diffusion_policy", hub)
        add(hub, "diffusion_policy")

    for dst in CLASSIC_LINEAGES:
        add("other", dst)

    return edges


CONVERSION_TARGETS = _build_conversion_matrix()


def _truncate_text(text: str, limit: int = MAX_FIELD_CHARS) -> tuple[str, bool]:
    if len(text) <= limit:
        return text, False
    return text[:limit] + "\n… [truncated]", True


def _safe_list(path: Path, limit: int = 40) -> list[str]:
    try:
        names = sorted(os.listdir(path))
    except OSError:
        return []
    if len(names) <= limit:
        return names
    return names[:limit] + [f"… (+{len(names) - limit} more)"]


def _has_glob(base: Path, pattern: str) -> bool:
    try:
        return any(base.glob(pattern))
    except OSError:
        return False


def _detect_zarr(path: Path) -> list[str]:
    signals: list[str] = []
    if path.suffix.lower() == ".zarr" and path.is_dir():
        signals.append(".zarr chunked array store")
    if _has_glob(path, "**/.zarray") or _has_glob(path, "**/.zgroup"):
        signals.append("Zarr metadata (.zarray / .zgroup)")
    if _has_glob(path, "*.zarr"):
        signals.append("*.zarr store directories")
    return signals


def _detect_lerobot(path: Path) -> list[str]:
    signals: list[str] = []
    if (path / "meta" / "info.json").is_file():
        signals.append("meta/info.json (LeRobot schema)")
    if _has_glob(path, "data/chunk-*"):
        signals.append("data/chunk-* parquet shards")
    if _has_glob(path, "videos/**/chunk-*"):
        signals.append("videos/{camera}/chunk-* MP4 shards")
    if _has_glob(path, "**/meta/info.json") and not signals:
        signals.append("nested LeRobot meta/info.json")
    return signals


def _detect_rlds(path: Path) -> list[str]:
    signals: list[str] = []
    names = _safe_list(path, 400)
    if any(n.endswith(".tfrecord") for n in names):
        signals.append(".tfrecord RLDS/TFDS shards")
    if _has_glob(path, "**/1.0.0") or _has_glob(path, "**/1.0.0/*"):
        signals.append("TFDS version directory (e.g. 1.0.0/)")
    for name in names:
        if name.endswith("dataset_info.json") or name == "features.json":
            signals.append(f"{name} (TFDS metadata)")
            break
    return signals


def _detect_hdf5(path: Path) -> list[str]:
    signals: list[str] = []
    if path.is_file() and path.suffix.lower() in {".hdf5", ".h5"}:
        return ["HDF5 episode file"]
    if _has_glob(path, "*.hdf5") or _has_glob(path, "*.h5"):
        signals.append("*.hdf5 / *.h5 episode files")
    return signals


def _read_lerobot_info(path: Path) -> dict[str, Any] | None:
    info_path = path / "meta" / "info.json"
    if not info_path.is_file():
        for nested in path.glob("**/meta/info.json"):
            info_path = nested
            break
        else:
            return None
    try:
        return json.loads(info_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _is_openpi_lerobot(path: Path, path_lower: str) -> bool:
    if any(k in path_lower for k in ("openpi", "pi0", "pi05", "pi_0", "pi-0")):
        return True
    info = _read_lerobot_info(path)
    if not info:
        return False
    blob = json.dumps(info, default=str).lower()
    return any(k in blob for k in ("openpi", "physical intelligence", "pi0", "pi05"))


def _classify_rlds(path: Path, signals: list[str]) -> tuple[str, list[str]]:
    names = _safe_list(path, 400)
    combined = f"{str(path).lower()} {' '.join(n.lower() for n in names)}"
    extra: list[str] = []

    if any(k in combined for k in ("openvla", "prismatic", "magic_soup")):
        extra.append("OpenVLA / Prismatic lineage markers")
        return "openvla", signals + extra
    if "octo" in combined:
        extra.append("Octo lineage markers")
        return "octo", signals + extra
    if any(k in combined for k in ("rtx", "rt-x", "rt_x", "rt1", "rt-1", "rt_1")):
        extra.append("RT-X / RT-1 lineage markers")
        return "rtx", signals + extra
    if any(
        k in combined
        for k in ("bridge", "droid", "open_x", "openx", "oxe", "rh20t", "bc_z", "bc-z")
    ):
        extra.append("Open X-Embodiment subdataset markers")
        return "open_x", signals + extra

    extra.append("RLDS/TFDS — default Open X-Embodiment lineage")
    return "open_x", signals + extra


def _classify_hdf5(path: Path, signals: list[str], names: list[str] | None = None) -> tuple[str, list[str]]:
    path_lower = str(path).lower()
    listing = names if names is not None else _safe_list(path, 400)
    combined = f"{path_lower} {' '.join(n.lower() for n in listing)}"
    extra: list[str] = []

    if any(k in combined for k in ("aloha", "bimanual", "cam_high", "cam_left_wrist")):
        extra.append("ALOHA-style bimanual markers")
        return "aloha", signals + extra
    if any(k in combined for k in ("robomimic", "robosuite", "demo.hdf5")):
        extra.append("robomimic / robosuite markers")
        return "robomimic", signals + extra
    if any(n.startswith("demo_") and n.endswith((".hdf5", ".h5")) for n in listing):
        extra.append("demo_*.hdf5 naming (robomimic-style)")
        return "robomimic", signals + extra
    if any(k in combined for k in ("/act", "_act", "act_")) and "robomimic" not in combined:
        extra.append("ACT pipeline markers")
        return "act", signals + extra
    if any(n.startswith("episode_") and n.endswith((".hdf5", ".h5")) for n in listing):
        extra.append("episode_*.hdf5 naming (ACT-style)")
        return "act", signals + extra

    extra.append("HDF5 episode — default ACT lineage")
    return "act", signals + extra


def _classify_file(path: Path) -> tuple[str, list[str], str]:
    ext = path.suffix.lower().lstrip(".")
    path_lower = str(path).lower()
    name_lower = path.name.lower()

    if ext in {"hdf5", "h5"}:
        fmt, signals = _classify_hdf5(path, ["single .hdf5/.h5 file"])
        return fmt, signals, "high"

    if ext == "zarr" or name_lower.endswith(".zarr"):
        return "diffusion_policy", ["Zarr store file/directory"], "high"

    if ext == "tfrecord":
        fmt, signals = _classify_rlds(path.parent if path.parent != path else path, [f"TFRecord shard: {path.name}"])
        return fmt, signals, "medium"

    return "other", [f"file: {path.name}"], "low"


def detect_structure(path_str: str) -> dict[str, Any]:
    path = Path(path_str).expanduser()
    if not path.exists():
        raise ValueError(f"path not found: {path_str}")

    container = "file" if path.is_file() else "dir"
    suggested_files: list[str] = []

    if path.is_file():
        fmt, signals, confidence = _classify_file(path)
        suggested_files.append(str(path.resolve()))
        return {
            "ok": True,
            "path": str(path.resolve()),
            "container": container,
            "format": fmt,
            "confidence": confidence,
            "signals": signals,
            "suggestedFiles": suggested_files,
            "stub": False,
        }

    zarr_sig = _detect_zarr(path)
    lerobot_sig = _detect_lerobot(path)
    rlds_sig = _detect_rlds(path)
    hdf5_sig = _detect_hdf5(path)
    names = _safe_list(path, 400)
    path_lower = str(path).lower()

    if zarr_sig:
        fmt, signals = "diffusion_policy", zarr_sig
    elif lerobot_sig:
        if _is_openpi_lerobot(path, path_lower):
            fmt = "openpi"
            signals = lerobot_sig + ["OpenPI / π0 LeRobot consumer markers"]
        else:
            fmt, signals = "lerobot", lerobot_sig
    elif rlds_sig:
        fmt, signals = _classify_rlds(path, rlds_sig)
    elif hdf5_sig:
        fmt, signals = _classify_hdf5(path, hdf5_sig, names)
    else:
        fmt, signals = "other", ["no recognized training-ecology signature"]

    confidence = "high" if fmt != "other" and len(signals) >= 1 else "low"
    if fmt != "other" and len(signals) == 1:
        confidence = "medium"

    for hint in ("meta/info.json", "meta/stats.json", "dataset_info.json"):
        p = path / hint
        if p.is_file():
            suggested_files.append(str(p.resolve()))

    for pat in (
        "*.json",
        "*.jsonl",
        "*.hdf5",
        "*.h5",
        "*.pkl",
        "*.parquet",
        "*.jpg",
        "*.jpeg",
        "*.png",
        "*.yaml",
        "*.yml",
    ):
        for fp in sorted(path.glob(pat))[:8]:
            sp = str(fp.resolve())
            if sp not in suggested_files:
                suggested_files.append(sp)

    return {
        "ok": True,
        "path": str(path.resolve()),
        "container": container,
        "format": fmt,
        "confidence": confidence,
        "signals": signals,
        "suggestedFiles": suggested_files[:20],
        "sampleListing": names,
        "stub": False,
    }


def _image_preview(path: Path, ext: str) -> dict[str, Any]:
    try:
        size = path.stat().st_size
    except OSError as e:
        return {"kind": "error", "message": str(e)}

    mime, _ = mimetypes.guess_type(path.name)
    if not mime:
        mime = "image/jpeg" if ext in {"jpg", "jpeg"} else f"image/{ext}"

    if size > IMAGE_PREVIEW_MAX_BYTES:
        return {
            "kind": "image",
            "mime": mime,
            "sizeBytes": size,
            "tooLarge": True,
            "maxBytes": IMAGE_PREVIEW_MAX_BYTES,
        }

    try:
        raw = path.read_bytes()
    except OSError as e:
        return {"kind": "error", "message": str(e)}

    b64 = base64.standard_b64encode(raw).decode("ascii")
    return {
        "kind": "image",
        "mime": mime,
        "sizeBytes": size,
        "dataUrl": f"data:{mime};base64,{b64}",
    }


def inspect_target(path_str: str, format_hint: str | None = None) -> dict[str, Any]:
    path = Path(path_str).expanduser()
    if not path.exists():
        raise ValueError(f"path not found: {path_str}")

    ext = path.suffix.lower().lstrip(".") if path.is_file() else ""
    if path.is_dir():
        fmt = format_hint or detect_structure(str(path))["format"]
    elif format_hint:
        fmt = format_hint
    elif ext in {"hdf5", "h5"}:
        fmt = _classify_hdf5(path, ["single .hdf5/.h5 file"])[0]
    elif ext == "zarr" or path.name.lower().endswith(".zarr"):
        fmt = "diffusion_policy"
    else:
        fmt = "other"

    preview: Any
    truncated = False
    implemented = False
    preview_kind = "stub"

    if path.is_file() and ext in IMAGE_EXTENSIONS:
        preview = _image_preview(path, ext)
        implemented = preview.get("kind") == "image" and not preview.get("tooLarge")
        preview_kind = "image"
    elif path.is_file() and ext == "json":
        try:
            raw = path.read_text(encoding="utf-8", errors="replace")
            text, truncated = _truncate_text(raw, MAX_INSPECT_CHARS)
            try:
                parsed = json.loads(raw[: MAX_INSPECT_CHARS + 1])
                preview = parsed if len(raw) <= MAX_INSPECT_CHARS else {"_preview": parsed, "_note": "JSON truncated"}
                truncated = len(raw) > MAX_INSPECT_CHARS
            except json.JSONDecodeError:
                preview = {"_rawText": text}
            implemented = True
            preview_kind = "json"
        except OSError as e:
            preview = {"kind": "error", "message": str(e)}
    elif path.is_file() and ext in {"yaml", "yml", "txt", "md", "csv", "jsonl"}:
        try:
            raw = path.read_text(encoding="utf-8", errors="replace")
            text, truncated = _truncate_text(raw, MAX_INSPECT_CHARS)
            preview = {"_rawText": text}
            implemented = True
            preview_kind = "text"
        except OSError as e:
            preview = {"kind": "error", "message": str(e)}
    else:
        preview = {
            "kind": "stub",
            "message": "Parser not implemented yet — will show schema keys / tensor shapes when enabled.",
            "path": str(path.resolve()),
            "extension": ext or None,
            "formatHint": fmt,
            "plannedFields": _planned_fields(fmt, path),
        }
        preview_kind = "stub"

    return {
        "ok": True,
        "path": str(path.resolve()),
        "format": fmt,
        "extension": ext or None,
        "previewKind": preview_kind,
        "implemented": implemented,
        "truncated": truncated,
        "preview": preview,
    }


def _planned_fields(fmt: str, path: Path) -> list[str]:
    if fmt in LEROBOT_LINEAGES:
        return ["observation.state", "action", "observation.images.*", "task_index", "timestamp"]
    if fmt in RLDS_LINEAGES:
        return ["steps[].observation", "steps[].action", "steps[].language_instruction", "steps[].is_first/is_last"]
    if fmt == "robomimic":
        return ["data/demo_*/actions", "data/demo_*/obs", "data/demo_*/states", "mask"]
    if fmt == "act":
        return ["/observations/qpos", "/observations/images/{cam}", "/action", "/language_raw"]
    if fmt == "aloha":
        return ["/observations/qpos", "/observations/images/cam_high|cam_left_wrist|cam_right_wrist", "/action"]
    if fmt == "diffusion_policy":
        return ["data/* (T,H,W,C) arrays", "meta/episode_ends", "action", "state"]
    if fmt == "openpi":
        return ["observation.state", "action", "prompt / language", "observation.images.* (multi-view)"]
    if path.suffix.lower() in {".pkl", ".pickle"}:
        return ["pickle object keys / array shapes"]
    if path.suffix.lower() in {".hdf5", ".h5"}:
        return ["HDF5 groups and dataset tree"]
    if path.suffix.lower() == "parquet":
        return ["Parquet column schema and row groups"]
    return ["unrecognized layout"]


def convert_episode(
    source_path: str,
    source_format: str,
    target_format: str,
    options: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if not source_path or not source_format or not target_format:
        raise ValueError("sourcePath, sourceFormat, targetFormat required")
    if source_format == target_format:
        raise ValueError("source and target format must differ")
    if source_format not in LINEAGE_FORMATS or target_format not in LINEAGE_FORMATS:
        raise ValueError("invalid format id")
    if source_format == "other" and target_format == "other":
        raise ValueError("cannot convert other → other")

    allowed = {(c["from"], c["to"]) for c in CONVERSION_TARGETS}
    if (source_format, target_format) not in allowed:
        raise ValueError(f"conversion {source_format} → {target_format} is not supported")

    opts = dict(options or {})
    if opts.get("sliceValid") is None and opts.get("slice_valid") is not None:
        opts["sliceValid"] = bool(opts["slice_valid"])
    if opts.get("includeImages") is None and opts.get("include_images") is not None:
        opts["includeImages"] = bool(opts["include_images"])
    if opts.get("outputDir") is None and opts.get("output_dir"):
        opts["outputDir"] = opts["output_dir"]

    from dataset_converter_ir import convert_via_cir

    try:
        return convert_via_cir(source_path, source_format, target_format, opts)
    except ImportError as e:
        return {
            "ok": False,
            "stub": True,
            "error": str(e),
            "sourcePath": str(Path(source_path).expanduser().resolve()),
            "sourceFormat": source_format,
            "targetFormat": target_format,
            "pipeline": [source_format, "cir", target_format],
            "plannedOutput": _planned_output(target_format),
        }


def _planned_output(target_format: str) -> str:
    if target_format == "robomimic":
        return "demo.hdf5 — data/demo_*/actions, obs, states (robomimic layout)"
    if target_format == "act":
        return "episode_*.hdf5 — /observations/qpos, /observations/images/{cam}, /action"
    if target_format == "aloha":
        return "episode_*.hdf5 — bimanual qpos + cam_high / wrist cameras"
    if target_format in LEROBOT_LINEAGES:
        return "meta/info.json + data/chunk-*/file-*.parquet + videos/*/chunk-*/file-*.mp4"
    if target_format in RLDS_LINEAGES:
        return "TFDS builder with RLDS steps[] (observation / action / language_instruction)"
    if target_format == "diffusion_policy":
        return ".zarr store — chunked (T,H,W,C) arrays + meta/episode_ends"
    return "other — no canonical target"


def get_spec() -> dict[str, Any]:
    return {
        "ok": True,
        "formats": FORMAT_CATALOG,
        "inspectableExtensions": sorted(INSPECTABLE_EXTENSIONS),
        "conversionMatrix": CONVERSION_TARGETS,
        "limits": {
            "maxInspectChars": MAX_INSPECT_CHARS,
            "maxFieldChars": MAX_FIELD_CHARS,
            "maxImagePreviewBytes": IMAGE_PREVIEW_MAX_BYTES,
        },
        "intermediateFormat": {
            "id": "cir",
            "labelKey": "datasetConverter.format.cir",
            "descKey": "datasetConverter.format.cirDesc",
        },
        "features": {
            "detect": True,
            "inspect": "partial",
            "convert": "via_cir",
        },
    }
