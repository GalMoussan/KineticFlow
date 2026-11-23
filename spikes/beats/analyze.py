"""Reel Studio M0f: beat/downbeat + per-frame band envelopes for one audio file.

    uv run analyze.py <audio> --fps 30|60 [--offset s] [--duration s] -o out.json

Beats/downbeats come from Beat This! (CPJKU, ISMIR 2024) run on the FULL track (context helps the edges and the
result is cacheable per audio hash); the [offset, offset+duration) window is cut afterwards and its times are
re-based so that t=0 is the first video frame. Envelopes are computed with a numpy STFT and normalised against
full-track statistics, so trimming never changes the scale. Output is deterministic (fixed rounding, sorted keys,
no timings in the JSON; timings go to stderr).
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
from scipy.ndimage import median_filter

SR = 44100                 # decode rate; Beat This! resamples to 22050 internally (soxr)
N_FFT = 2048               # bands: 46 ms window, 21.5 Hz bins (sub band gets bins 1-2)
N_FFT_ONSET = 1024         # onset flux: 23 ms window for sharper timing
HOP = 128                  # 2.9 ms hop -> ~11 STFT frames per 30 fps frame, ~5.7 per 60 fps frame
ONSET_BASELINE = 139       # moving-median window for the onset baseline, in hops (~0.4 s)
# Each STFT frame is assigned to the video frame that contains its window END, so a frame's value never depends
# on audio after that frame's window (no look-ahead: a kick at t first shows in the frame containing t).
BANDS = {"sub": (0.0, 60.0), "bass": (60.0, 250.0), "mid": (250.0, 2000.0), "high": (2000.0, SR / 2 + 1)}
DB_RANGE = 40.0            # band level: ref-40 dB -> 0, ref (p99.5 of the full track) -> 1
REF_PCT = 99.5
ROUND_T = 4                # seconds, 0.1 ms
ROUND_E = 4


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def decode(path: Path, sr: int = SR) -> np.ndarray:
    """Any ffmpeg-readable file -> mono float32 at `sr` (first audio stream)."""
    cmd = ["ffmpeg", "-nostdin", "-v", "error", "-i", str(path), "-map", "a:0", "-ac", "1", "-ar", str(sr),
           "-f", "f32le", "-"]
    raw = subprocess.run(cmd, check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype="<f4").astype(np.float32)


_models: dict[tuple[str, str], object] = {}


def track_beats(signal: np.ndarray, sr: int, model: str = "final0", device: str = "cpu") -> tuple[np.ndarray, np.ndarray]:
    from beat_this.inference import Audio2Beats  # heavy import (torch) only when needed
    key = (model, device)
    if key not in _models:
        _models[key] = Audio2Beats(checkpoint_path=model, device=device, dbn=False)
    beats, downbeats = _models[key](signal, sr)
    return np.asarray(beats, dtype=np.float64), np.asarray(downbeats, dtype=np.float64)


def stft_power(x: np.ndarray, n_fft: int) -> tuple[np.ndarray, np.ndarray]:
    """STFT power (frames, n_fft//2+1) and each frame's window-end time in seconds."""
    pad = n_fft // 2
    xp = np.concatenate([np.zeros(pad, np.float32), x, np.zeros(pad + HOP, np.float32)])
    n = 1 + (len(x) + HOP - 1) // HOP
    frames = np.lib.stride_tricks.sliding_window_view(xp, n_fft)[::HOP][:n]
    win = np.hanning(n_fft).astype(np.float32)
    spec = np.fft.rfft(frames * win, axis=1)
    t_end = (np.arange(n) * HOP + n_fft // 2) / SR
    return (spec.real ** 2 + spec.imag ** 2) / float(np.sum(win ** 2)), t_end


def frame_reduce(values: np.ndarray, t_k: np.ndarray, start: float, n: int, fps: int, how: str) -> np.ndarray:
    """Reduce per-STFT-frame values into n abutting video-frame windows [start + i/fps, start + (i+1)/fps).
    Empty windows (past the end of the audio) -> 0."""
    idx = np.searchsorted(t_k, start + np.arange(n + 1) / fps, side="left")
    lo, hi = idx[:-1], idx[1:]
    out = np.zeros(n, dtype=np.float64)
    ok = hi > lo
    if not ok.any():
        return out
    # non-empty windows are contiguous (HOP < 1/fps), so reduceat segments are exactly [lo_i, hi_i)
    bounds = np.concatenate([lo[ok], [hi[ok][-1]]])
    padded = np.concatenate([values.astype(np.float64), [0.0]])
    if how == "mean":
        out[ok] = np.add.reduceat(padded, bounds)[:-1] / (hi[ok] - lo[ok])
    else:
        out[ok] = np.maximum.reduceat(padded, bounds)[:-1]
    return out


def envelopes(x: np.ndarray, fps: int, offset: float, n_frames: int) -> dict:
    power, t_k = stft_power(x, N_FFT)
    freqs = np.fft.rfftfreq(N_FFT, 1.0 / SR)
    full_n = int(np.ceil(len(x) / SR * fps))                  # grid anchored at 0 -> normalisation reference
    out: dict[str, np.ndarray] = {}
    for name, (f0, f1) in BANDS.items():
        sel = (freqs >= f0) & (freqs < f1) & (freqs > 0)
        p = power[:, sel].sum(axis=1)
        ref_db = 10 * np.log10(np.percentile(frame_reduce(p, t_k, 0.0, full_n, fps, "mean"), REF_PCT) + 1e-12)
        db = 10 * np.log10(frame_reduce(p, t_k, offset, n_frames, fps, "mean") + 1e-12)
        out[name] = np.clip((db - (ref_db - DB_RANGE)) / DB_RANGE, 0.0, 1.0)
    # onset strength: half-wave-rectified spectral flux of log-compressed magnitude, minus a moving-median
    # baseline (removes steady noise/crackle so onsets keep contrast), max within each frame window
    power_o, t_o = stft_power(x, N_FFT_ONSET)
    logmag = np.log1p(100.0 * np.sqrt(power_o))
    flux = np.concatenate([[0.0], np.maximum(np.diff(logmag, axis=0), 0.0).sum(axis=1)])
    baseline = median_filter(flux, size=ONSET_BASELINE, mode="nearest", origin=ONSET_BASELINE // 2)  # past only
    flux = np.maximum(flux - baseline, 0.0)
    ref = np.percentile(frame_reduce(flux, t_o, 0.0, full_n, fps, "max"), REF_PCT) + 1e-12
    out["onset"] = np.clip(frame_reduce(flux, t_o, offset, n_frames, fps, "max") / ref, 0.0, 1.0)
    return {"fps": fps, **{k: [round(float(v), ROUND_E) for v in out[k]] for k in ("sub", "bass", "mid", "high", "onset")}}


def window(times: np.ndarray, offset: float, duration: float) -> list[float]:
    sel = times[(times >= offset - 1e-9) & (times < offset + duration - 1e-9)] - offset
    return [round(float(t), ROUND_T) for t in sel]


def bpm_of(beats: list[float]) -> float | None:
    if len(beats) < 2:
        return None
    return round(60.0 / float(np.median(np.diff(beats))), 2)


def meter_of(beats: list[float], downbeats: list[float]) -> tuple[int | None, float | None]:
    """Mode of beats-per-bar between consecutive downbeats, and the share of bars that agree with it."""
    if len(downbeats) < 2:
        return None, None
    b = np.asarray(beats)
    counts = [int(np.sum((b >= d0 - 1e-6) & (b < d1 - 1e-6))) for d0, d1 in zip(downbeats, downbeats[1:])]
    vals, cnt = np.unique(counts, return_counts=True)
    return int(vals[np.argmax(cnt)]), round(float(cnt.max() / cnt.sum()), 3)   # mode (ties -> smallest), share


def analyze(path: Path, fps: int, offset: float = 0.0, duration: float | None = None,
            model: str = "final0", device: str = "cpu") -> dict:
    t0 = time.perf_counter()
    x = decode(path)
    t1 = time.perf_counter()
    total = len(x) / SR
    if duration is None:
        duration = total - offset
    duration = max(0.0, min(duration, total - offset))
    n_frames = int(round(duration * fps))
    beats_all, downs_all = track_beats(x, SR, model, device)
    t2 = time.perf_counter()
    env = envelopes(x, fps, offset, n_frames)
    t3 = time.perf_counter()
    print(f"decode {t1 - t0:.3f}s  beats[{model}/{device}] {t2 - t1:.3f}s  envelopes {t3 - t2:.3f}s  "
          f"(audio {total:.2f}s)", file=sys.stderr)
    beats = window(beats_all, offset, duration)
    downbeats = window(downs_all, offset, duration)
    meter, meter_conf = meter_of(beats, downbeats)
    return {
        "version": 1,
        "source": {"sha256": sha256_file(path), "duration": round(total, ROUND_T), "offset": round(offset, ROUND_T)},
        "analysis": {"model": f"beat_this:{model}", "device": device, "sr": SR, "n_fft": N_FFT,
                     "n_fft_onset": N_FFT_ONSET, "onset_baseline_hops": ONSET_BASELINE, "hop": HOP,
                     "frame_assign": "stft-window-end",
                     "band_db_range": DB_RANGE, "ref_percentile": REF_PCT},
        "duration": round(duration, ROUND_T),
        "beats": beats,
        "downbeats": downbeats,
        "bpm": bpm_of(beats),
        "meter_guess": meter,
        "meter_confidence": meter_conf,
        "envelopes": env,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("audio", type=Path)
    ap.add_argument("--fps", type=int, choices=(30, 60), required=True)
    ap.add_argument("--offset", type=float, default=0.0, help="clip start in the audio file (s); output t=0 here")
    ap.add_argument("--duration", type=float, default=None, help="clip length (s); default: to end of file")
    ap.add_argument("--model", default="final0", help="Beat This! checkpoint: final0 (78 MB) | small0 (8 MB) | path")
    ap.add_argument("--device", default="cpu", choices=("cpu", "mps"))
    ap.add_argument("-o", "--out", type=Path, required=True)
    a = ap.parse_args()
    if a.offset < 0:
        ap.error("--offset must be >= 0")
    doc = analyze(a.audio, a.fps, a.offset, a.duration, a.model, a.device)
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps(doc, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
