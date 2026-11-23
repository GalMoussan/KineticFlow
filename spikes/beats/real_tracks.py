"""Sanity numbers for the real recordings (no ground truth): tempo stability, final0 vs small0 agreement,
and beat-synchronous onset contrast.

    uv run --group eval real_tracks.py

- agreement: mir_eval F-measure (70 ms) of small0 beats against final0 beats (two independent models agreeing).
- onset contrast: mean onset envelope (30 fps) in the frame containing each detected beat vs the median frame;
  > 1 means detected beats sit on onsets.
"""
from __future__ import annotations

from pathlib import Path

import mir_eval
import numpy as np

from analyze import SR, decode, envelopes, track_beats

HERE = Path(__file__).parent
TRACKS = {
    "It Had to Be You (1924)": HERE / "audio/it_had_to_be_you_1924.oga",
    "Beat, electronic (PD)": HERE / "audio/beat_electronic_pd.ogg",
}


def main() -> None:
    print("| track | dur_s | beats | bpm_median | IBI p5..p95 (s) | downbeats | beats/bar mode (share) | "
          "F(small0 vs final0) beat | F downbeat | onset@beat / median onset |")
    print("|---|---|---|---|---|---|---|---|---|---|")
    for name, path in TRACKS.items():
        x = decode(path)
        b, d = track_beats(x, SR, "final0", "cpu")
        bs, ds = track_beats(x, SR, "small0", "cpu")
        ibi = np.diff(b)
        counts = [int(np.sum((b >= d0 - 1e-6) & (b < d1 - 1e-6))) for d0, d1 in zip(d, d[1:])]
        vals, cnt = np.unique(counts, return_counts=True)
        mode = int(vals[np.argmax(cnt)])
        share = cnt.max() / cnt.sum()
        fb = mir_eval.beat.f_measure(b, bs, f_measure_threshold=0.07)
        fd = mir_eval.beat.f_measure(d, ds, f_measure_threshold=0.07)
        n = int(np.ceil(len(x) / SR * 30))
        on = np.asarray(envelopes(x, 30, 0.0, n)["onset"])
        at_beats = on[np.minimum((b * 30).astype(int), n - 1)].mean()
        print(f"| {name} | {len(x) / SR:.1f} | {len(b)} | {60 / np.median(ibi):.1f} | "
              f"{np.percentile(ibi, 5):.3f}..{np.percentile(ibi, 95):.3f} | {len(d)} | {mode} ({share:.0%}) | "
              f"{fb:.3f} | {fd:.3f} | {at_beats / max(np.median(on), 1e-4):.2f} ({at_beats:.3f}/{np.median(on):.3f}) |")


if __name__ == "__main__":
    main()
