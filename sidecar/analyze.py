"""Reel Studio analysis sidecar: beats and downbeats of one audio file (Beat This! final0, PLAN.md §7, §11).

    uv run --project sidecar sidecar/analyze.py <audio> --model <checkpoint.ckpt> [--device cpu|mps] -o out.json

Runs on the FULL track (context helps the edges, and the result is offset-independent, so it is cached per audio
hash); the caller cuts its window and re-bases the times. Envelopes are not computed here: `@reel/audio` derives them
in TypeScript from the decoded stem, with the same code for generated music and tracks.

The checkpoint is a local file downloaded and SHA-256-checked by `reelgen setup analysis`; this script never fetches
anything. Output is deterministic (fixed rounding, sorted keys, no timings; timings go to stderr).

Exit codes: 0 ok · 2 bad arguments · 3 undecodable audio · 4 model checkpoint missing (run `reelgen setup analysis`).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

SR = 44100            # decode rate; Beat This! resamples to 22050 internally (soxr)
ROUND_T = 4           # seconds, 0.1 ms
MODEL_NAME = "beat_this:final0"


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def decode(path: Path) -> np.ndarray:
    """Any ffmpeg-readable file -> mono float32 at SR (first audio stream)."""
    cmd = ["ffmpeg", "-nostdin", "-v", "error", "-i", str(path), "-map", "a:0", "-ac", "1", "-ar", str(SR),
           "-f", "f32le", "-"]
    raw = subprocess.run(cmd, check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype="<f4").astype(np.float32)


def track_beats(signal: np.ndarray, checkpoint: Path, device: str) -> tuple[np.ndarray, np.ndarray]:
    from beat_this.inference import Audio2Beats  # heavy import (torch) only when needed
    # A local path: beat_this loads it with torch.load and never falls back to its download URL.
    a2b = Audio2Beats(checkpoint_path=str(checkpoint), device=device, dbn=False)
    beats, downbeats = a2b(signal, SR)
    return np.asarray(beats, dtype=np.float64), np.asarray(downbeats, dtype=np.float64)


def bpm_of(beats: np.ndarray) -> float | None:
    if len(beats) < 2:
        return None
    return round(60.0 / float(np.median(np.diff(beats))), 2)


def meter_of(beats: np.ndarray, downbeats: np.ndarray) -> tuple[int | None, float | None]:
    """Mode of beats-per-bar between consecutive downbeats, and the share of bars that agree with it."""
    if len(downbeats) < 2:
        return None, None
    counts = [int(np.sum((beats >= d0 - 1e-6) & (beats < d1 - 1e-6))) for d0, d1 in zip(downbeats, downbeats[1:])]
    vals, cnt = np.unique(counts, return_counts=True)
    return int(vals[np.argmax(cnt)]), round(float(cnt.max() / cnt.sum()), 3)   # mode (ties -> smallest), share


def analyze(path: Path, checkpoint: Path, device: str) -> dict:
    t0 = time.perf_counter()
    x = decode(path)
    if not len(x):
        raise ValueError("no audio samples")
    t1 = time.perf_counter()
    beats, downbeats = track_beats(x, checkpoint, device)
    t2 = time.perf_counter()
    print(f"decode {t1 - t0:.3f}s  beats[{device}] {t2 - t1:.3f}s  (audio {len(x) / SR:.2f}s)", file=sys.stderr)
    meter, meter_conf = meter_of(beats, downbeats)
    return {
        "version": 1,
        "source": {"sha256": sha256_file(path)},
        "model": {"name": MODEL_NAME, "sha256": sha256_file(checkpoint)},
        "duration": round(len(x) / SR, ROUND_T),
        "beats": [round(float(t), ROUND_T) for t in beats],
        "downbeats": [round(float(t), ROUND_T) for t in downbeats],
        "bpm": bpm_of(beats),
        "meter": meter,
        "meter_confidence": meter_conf,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("audio", type=Path)
    ap.add_argument("--model", type=Path, required=True, help="local Beat This! final0 checkpoint (.ckpt)")
    ap.add_argument("--device", default="cpu", choices=("cpu", "mps"))
    ap.add_argument("-o", "--out", type=Path, required=True)
    a = ap.parse_args()
    if not a.audio.is_file():
        print(f"audio file not found: {a.audio}", file=sys.stderr)
        return 2
    if not a.model.is_file():
        print(f"model checkpoint missing: {a.model} (run `reelgen setup analysis`)", file=sys.stderr)
        return 4
    try:
        doc = analyze(a.audio, a.model, a.device)
    except (subprocess.CalledProcessError, ValueError) as e:
        detail = e.stderr.decode(errors="replace").strip() if isinstance(e, subprocess.CalledProcessError) else str(e)
        print(f"cannot decode {a.audio}: {detail}", file=sys.stderr)
        return 3
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps(doc, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
