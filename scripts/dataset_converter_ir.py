"""Canonical Intermediate Representation (CIR) for dataset format conversion.

All lineage formats import into CIR, then export from CIR to the target lineage.
On disk::

    {ir_dir}/
      manifest.json
      steps.json      # state/action arrays (no embedded images)
      images/{cam}/{frame:06d}.jpg
"""

from __future__ import annotations

import json
import re
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import h5py
import numpy as np
from PIL import Image

CIR_VERSION = 1

HDF5_LINEAGES = frozenset({"robomimic", "act", "aloha"})
RLDS_LINEAGES = frozenset({"open_x", "openvla", "octo", "rtx"})
LEROBOT_LINEAGES = frozenset({"lerobot", "openpi"})

_CAMERA_PREFIX: dict[str, str] = {
    "wrist": "rgb_wrist_1",
    "rear_left": "rgb_rear_left",
    "chest": "rgb_chest",
    "top": "rgb_top",
    "wrist_2": "rgb_wrist_2",
    "cam_high": "rgb_top",
    "cam_left_wrist": "rgb_wrist_1",
    "cam_right_wrist": "rgb_wrist_2",
}


@dataclass
class EpisodeCIR:
    source_lineage: str
    language_instruction: str = ""
    fps: float = 10.0
    camera_names: list[str] = field(default_factory=list)
    states: np.ndarray | None = None  # [T, D] float32
    actions: np.ndarray | None = None  # [T, D] float32
    images: dict[str, np.ndarray] = field(default_factory=dict)  # cam -> [T,H,W,3] uint8
    meta: dict[str, Any] = field(default_factory=dict)

    @property
    def num_steps(self) -> int:
        if self.actions is not None:
            return int(self.actions.shape[0])
        if self.states is not None:
            return int(self.states.shape[0])
        return 0


def lineage_container(lineage: str) -> str:
    if lineage in RLDS_LINEAGES:
        return "rlds"
    if lineage in LEROBOT_LINEAGES:
        return "lerobot"
    if lineage in HDF5_LINEAGES:
        return "hdf5"
    if lineage == "diffusion_policy":
        return "zarr"
    return "raw"


