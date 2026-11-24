"""Reel Studio music-ai add-on: one ACE-Step 1.5 text-to-music clip → WAV (PLAN.md §8.2 'AI music').

    sidecar/music-ai/.venv/bin/python sidecar/music-ai/generate.py --models assets/models/ace-step \
        --prompt "warm lofi hip hop, rhodes, vinyl" [--lyrics "..."] --duration 30 [--bpm 96] --seed 7 -o out.wav

- Model: the 2B `acestep-v15-turbo` DiT (8 steps, shift 3) with the VAE, text encoder and DiT on Apple's MLX when
  available (ACE-Step's own macOS path), PyTorch MPS/CPU otherwise. The 5 Hz LM ("thinking") is off: it adds
  ~1 min and a sampled, non-reproducible plan; the DiT alone follows the caption, bpm and lyrics.
- Instrumental unless lyrics are given. `--bpm` is a hint (the model follows it closely; beats are re-detected by
  the analysis sidecar either way).
- Output: 48 kHz stereo float WAV, exactly `round(duration · 48000)` frames, peak-normalised to −1 dBFS.
- Never downloads: the checkpoints come from `reelgen setup music-ai`.

stdout: `progress <0..1> <stage>` lines while it runs, then one JSON line with timings. Exit codes: 0 ok, 2 bad
arguments, 4 models missing, 5 generation failed.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

SR = 48000
DIT = "acestep-v15-turbo"


def say(*a: object) -> None:
    print(*a, flush=True)


def write_wav(path: Path, y: "np.ndarray") -> None:
    """32-bit float stereo WAV with a plain header: libsndfile adds a PEAK chunk with a timestamp, so identical
    samples would hash differently."""
    import struct

    data = y.T.astype("<f4").tobytes()
    fmt = struct.pack("<HHIIHH", 3, 2, SR, SR * 8, 8, 32)
    with path.open("wb") as f:
        f.write(b"RIFF" + struct.pack("<I", 4 + 8 + len(fmt) + 8 + len(data)) + b"WAVE")
        f.write(b"fmt " + struct.pack("<I", len(fmt)) + fmt)
        f.write(b"data" + struct.pack("<I", len(data)) + data)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--models", type=Path, required=True)
    ap.add_argument("--prompt", required=True)
    ap.add_argument("--lyrics", default="")
    ap.add_argument("--duration", type=float, required=True)
    ap.add_argument("--bpm", type=int, default=None)
    ap.add_argument("--seed", type=int, required=True)
    ap.add_argument("--steps", type=int, default=8)
    ap.add_argument("--device", default="auto", choices=("auto", "mps", "cpu"))
    ap.add_argument("-o", "--out", type=Path, required=True)
    a = ap.parse_args()
    if not (10 <= a.duration <= 240):
        print("--duration must be 10–240 s", file=sys.stderr)
        return 2
    models = a.models.resolve()
    for need in (DIT, "vae", "Qwen3-Embedding-0.6B"):
        if not (models / need).is_dir():
            print(f"missing {models / need}; run `reelgen setup music-ai`", file=sys.stderr)
            return 4

    # ACE-Step reads its checkpoints from here and must not reach the network.
    os.environ["ACESTEP_CHECKPOINTS_DIR"] = str(models)
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

    t0 = time.time()
    say("progress 0.02 loading")
    from loguru import logger

    logger.remove()
    logger.add(sys.stderr, level="WARNING")
    import numpy as np
    import torch
    from acestep.handler import AceStepHandler
    from acestep.inference import GenerationConfig, GenerationParams, generate_music
    from acestep.llm_inference import LLMHandler

    device = a.device
    if device == "auto":
        device = "mps" if torch.backends.mps.is_available() else "cpu"
    dit = AceStepHandler()
    status, ok = dit.initialize_service(project_root=str(models.parent), config_path=DIT, device=device, use_mlx_dit=True)
    if not ok:
        print(f"ACE-Step failed to load: {status}", file=sys.stderr)
        return 4
    t_load = time.time() - t0
    say("progress 0.15 generating")

    def progress(value: float, desc: str | None = None, **_: object) -> None:
        say(f"progress {0.15 + 0.8 * max(0.0, min(1.0, float(value))):.3f} {(desc or 'generating').strip().replace(chr(10), ' ')}")

    instrumental = not a.lyrics.strip()
    params = GenerationParams(
        task_type="text2music",
        caption=a.prompt,
        lyrics="[Instrumental]" if instrumental else a.lyrics,
        instrumental=instrumental,
        bpm=a.bpm,
        timesignature="4",
        duration=a.duration,
        inference_steps=a.steps,
        seed=a.seed,
        shift=3.0,
        infer_method="ode",
        thinking=False,
        use_cot_metas=False,
        use_cot_caption=False,
        use_cot_language=False,
    )
    config = GenerationConfig(batch_size=1, use_random_seed=False, seeds=[a.seed], audio_format="wav")
    t1 = time.time()
    result = generate_music(dit, LLMHandler(), params, config, save_dir=None, progress=progress)
    t_gen = time.time() - t1
    if not result.success or not result.audios:
        print(f"generation failed: {result.error or result.status_message}", file=sys.stderr)
        return 5
    audio = result.audios[0]
    x = audio["tensor"].float().cpu().numpy()  # [channels, samples]
    sr = int(audio.get("sample_rate", SR))
    if x.ndim == 1:
        x = x[None, :]
    if x.shape[0] == 1:
        x = np.repeat(x, 2, axis=0)
    if sr != SR:
        print(f"unexpected sample rate {sr}", file=sys.stderr)
        return 5
    frames = round(a.duration * SR)
    y = np.zeros((2, frames), dtype=np.float32)
    n = min(frames, x.shape[1])
    y[:, :n] = x[:2, :n]
    peak = float(np.max(np.abs(y))) or 1.0
    y *= 10 ** (-1 / 20) / peak

    a.out.parent.mkdir(parents=True, exist_ok=True)
    tmp = a.out.with_suffix(".part.wav")
    write_wav(tmp, y)
    tmp.replace(a.out)
    say("progress 1 done")
    say(json.dumps({"device": device, "mlx": bool(getattr(dit, "use_mlx_dit", False)), "load_s": round(t_load, 1),
                    "generate_s": round(t_gen, 1), "total_s": round(time.time() - t0, 1), "frames": frames,
                    "model_frames": int(x.shape[1]), "peak_in": round(peak, 4)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
