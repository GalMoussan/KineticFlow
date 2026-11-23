"""Envelope evidence: frame-alignment of onset/bass envelopes against the KNOWN kick grid of reel 12, plus plots.

    uv run --group eval envelope_check.py

reel 12 kicks: every beat 0.5 + 0.5k s up to 22.5 s (+ stinger kick at 23.0), none in the drop 12.0-13.0 s.
For each kick at time tau, the 'kick frame' is floor(tau*fps) (the video frame whose window contains tau).
Reports the distribution of (onset-peak frame - kick frame) and (largest bass rise frame - kick frame) in +-3 frames.
"""
from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from analyze import analyze

HERE = Path(__file__).parent
OUT = HERE / "out"
KICKS = [0.5 + 0.5 * k for k in range(46) if not (12.0 <= 0.5 + 0.5 * k < 13.0)]


def offsets(env: np.ndarray, fps: int, diff: bool) -> dict[int, int]:
    res: dict[int, int] = {}
    for tau in KICKS:
        f = int(np.floor(tau * fps + 1e-9))
        if diff:
            w = np.diff(env[f - 4:f + 4])           # w[j] = env[f-3+j] - env[f-4+j]
        else:
            w = env[f - 3:f + 4]
        d = int(np.argmax(w)) - 3
        res[d] = res.get(d, 0) + 1
    return dict(sorted(res.items()))


def plot(doc: dict, title: str, path: Path, zoom: tuple[float, float] | None = None) -> None:
    e = doc["envelopes"]
    fps = e["fps"]
    t = np.arange(len(e["sub"])) / fps
    names = ["sub", "bass", "mid", "high", "onset"]
    fig, axes = plt.subplots(len(names), 1, figsize=(14, 9), sharex=True)
    for ax, n in zip(axes, names):
        ax.step(t, e[n], where="post", lw=0.9)
        for b in doc["beats"]:
            ax.axvline(b, color="0.75", lw=0.5, zorder=0)
        for d in doc["downbeats"]:
            ax.axvline(d, color="tab:red", lw=0.9, alpha=0.6, zorder=0)
        ax.set_ylabel(n)
        ax.set_ylim(-0.02, 1.02)
    if zoom:
        axes[-1].set_xlim(*zoom)
    axes[-1].set_xlabel("video time (s); grey = detected beats, red = detected downbeats")
    fig.suptitle(title)
    fig.tight_layout()
    fig.savefig(path, dpi=110)
    plt.close(fig)


def main() -> None:
    for fps in (30, 60):
        doc = analyze(HERE / "audio/reel12.wav", fps)
        e = {k: np.asarray(v) for k, v in doc["envelopes"].items() if k != "fps"}
        print(f"reel12 @{fps}fps  onset peak - kick frame: {offsets(e['onset'], fps, False)}  "
              f"bass max rise - kick frame: {offsets(e['bass'], fps, True)}  "
              f"sub max rise - kick frame: {offsets(e['sub'], fps, True)}")
        if fps == 60:
            plot(doc, "reel 12 (120 bpm, known grid) - envelopes @60 fps", OUT / "envelopes_reel12_60fps.png")
            plot(doc, "reel 12 zoom 8-12 s @60 fps", OUT / "envelopes_reel12_60fps_zoom.png", (8.0, 12.0))
    doc = analyze(HERE / "audio/it_had_to_be_you_1924.oga", 30, offset=30.0, duration=26.0)
    plot(doc, "It Had to Be You (1924), offset 30 s, 26 s @30 fps", OUT / "envelopes_ihtby_30fps.png")


if __name__ == "__main__":
    main()
