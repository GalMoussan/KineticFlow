"""Time Beat This! inference on CPU vs MPS for a 26 s clip and a ~3 min track.

    uv run bench.py [--repeats 3]

Per (model, device): checkpoint load time (from the local torch hub cache), first call, then the median of
`repeats` warm calls. Audio decode and envelope time are measured separately (device-independent).
Also checks that MPS returns the same beat/downbeat times as CPU.
"""
from __future__ import annotations

import argparse
import statistics
import time
from pathlib import Path

import numpy as np
import torch

from analyze import SR, decode, envelopes

HERE = Path(__file__).parent
CLIPS = {"26s reel11": HERE / "audio/reel11.wav", "180s it_had_to_be_you": HERE / "audio/it_had_to_be_you_1924.oga"}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repeats", type=int, default=3)
    ap.add_argument("--models", nargs="+", default=["final0", "small0"])
    a = ap.parse_args()
    from beat_this.inference import Audio2Beats

    devices = ["cpu"] + (["mps"] if torch.backends.mps.is_available() else [])
    print(f"torch {torch.__version__}, threads {torch.get_num_threads()}, mps available "
          f"{torch.backends.mps.is_available()}")
    signals = {}
    for name, path in CLIPS.items():
        t = time.perf_counter()
        signals[name] = decode(path)
        td = time.perf_counter() - t
        t = time.perf_counter()
        env = envelopes(signals[name], 60, 0.0, int(round(len(signals[name]) / SR * 60)))
        te = time.perf_counter() - t
        print(f"{name}: decode {td * 1000:.0f} ms, envelopes@60fps {te * 1000:.0f} ms ({len(env['sub'])} frames)")
    print()
    print("| model | device | load_s | clip | first_call_s | warm_median_s | warm_runs_s | x_realtime | same_as_cpu |")
    print("|---|---|---|---|---|---|---|---|---|")
    ref: dict[tuple[str, str], tuple[np.ndarray, np.ndarray]] = {}
    for model in a.models:
        for dev in devices:
            t = time.perf_counter()
            tracker = Audio2Beats(checkpoint_path=model, device=dev, dbn=False)
            load = time.perf_counter() - t
            for name, x in signals.items():
                t = time.perf_counter()
                b, d = tracker(x, SR)
                if dev == "mps":
                    torch.mps.synchronize()
                first = time.perf_counter() - t
                runs = []
                for _ in range(a.repeats):
                    t = time.perf_counter()
                    b2, d2 = tracker(x, SR)
                    if dev == "mps":
                        torch.mps.synchronize()
                    runs.append(time.perf_counter() - t)
                b, d = np.asarray(b), np.asarray(d)
                same = "-"
                if dev == "cpu":
                    ref[(model, name)] = (b, d)
                else:
                    rb, rd = ref[(model, name)]
                    same = "yes" if (np.array_equal(rb, b) and np.array_equal(rd, d)) else \
                        f"no (beats {len(rb)}/{len(b)}, downs {len(rd)}/{len(d)})"
                med = statistics.median(runs)
                dur = len(x) / SR
                print(f"| {model} | {dev} | {load:.2f} | {name} | {first:.2f} | {med:.2f} | "
                      f"{', '.join(f'{r:.2f}' for r in runs)} | {dur / med:.0f}x | {same} |")


if __name__ == "__main__":
    main()