def save_cir(cir: EpisodeCIR, ir_dir: Path) -> None:
    ir_dir.mkdir(parents=True, exist_ok=True)
    manifest = {
        "cir_version": CIR_VERSION,
        "source_lineage": cir.source_lineage,
        "language_instruction": cir.language_instruction,
        "fps": cir.fps,
        "camera_names": cir.camera_names,
        "num_steps": cir.num_steps,
        "state_dim": int(cir.states.shape[1]) if cir.states is not None else 0,
        "action_dim": int(cir.actions.shape[1]) if cir.actions is not None else 0,
        "meta": cir.meta,
    }
    (ir_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    steps_payload: dict[str, Any] = {}
    if cir.states is not None:
        steps_payload["state"] = cir.states.tolist()
    if cir.actions is not None:
        steps_payload["action"] = cir.actions.tolist()
    (ir_dir / "steps.json").write_text(json.dumps(steps_payload), encoding="utf-8")

    if cir.images:
        img_root = ir_dir / "images"
        if img_root.exists():
            shutil.rmtree(img_root)
        img_root.mkdir(parents=True)
        for cam, arr in cir.images.items():
            cam_dir = img_root / cam
            cam_dir.mkdir(parents=True, exist_ok=True)
            for i in range(arr.shape[0]):
                Image.fromarray(arr[i]).save(cam_dir / f"{i:06d}.jpg", quality=90)


def load_cir(ir_dir: Path) -> EpisodeCIR:
    manifest = json.loads((ir_dir / "manifest.json").read_text(encoding="utf-8"))
    steps = json.loads((ir_dir / "steps.json").read_text(encoding="utf-8"))
    states = np.array(steps["state"], dtype=np.float32) if "state" in steps else None
    actions = np.array(steps["action"], dtype=np.float32) if "action" in steps else None

    images: dict[str, np.ndarray] = {}
    img_root = ir_dir / "images"
    if img_root.is_dir():
        for cam_dir in sorted(img_root.iterdir()):
            if not cam_dir.is_dir():
                continue
            frames = []
            for fp in sorted(cam_dir.glob("*.jpg")):
                frames.append(np.array(Image.open(fp).convert("RGB"), dtype=np.uint8))
            if frames:
                images[cam_dir.name] = np.stack(frames)

    camera_names = manifest.get("camera_names") or list(images.keys())
    return EpisodeCIR(
        source_lineage=str(manifest.get("source_lineage", "other")),
        language_instruction=str(manifest.get("language_instruction", "")),
        fps=float(manifest.get("fps", 10.0)),
        camera_names=camera_names,
        states=states,
        actions=actions,
        images=images,
        meta=dict(manifest.get("meta") or {}),
    )


def _parse_gripper(raw: Any) -> np.ndarray:
    arr = np.array(raw, dtype=np.float64)
    if arr.ndim == 2:
        return arr[0] if arr.shape[0] == 1 else arr.squeeze(-1)
    return arr


def _build_frame_map(episode_dir: Path, prefix: str) -> dict[int, Path]:
    frame_map: dict[int, Path] = {}
    for p in episode_dir.iterdir():
        if p.suffix.lower() not in {".jpg", ".jpeg", ".png"}:
            continue
        if not p.stem.startswith(prefix):
            continue
        try:
            idx = int(p.stem.split("_")[-1])
        except ValueError:
            continue
        frame_map[idx] = p
    return frame_map


def _load_images(frame_map: dict[int, Path], frame_indices: list[int], resize_hw: tuple[int, int] | None) -> np.ndarray:
    available = sorted(frame_map.keys())
    if not available:
        raise FileNotFoundError("no image frames found for camera")
    images = []
    for i in frame_indices:
        nearest = min(available, key=lambda x: abs(x - i))
        img = Image.open(frame_map[nearest]).convert("RGB")
        if resize_hw is not None:
            img = img.resize((resize_hw[1], resize_hw[0]), Image.BILINEAR)
        images.append(np.array(img, dtype=np.uint8))
    return np.stack(images)


def _parse_annotation(annot_path: Path) -> tuple[int, int] | None:
    if not annot_path.is_file():
        return None
    lines = annot_path.read_text(encoding="utf-8").splitlines()
    if len(lines) < 3:
        return None
    try:
        start = int(lines[0].split()[1])
        end = int(lines[2].split()[1])
    except (ValueError, IndexError):
        return None
    if start < 0 or end < 0 or end < start:
        return None
    return start, end


def _resolve_episode_dir(source: Path) -> Path:
    if source.is_file():
        return source.parent
    if (source / "steps.json").is_file():
        return source
    for child in sorted(source.iterdir()):
        if child.is_dir() and (child / "steps.json").is_file():
            return child
    return source


def _find_hdf5_files(source: Path) -> list[Path]:
    if source.is_file() and source.suffix.lower() in {".hdf5", ".h5"}:
        return [source]
    return sorted(source.glob("*.hdf5")) + sorted(source.glob("*.h5"))


def import_to_cir(source_path: str, source_lineage: str, options: dict[str, Any] | None = None) -> EpisodeCIR:
    opts = options or {}
    source = Path(source_path).expanduser().resolve()
    if not source.exists():
        raise ValueError(f"path not found: {source_path}")

    container = lineage_container(source_lineage)
    if container == "raw" or (source.is_dir() and (source / "steps.json").is_file()):
        return _import_raw_to_cir(source, source_lineage, opts)
    if container == "hdf5":
        return _import_hdf5_to_cir(source, source_lineage, opts)
    if container == "lerobot":
        return _import_lerobot_to_cir(source, source_lineage, opts)
    if container == "rlds":
        return _import_rlds_to_cir(source, source_lineage, opts)
    if container == "zarr":
        return _import_zarr_to_cir(source, source_lineage, opts)
    raise ValueError(f"unsupported import for lineage: {source_lineage}")


def _import_raw_to_cir(source: Path, lineage: str, opts: dict[str, Any]) -> EpisodeCIR:
    episode_dir = _resolve_episode_dir(source)
    steps_path = episode_dir / "steps.json"
    if not steps_path.is_file():
        raise ValueError(f"raw import requires steps.json in {episode_dir}")

    steps = json.loads(steps_path.read_text(encoding="utf-8"))
    obs = steps["observations"]
    action_space = str(opts.get("actionSpace") or "cartesian_abs")
    gripper_obs = _parse_gripper(obs["gripper_position"])
    proprio = np.array(
        obs["joint_position"] if action_space == "joint" else obs["cartesian_position"],
        dtype=np.float64,
    )
    t_total = len(proprio)

    start_idx, end_idx = 0, t_total - 1
    if opts.get("sliceValid"):
        annot_dir = opts.get("annotationDir")
        if annot_dir:
            parsed = _parse_annotation(Path(str(annot_dir)) / f"{episode_dir.name}.txt")
            if parsed:
                start_idx, end_idx = parsed

    frame_indices = list(range(start_idx, end_idx + 1))
    grip_action = _parse_gripper(steps["actions"]["gripper_position"])

    states = np.stack([np.append(proprio[i], gripper_obs[i]) for i in frame_indices]).astype(np.float32)
    actions = np.zeros((len(frame_indices), 7), dtype=np.float32)
    for k, cur_idx in enumerate(frame_indices):
        nxt_idx = frame_indices[k + 1] if k + 1 < len(frame_indices) else cur_idx
        actions[k] = np.append(proprio[nxt_idx], grip_action[nxt_idx]).astype(np.float32)

    camera_names = list(opts.get("cameraNames") or ["chest", "top", "wrist_2"])
    images: dict[str, np.ndarray] = {}
    if opts.get("includeImages", True):
        for cam in camera_names:
            prefix = _CAMERA_PREFIX.get(cam, cam)
            fmap = _build_frame_map(episode_dir, prefix)
            if fmap:
                resize = None if cam == "wrist" else (480, 640)
                images[cam] = _load_images(fmap, frame_indices, resize)

    language = ""
    meta_path = episode_dir / "metadata.json"
    if meta_path.is_file():
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        language = str(meta.get("natural_language") or "")

    return EpisodeCIR(
        source_lineage=lineage,
        language_instruction=language,
        camera_names=[c for c in camera_names if c in images] or list(images.keys()),
        states=states,
        actions=actions,
        images=images,
        meta={"action_space": action_space, "raw_dir": str(episode_dir)},
    )


def _import_hdf5_to_cir(source: Path, lineage: str, opts: dict[str, Any]) -> EpisodeCIR:
    files = _find_hdf5_files(source)
    if not files:
        raise ValueError(f"no HDF5 files under {source}")
    h5_path = files[0]

    with h5py.File(h5_path, "r") as root:
        if lineage == "robomimic" and "data" in root:
            demo_key = next(k for k in root["data"].keys() if k.startswith("demo"))
            demo = root["data"][demo_key]
            actions = np.array(demo["actions"], dtype=np.float32)
            states = np.array(demo.get("states") or demo["obs"], dtype=np.float32)
            images: dict[str, np.ndarray] = {}
            language = str(root.attrs.get("language", "") or "")
        else:
            actions = np.array(root["action"], dtype=np.float32)
            states = np.array(root["observations/qpos"], dtype=np.float32)
            images = {}
            if opts.get("includeImages", True) and "observations/images" in root:
                img_grp = root["observations/images"]
                for cam in img_grp.keys():
                    images[str(cam)] = np.array(img_grp[cam], dtype=np.uint8)
            language = str(root.attrs.get("language_instruction", "") or "")

    return EpisodeCIR(
        source_lineage=lineage,
        language_instruction=language,
        camera_names=list(images.keys()),
        states=states,
        actions=actions,
        images=images,
        meta={"hdf5_source": str(h5_path)},
    )


def _import_lerobot_to_cir(source: Path, lineage: str, opts: dict[str, Any]) -> EpisodeCIR:
    info_path = source / "meta" / "info.json"
    if not info_path.is_file():
        for nested in source.glob("**/meta/info.json"):
            info_path = nested
            source = nested.parent.parent
            break
    if not info_path.is_file():
        raise ValueError("LeRobot import requires meta/info.json")

    info = json.loads(info_path.read_text(encoding="utf-8"))
    try:
        import pyarrow.parquet as pq  # type: ignore
    except ImportError as e:
        raise ImportError("LeRobot import requires pyarrow (`pip install pyarrow`)") from e

    parquet_files = sorted(source.glob("data/chunk-*/file-*.parquet"))
    if not parquet_files:
        parquet_files = sorted(source.glob("**/*.parquet"))
    if not parquet_files:
        raise ValueError("no parquet shards found for LeRobot import")

    table = pq.read_table(parquet_files[0])
    df = table.to_pandas()
    state_col = next((c for c in ("observation.state", "state") if c in df.columns), None)
    action_col = next((c for c in ("action", "actions") if c in df.columns), None)
    if not state_col or not action_col:
        raise ValueError(f"parquet missing state/action columns: {list(df.columns)}")

    states = np.array(df[state_col].tolist(), dtype=np.float32)
    actions = np.array(df[action_col].tolist(), dtype=np.float32)
    language = str(info.get("task") or info.get("language_instruction") or "")

    return EpisodeCIR(
        source_lineage=lineage,
        language_instruction=language,
        fps=float(info.get("fps") or 10),
        camera_names=[],
        states=states,
        actions=actions,
        images={},
        meta={"lerobot_root": str(source), "codebase_version": info.get("codebase_version")},
    )


def _import_rlds_to_cir(source: Path, lineage: str, opts: dict[str, Any]) -> EpisodeCIR:
    try:
        import tensorflow as tf  # type: ignore
    except ImportError as e:
        raise ImportError("RLDS import requires tensorflow (`pip install tensorflow`)") from e

    tfrecord_files = sorted(source.glob("**/*.tfrecord"))
    if not tfrecord_files:
        raise ValueError(f"no TFRecord files under {source}")

    states: list[list[float]] = []
    actions: list[list[float]] = []
    language = ""

    for raw in tf.data.TFRecordDataset(str(tfrecord_files[0])):
        example = tf.train.Example()
        example.ParseFromString(raw.numpy())
        features = example.features.feature
        for key, feat in features.items():
            if "action" in key.lower() and feat.float_list.value:
                actions.append(list(feat.float_list.value))
            if "state" in key.lower() and feat.float_list.value:
                states.append(list(feat.float_list.value))
            if "language" in key.lower() and feat.bytes_list.value:
                language = feat.bytes_list.value[0].decode("utf-8", errors="replace")
        break

    if not actions:
        raise ValueError("could not parse RLDS/TFRecord example — schema may differ")

    st = np.array(states, dtype=np.float32) if states else None
    act = np.array(actions, dtype=np.float32)
    if st is None:
        st = np.zeros((act.shape[0], act.shape[1]), dtype=np.float32)

    return EpisodeCIR(
        source_lineage=lineage,
        language_instruction=language,
        states=st,
        actions=act,
        images={},
        meta={"rlds_root": str(source), "note": "partial RLDS import (first shard / first step schema)"},
    )


def _import_zarr_to_cir(source: Path, lineage: str, opts: dict[str, Any]) -> EpisodeCIR:
    try:
        import zarr  # type: ignore
    except ImportError as e:
        raise ImportError("Zarr import requires zarr (`pip install zarr`)") from e

    store_path = source
    if source.is_dir() and not (source / ".zgroup").is_file():
        zarr_dirs = list(source.glob("*.zarr"))
        if zarr_dirs:
            store_path = zarr_dirs[0]
    root = zarr.open(str(store_path), mode="r")
    action = np.array(root["action"], dtype=np.float32)
    state = np.array(root.get("state") or root.get("agent_pos"), dtype=np.float32)
    images: dict[str, np.ndarray] = {}
    if opts.get("includeImages", True):
        for key in root.keys():
            if key in {"action", "state", "agent_pos", "meta"}:
                continue
            arr = np.array(root[key], dtype=np.uint8)
            if arr.ndim == 4:
                images[key] = arr

    return EpisodeCIR(
        source_lineage=lineage,
        states=state,
        actions=action,
        camera_names=list(images.keys()),
        images=images,
        meta={"zarr_root": str(store_path)},
    )


def export_from_cir(
    cir: EpisodeCIR,
    target_lineage: str,
    output_dir: Path,
    options: dict[str, Any] | None = None,
) -> Path:
    opts = options or {}
    output_dir.mkdir(parents=True, exist_ok=True)
    container = lineage_container(target_lineage)

    if container == "hdf5":
        return _export_hdf5(cir, target_lineage, output_dir, opts)
    if container == "lerobot":
        return _export_lerobot(cir, target_lineage, output_dir, opts)
    if container == "rlds":
        return _export_rlds(cir, target_lineage, output_dir, opts)
    if container == "zarr":
        return _export_zarr(cir, target_lineage, output_dir, opts)
    return _export_raw(cir, target_lineage, output_dir, opts)


def _export_hdf5(cir: EpisodeCIR, lineage: str, output_dir: Path, opts: dict[str, Any]) -> Path:
    if cir.actions is None or cir.states is None:
        raise ValueError("CIR missing state/action arrays for HDF5 export")

    name = "demo.hdf5" if lineage == "robomimic" else "episode_0.hdf5"
    out_path = output_dir / name

    camera_names = cir.camera_names or list(cir.images.keys())
    if lineage == "aloha" and not camera_names:
        camera_names = ["cam_high", "cam_left_wrist", "cam_right_wrist"]

    with h5py.File(out_path, "w") as f:
        f.attrs["source_lineage"] = cir.source_lineage
        f.attrs["target_lineage"] = lineage
        if cir.language_instruction:
            f.attrs["language_instruction"] = cir.language_instruction

        if lineage == "robomimic":
            data = f.create_group("data")
            demo = data.create_group("demo_0")
            demo.create_dataset("actions", data=cir.actions)
            demo.create_dataset("states", data=cir.states)
            demo.create_dataset("obs", data=cir.states)
            mask = f.create_group("mask")
            mask.create_dataset("valid", data=np.ones(cir.num_steps, dtype=bool))
        else:
            qvel = np.zeros_like(cir.states)
            qvel[1:] = cir.states[1:] - cir.states[:-1]
            obs_grp = f.create_group("observations")
            obs_grp.create_dataset("qpos", data=cir.states)
            obs_grp.create_dataset("qvel", data=qvel)
            if cir.images and opts.get("includeImages", True):
                img_grp = obs_grp.create_group("images")
                for i, cam in enumerate(camera_names):
                    key = cam if cam in cir.images else (list(cir.images.keys())[i] if cir.images else cam)
                    if key in cir.images:
                        img_grp.create_dataset(cam, data=cir.images[key], compression="lzf")
            f.create_dataset("action", data=cir.actions)
            if cir.language_instruction:
                dt = h5py.string_dtype(encoding="utf-8")
                f.create_dataset("language_raw", data=np.array([cir.language_instruction], dtype=dt))

    return out_path


def _export_lerobot(cir: EpisodeCIR, lineage: str, output_dir: Path, opts: dict[str, Any]) -> Path:
    meta_dir = output_dir / "meta"
    data_dir = output_dir / "data" / "chunk-000"
    meta_dir.mkdir(parents=True, exist_ok=True)
    data_dir.mkdir(parents=True, exist_ok=True)

    fps = cir.fps or 10.0
    features: dict[str, Any] = {
        "observation.state": {"dtype": "float32", "shape": [int(cir.states.shape[1]) if cir.states is not None else 0]},
        "action": {"dtype": "float32", "shape": [int(cir.actions.shape[1]) if cir.actions is not None else 0]},
    }
    for cam in cir.camera_names or cir.images.keys():
        features[f"observation.images.{cam}"] = {"dtype": "video", "shape": [3, 480, 640]}

    info = {
        "codebase_version": "v2.1" if lineage == "openpi" else "v2.0",
        "robot_type": cir.meta.get("robot_type", "unknown"),
        "fps": fps,
        "features": features,
        "total_episodes": 1,
        "total_frames": cir.num_steps,
        "splits": {"train": "0:1"},
        "data_path": "data/chunk-{episode_chunk:03d}/episode_{episode_index:06d}.parquet",
        "video_path": "videos/chunk-{episode_chunk:03d}/{video_key}/episode_{episode_index:06d}.mp4",
    }
    if lineage == "openpi":
        info["codebase_version"] = "openpi"
        info["prompt_template"] = "multi_view"

    (meta_dir / "info.json").write_text(json.dumps(info, indent=2), encoding="utf-8")

    rows = []
    for t in range(cir.num_steps):
        row = {
            "frame_index": t,
            "timestamp": t / fps,
            "action": cir.actions[t].tolist() if cir.actions is not None else [],
            "observation.state": cir.states[t].tolist() if cir.states is not None else [],
        }
        rows.append(row)
    (data_dir / "episode_000000.json").write_text(json.dumps(rows, indent=2), encoding="utf-8")

    if cir.images and opts.get("includeImages", True):
        for cam, arr in cir.images.items():
            vid_dir = output_dir / "videos" / "chunk-000" / f"observation.images.{cam}"
            vid_dir.mkdir(parents=True, exist_ok=True)
            for i in range(arr.shape[0]):
                Image.fromarray(arr[i]).save(vid_dir / f"frame_{i:06d}.jpg", quality=90)

    if cir.language_instruction:
        tasks = [{"task_index": 0, "task": cir.language_instruction}]
        (meta_dir / "tasks.jsonl").write_text("\n".join(json.dumps(t) for t in tasks) + "\n", encoding="utf-8")

    return output_dir


def _export_rlds(cir: EpisodeCIR, lineage: str, output_dir: Path, opts: dict[str, Any]) -> Path:
    """Write CIR JSON steps + manifest; full TFRecord generation needs tensorflow."""
    out_dir = output_dir / f"{lineage}_rlds"
    out_dir.mkdir(parents=True, exist_ok=True)

    steps = []
    for t in range(cir.num_steps):
        step: dict[str, Any] = {
            "action": cir.actions[t].tolist() if cir.actions is not None else [],
            "observation": {"state": cir.states[t].tolist() if cir.states is not None else {}},
            "is_first": t == 0,
            "is_last": t == cir.num_steps - 1,
        }
        if cir.language_instruction:
            step["language_instruction"] = cir.language_instruction
        steps.append(step)

    episode = {"steps": steps, "lineage": lineage}
    (out_dir / "episode.json").write_text(json.dumps(episode, indent=2), encoding="utf-8")

    builder_readme = (
        f"# {lineage} RLDS export (intermediate)\n\n"
        "Episode serialized as episode.json. Pack into TFRecord with your TFDS builder.\n"
        f"Source lineage: {cir.source_lineage}\n"
    )
    (out_dir / "README.txt").write_text(builder_readme, encoding="utf-8")
    return out_dir


def _export_zarr(cir: EpisodeCIR, lineage: str, output_dir: Path, opts: dict[str, Any]) -> Path:
    try:
        import zarr  # type: ignore
    except ImportError as e:
        raise ImportError("Zarr export requires zarr (`pip install zarr`)") from e

    out_path = output_dir / "episode.zarr"
    if out_path.exists():
        shutil.rmtree(out_path)
    root = zarr.open(str(out_path), mode="w")
    root.create_dataset("action", data=cir.actions)
    if cir.states is not None:
        root.create_dataset("state", data=cir.states)
    if cir.images and opts.get("includeImages", True):
        for cam, arr in cir.images.items():
            root.create_dataset(f"image_{cam}", data=arr)
    meta = root.create_group("meta")
    meta.create_dataset("episode_ends", data=np.array([cir.num_steps], dtype=np.int64))
    return out_path


def _export_raw(cir: EpisodeCIR, lineage: str, output_dir: Path, opts: dict[str, Any]) -> Path:
    out_dir = output_dir / "raw_episode"
    out_dir.mkdir(parents=True, exist_ok=True)

    t = cir.num_steps
    steps = {
        "observations": {
            "cartesian_position": cir.states[:, :6].tolist() if cir.states is not None and cir.states.shape[1] >= 6 else [],
            "gripper_position": cir.states[:, 6:7].tolist() if cir.states is not None and cir.states.shape[1] >= 7 else [],
        },
        "actions": {
            "cartesian_position": cir.actions[:, :6].tolist() if cir.actions is not None and cir.actions.shape[1] >= 6 else [],
            "gripper_position": cir.actions[:, 6:7].tolist() if cir.actions is not None and cir.actions.shape[1] >= 7 else [],
        },
    }
    (out_dir / "steps.json").write_text(json.dumps(steps, indent=2), encoding="utf-8")

    if cir.language_instruction:
        (out_dir / "metadata.json").write_text(
            json.dumps({"natural_language": cir.language_instruction}, indent=2),
            encoding="utf-8",
        )

    if cir.images and opts.get("includeImages", True):
        for cam, arr in cir.images.items():
            prefix = _CAMERA_PREFIX.get(cam, cam)
            for i in range(arr.shape[0]):
                Image.fromarray(arr[i]).save(out_dir / f"{prefix}_{i}.jpg", quality=90)

    return out_dir


def convert_via_cir(
    source_path: str,
    source_lineage: str,
    target_lineage: str,
    options: dict[str, Any] | None = None,
) -> dict[str, Any]:
    opts = dict(options or {})
    source = Path(source_path).expanduser().resolve()

    out_base = Path(opts["outputDir"]).expanduser().resolve() if opts.get("outputDir") else source.parent / f"converted_{target_lineage}"
    ir_dir = out_base / "_cir"
    out_dir = out_base / target_lineage

    cir = import_to_cir(str(source), source_lineage, opts)
    save_cir(cir, ir_dir)
    output_path = export_from_cir(cir, target_lineage, out_dir, opts)

    return {
        "ok": True,
        "stub": False,
        "sourcePath": str(source),
        "sourceFormat": source_lineage,
        "targetFormat": target_lineage,
        "pipeline": [source_lineage, "cir", target_lineage],
        "intermediatePath": str(ir_dir.resolve()),
        "outputPath": str(output_path.resolve()),
        "outputDir": str(out_base.resolve()),
        "numSteps": cir.num_steps,
        "plannedOutput": str(output_path.resolve()),
    }
