"""Mix a click track (downbeat = high click, beat = low click) over the analysed audio window -> MP3, for listening.

    uv run make_click.py <audio> <analysis.json> -o out/click.mp3
"""
from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path

import numpy as np

from analyze import SR, decode


def click(freq: float, gain: float, dur: float = 0.035) -> np.ndarray:
    t = np.arange(int(dur * SR)) / SR
    return (gain * np.sin(2 * np.pi * freq * t) * np.exp(-t / (dur / 5))).astype(np.float32)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("audio", type=Path)
    ap.add_argument("analysis", type=Path)
    ap.add_argument("-o", "--out", type=Path, required=True)
    a = ap.parse_args()
    doc = json.loads(a.analysis.read_text())
    x = decode(a.audio)
    start = int(round(doc["source"]["offset"] * SR))
    x = x[start:start + int(round(doc["duration"] * SR))] * 0.6
    downs = set(doc["downbeats"])
    hi, lo = click(1760.0, 0.5), click(1100.0, 0.35)
    for b in doc["beats"]:
        c = hi if b in downs else lo
        i = int(round(b * SR))
        n = min(len(c), len(x) - i)
        if n > 0:
            x[i:i + n] += c[:n]
    x = np.clip(x, -1.0, 1.0).astype("<f4")
    a.out.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-",
                    "-c:a", "libmp3lame", "-b:a", "160k", str(a.out)], input=x.tobytes(), check=True)


if __name__ == "__main__":
    main()
