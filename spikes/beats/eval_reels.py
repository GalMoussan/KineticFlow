"""Score Beat This! against the known synthesized grids of the dilemaCafe reels.

    uv run --group eval eval_reels.py [--models final0 small0] [--device cpu]

Ground truth (read from OpenKatana/projects/dilemma-reel/make_score{9,11,12}.py):
  reel 9 : 120 bpm, T0 0.5 s, 4/4, drums+arp until 23.5 s (beat 46), drums out 12.0-14.5 (arp/pads continue)
  reel 11: 100 bpm, T0 0.5 s, 4/4, swung hats, last drum beat 22.7 s, final chord on beat 38 = 23.3 s
  reel 12: 120 bpm, T0 0.5 s, 4/4, drums until 22.5 s, stinger kick on beat 45 = 23.0 s, drop 12.0-13.0
Scoring: mir_eval F-measure, 70 ms tolerance, no 5 s trimming.
  'rhythmic' = reference grid T0..END (last on-grid musical event); estimates kept if t < END + beat/2.
  'full'     = reference grid continued to the end of the 26 s file; all estimates kept.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import mir_eval
import numpy as np

from analyze import SR, decode, track_beats

HERE = Path(__file__).parent
TRACKS = {  # name: (wav, bpm, t0, end_of_rhythm, file_duration)
    "reel9": (HERE / "audio/reel9.wav", 120, 0.5, 23.5, 26.0),
    "reel11": (HERE / "audio/reel11.wav", 100, 0.5, 23.3, 26.0),
    "reel12": (HERE / "audio/reel12.wav", 120, 0.5, 23.0, 26.0),
}
TOL = 0.07


def grid(bpm: float, t0: float, end: float) -> tuple[np.ndarray, np.ndarray]:
    beat = 60.0 / bpm
    b = t0 + beat * np.arange(int(np.floor((end - t0) / beat + 1e-9)) + 1)
    return b, b[::4]


def matched_err(ref: np.ndarray, est: np.ndarray) -> np.ndarray:
    """Signed est-ref error for each ref that has an estimate within TOL (nearest)."""
    if len(est) == 0:
        return np.array([])
    out = []
    for r in ref:
        e = est[np.argmin(np.abs(est - r))]
        if abs(e - r) <= TOL:
            out.append(e - r)
    return np.asarray(out)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", nargs="+", default=["final0", "small0"])
    ap.add_argument("--device", default="cpu")
    a = ap.parse_args()
    rows = []
    for name, (wav, bpm, t0, end, dur) in TRACKS.items():
        x = decode(wav)
        for model in a.models:
            beats, downs = track_beats(x, SR, model, a.device)
            beat = 60.0 / bpm
            for mode in ("rhythmic", "full"):
                stop = end if mode == "rhythmic" else dur - 1e-6
                rb, rd = grid(bpm, t0, stop)
                lim = end + beat / 2 if mode == "rhythmic" else dur
                eb, ed = beats[beats < lim], downs[downs < lim]
                fb = mir_eval.beat.f_measure(rb, eb, f_measure_threshold=TOL)
                fd = mir_eval.beat.f_measure(rd, ed, f_measure_threshold=TOL)
                err_b, err_d = matched_err(rb, eb), matched_err(rd, ed)
                in30 = float(np.mean(np.abs(err_d) <= 1 / 30 + 1e-9)) * len(err_d) / len(rd)
                in60 = float(np.mean(np.abs(err_d) <= 1 / 60 + 1e-9)) * len(err_d) / len(rd)
                med_bpm = 60.0 / np.median(np.diff(eb)) if len(eb) > 1 else float("nan")
                rows.append((name, model, mode, len(rb), len(eb), fb, len(rd), len(ed), fd,
                             np.mean(err_b) * 1000 if len(err_b) else float("nan"),
                             np.max(np.abs(err_b)) * 1000 if len(err_b) else float("nan"), in30, in60, med_bpm))
    hdr = ("track", "model", "window", "ref_b", "est_b", "F_beat", "ref_db", "est_db", "F_down",
           "mean_err_ms", "max|err|_ms", "db<=1f@30", "db<=1f@60", "bpm")
    print("| " + " | ".join(hdr) + " |")
    print("|" + "---|" * len(hdr))
    for r in rows:
        print(f"| {r[0]} | {r[1]} | {r[2]} | {r[3]} | {r[4]} | {r[5]:.3f} | {r[6]} | {r[7]} | {r[8]:.3f} | "
              f"{r[9]:+.1f} | {r[10]:.1f} | {r[11]:.2f} | {r[12]:.2f} | {r[13]:.2f} |")


if __name__ == "__main__":
    main()
