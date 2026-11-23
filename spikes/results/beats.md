# M0f: Beat This! via uv on M1, with per-frame band envelopes

**Verdict: PASS WITH CAVEATS**

Beat This! 1.1.0 installs with uv on Python 3.12 / M1 without any workarounds. On the three synthesized reels with known
grids it scores beat F = 0.989–1.000 and downbeat F = 1.000 (70 ms tolerance) in the rhythmic span. It analyses a 26 s
clip in 0.30 s and a 3 min track in 2.4 s on CPU (warm model). The full CLI, including Python and torch start-up, takes
about 2.0 s for 26 s and 6.1–6.4 s for 3 min. `analyze.py` output is byte-identical on reruns and identical between CPU
and MPS.

The caveats are listed in §6: a 20 ms output grid, phantom beats over the final sustained chord, an unreliable meter on
ambiguous music, a 719 MB venv, and a checkpoint that is downloaded at runtime by default.

Machine: Apple M1 Pro (10 cores), macOS. Versions: Python 3.12.13, beat-this 1.1.0, torch 2.15.0, torchaudio
2.11.1, numpy 2.5.5, scipy 1.18.1, soxr 1.1.0, ffmpeg 9.0.2. Another M0 spike was rendering on the same machine during
these runs, so CPU timings carry some noise. The repeated runs below show the spread.

---

## 1. Install

| What | Measured |
|---|---|
| Install spec | `uv add beat-this numpy scipy`. beat-this comes from PyPI (`beat-this==1.1.0`) and pulls `torch`, `torchaudio`, `einops`, `rotary-embedding-torch`, `soxr`. The git/zip spec is not needed. |
| Cold install time (empty uv cache, `UV_CACHE_DIR=$(mktemp -d)`) | **99.8 s** wall: resolve 2.2 s, download/prepare 1 m 37 s (torch wheel 132.1 MiB), install 0.2 s |
| Eval-only extras (`uv add --group eval mir_eval matplotlib`) | 4.7 s |
| `.venv` size, runtime deps only | **719 MB** (torch 569 MB, scipy 73 MB, sympy 29 MB, numpy 23 MB) |
| `.venv` size with the eval group | 795 MB |
| Checkpoint download | Automatic on first use through `torch.hub.load_state_dict_from_url` from `https://cloud.cp.jku.at/public.php/dav/files/7ik4RrBKTS273gp/<name>.ckpt` |
| Checkpoint cache location | `~/.cache/torch/hub/checkpoints/beat_this-final0.ckpt` (81,058,141 B, sha256 `8c328b45…eb8331`) and `beat_this-small0.ckpt` (8,451,101 B, sha256 `6074be2c…c7d47b`). The location follows `TORCH_HOME`. |
| First run including the final0 download | 53.2 s wall (stderr: `beats 52.7 s`). Later runs spend about 1.3 s in that same step, so `[INFERENCE]` about 51 s of it is the 81 MB download. |
| torch and MPS | `torch.backends.mps.is_available() == True`. Beat This! runs on `device="mps"` unmodified. |

Note: torch 2.15.0 is paired with torchaudio 2.11.1. Beat This! only uses `torchaudio.transforms.MelSpectrogram`, and that
works. `analyze.py` decodes audio itself with ffmpeg, so torchaudio's I/O backends are never used.

## 2. Accuracy on known grids (dilemaCafe reels)

The ground truth comes from reading each score script in `~/projects/dilemaCafe/OpenKatana/projects/dilemma-reel/`.
Audio was extracted from `~/projects/dilemaCafe/reel/dilemma-cafe-reel-{9,11,12}.mp4` (48 kHz stereo, 26.000 s).

| Reel | Script | BPM | T0 | Meter | Rhythmic span | Notes |
|---|---|---|---|---|---|---|
| 9 | `make_score9.py` | 120 | 0.5 s | 4/4 | 0.5–23.5 s (47 beats) | Drums stop for 12.0–14.5 s (arp and pads continue); ending chord from 23.5 s |
| 11 | `make_score11.py` | 100 | 0.5 s | 4/4 | 0.5–23.3 s (39 beats) | Swung hats (offbeat at 0.58 beat); drums only from bar 2; final chord on beat 38 = 23.3 s |
| 12 | `make_score12.py` | 120 | 0.5 s | 4/4 | 0.5–23.0 s (46 beats) | Drop at 12.0–13.0 s (no kick/bass); stinger kick on beat 45 = 23.0 s |

Scoring uses `mir_eval.beat.f_measure` with a 70 ms tolerance and no 5 s trimming, on two windows:

- **rhythmic**: reference grid from T0 to the last on-grid musical event. Estimates count if `t < END + beat/2`.
- **full**: reference grid continued to 26 s. All estimates count. This penalises the tracker for not inventing beats
  over the sustained end chord, so it is a worst-case view.

| Track | Model | Window | ref/est beats | **F beat** | ref/est downbeats | **F downbeat** | Mean err (ms) | Max \|err\| (ms) | Downbeats within 1 frame @30 | Downbeats within 1 frame @60 | Median BPM |
|---|---|---|---|---|---|---|---|---|---|---|---|
| reel9 | final0 | rhythmic | 47/47 | **1.000** | 12/12 | **1.000** | +3.8 | 20.0 | 1.00 | 1.00 | 120.00 |
| reel9 | final0 | full | 51/48 | 0.970 | 13/13 | 0.923 | +3.7 | 20.0 | 0.92 | 0.92 | 120.00 |
| reel11 | final0 | rhythmic | 39/39 | **1.000** | 10/10 | **1.000** | +5.1 | 20.0 | 1.00 | 1.00 | 100.00 |
| reel11 | final0 | full | 43/43 | 1.000 | 11/11 | 1.000 | +4.7 | 20.0 | 1.00 | 1.00 | 100.00 |
| reel12 | final0 | rhythmic | 46/47 | **0.989** | 12/12 | **1.000** | +1.3 | 20.0 | 1.00 | 1.00 | 120.00 |
| reel12 | final0 | full | 51/49 | 0.960 | 13/13 | 0.923 | +1.2 | 20.0 | 0.92 | 0.92 | 120.00 |
| reel9 | small0 | rhythmic | 47/48 | 0.989 | 12/12 | 1.000 | +11.5 | 20.0 | 1.00 | 0.50 | 120.00 |
| reel9 | small0 | full | 51/52 | 0.990 | 13/13 | 1.000 | +10.6 | 20.0 | 1.00 | 0.46 | 120.00 |
| reel11 | small0 | rhythmic | 39/39 | 1.000 | 10/10 | 1.000 | +14.4 | 20.0 | 1.00 | 0.50 | 100.00 |
| reel11 | small0 | full | 43/43 | 1.000 | 11/11 | 1.000 | +15.3 | 60.0 | 1.00 | 0.45 | 100.00 |
| reel12 | small0 | rhythmic | 46/47 | 0.989 | 12/12 | 1.000 | +3.9 | 20.0 | 1.00 | 0.92 | 120.00 |
| reel12 | small0 | full | 51/49 | 0.960 | 13/13 | 0.923 | +4.6 | 20.0 | 0.92 | 0.85 | 120.00 |

Details I checked by hand:

- The one false positive on reel 12 is a beat at **0.00 s**, before T0. The likely trigger is the whoosh that starts at
  0.08 s into the first wipe.
- On both 120 bpm reels the last detections are `22.5, 23.02, 23.5, 24.0`, plus a downbeat at **24.0** that is off the
  grid. The model keeps "beating" for about one second over the sustained end chord, then stops. That accounts for the
  full-window misses and the extra downbeat.
- The swung hats on reel 11 did not confuse it: F = 1.000, BPM 100.00.

## 3. Real recordings (no ground truth)

| Track | Source / licence | Duration | Detected BPM (median) | IBI p5..p95 | Meter guess (confidence) | small0 vs final0 F beat / downbeat | Onset at beats ÷ median onset |
|---|---|---|---|---|---|---|---|
| Isham Jones & his Orchestra, "It Had to Be You" (1924) | <https://commons.wikimedia.org/wiki/File:Isham_Jones_&_his_Orchestra_-_%22It_Had_to_Be_You%22_(1924).oga>. **Public domain** (Commons LicenseShortName "Public domain"). File sha1 `1b87b817…8ac00f` | 179.6 s | **176.5** | 0.320..0.360 s | 4 (100 % of bars) | 0.949 / 0.957 | 1.80× |
| "Beat, electronic" (PDSounds #363) | <https://commons.wikimedia.org/wiki/File:Beat_electronic.ogg>. **Public domain**. File sha1 `8b6fff89…b3c5` | 120.7 s | **93.7** | 0.320..0.660 s | 2 (46 % of bars) | 0.664 / 0.320 | 19.8× |

- The 1924 foxtrot has a stable tempo (IBI p5–p95 within ±6 %), and the two independent models agree (F 0.95).
  `[INFERENCE]` 176 bpm is the cut-time pulse. A listener might tap half of that (88).
- "Beat, electronic" is a 20-minute home experiment with an ambiguous groove. The models disagree on downbeats (F 0.32),
  and bars come out as 1–10 beats long (meter confidence 0.46). This is the expected failure mode on such material:
  beats still land on onsets (19.8× onset contrast), but the downbeats and meter cannot be trusted there.
- **Listening check is still owed.** I could not listen to these. The click overlays for the user are listed below
  (high click = downbeat, low click = beat).

## 4. Speed

`bench.py` loads the model from the local cache, makes one first call, then takes the median of 3 warm calls. It covers
beat tracking only, on a 26 s clip (reel 11) and a 180 s track (It Had to Be You).

| Model | Device | Load (s) | Clip | First call (s) | **Warm median (s)** | Warm runs (s) | × realtime | Same result as CPU |
|---|---|---|---|---|---|---|---|---|
| final0 | cpu | 0.33 | 26 s | 0.31 | **0.30** | 0.30, 0.28, 0.31 | 87× | n/a |
| final0 | cpu | 0.33 | 180 s | 2.92 | **2.37** | 2.41, 2.36, 2.37 | 76× | n/a |
| final0 | mps | 0.49 | 26 s | 0.34 (5.13 on the very first MPS run) | **0.09** | 0.09, 0.10, 0.09 | 281× | yes |
| final0 | mps | 0.49 | 180 s | 0.86 (1.51 on the first run) | **0.70** | 0.70, 0.69, 0.70 | 258× | yes |
| small0 | cpu | 0.05 | 26 s | 0.29 | 0.22 | 0.24, 0.22, 0.21 | 117× | n/a |
| small0 | cpu | 0.05 | 180 s | 1.74 | 1.73 | 1.73, 1.73, 1.71 | 104× | n/a |
| small0 | mps | 0.17 | 26 s | 0.44 | 0.07 | 0.07, 0.07, 0.07 | 376× | yes |
| small0 | mps | 0.17 | 180 s | 0.64 | 0.51 | 0.51, 0.51, 0.51 | 351× | yes |

The first MPS call ever on this machine took 5.13 s. On later processes the first call took 0.34 s.
`[INFERENCE]` The difference is Metal kernel compilation, which is cached on disk afterwards.

Torch uses 8 threads by default. Other stages (from `bench.py` and the stderr of `analyze.py`):

- decode with ffmpeg: 90 ms for 26 s, 376 ms for 180 s
- envelopes at 60 fps: 162 ms for 26 s, 1.15 s for 180 s
- `import torch, beat_this.inference`: 0.67 s

End-to-end CLI wall time per run (`uv run analyze.py … --fps 60`, fresh process, 2 runs each):

| Clip | CPU | MPS |
|---|---|---|
| 26 s | 2.00 s, 1.96 s | 2.19 s, 2.15 s |
| 180 s | 6.09 s, 6.40 s | 4.71 s, 4.24 s |

## 5. `analyze.py` and envelopes

```
cd spikes/beats
uv run analyze.py <audio> --fps 30|60 [--offset s] [--duration s] [--model final0|small0] [--device cpu|mps] -o out.json
```

### Pipeline

1. ffmpeg decodes the first audio stream to mono f32 at 44.1 kHz.
2. Beat This! (final0, minimal postprocessing, no DBN) runs on the **full** track. The window
   `[offset, offset+duration)` is cut afterwards, and times are re-based so that t = 0 is the first video frame.

### Envelopes

- Band power comes from a numpy STFT (Hann window, n_fft 2048, hop 128 = 2.9 ms).
- Bands: sub < 60 Hz, bass 60–250 Hz, mid 250 Hz–2 kHz, high > 2 kHz.
- Each STFT frame goes to the video frame whose window `[i/fps, (i+1)/fps)` contains the STFT window's **end**. So no
  frame looks ahead into audio after its own window.
- Per frame, the band value is the mean power in dB, mapped to 0..1 over a 40 dB range that ends at the full track's
  99.5th percentile.
- `onset` is the half-wave-rectified spectral flux of log magnitude (n_fft 1024), minus a causal 0.4 s moving-median
  baseline. Per frame it takes the max, divided by the full track's 99.5th percentile and clipped to 0..1.
- Normalisation uses full-track statistics, so trimming the clip never rescales the values.

### Output

Output JSON (sorted keys, times rounded to 0.1 ms, envelope values to 1e-4, timings sent to stderr only):

```json
{"version":1,
 "source":{"sha256":"…","duration":179.5535,"offset":30.017},
 "analysis":{"model":"beat_this:final0","device":"cpu","sr":44100,"n_fft":2048,"n_fft_onset":1024,"hop":128,
             "onset_baseline_hops":139,"frame_assign":"stft-window-end","band_db_range":40.0,"ref_percentile":99.5},
 "duration":26.0, "beats":[…s], "downbeats":[…s], "bpm":176.47, "meter_guess":4, "meter_confidence":1.0,
 "envelopes":{"fps":30,"sub":[…],"bass":[…],"mid":[…],"high":[…],"onset":[…]}}
```

Each envelope array has `round(duration·fps)` entries. JSON size is 28 KB for 26 s at 30 fps and 188 KB for 180 s at
30 fps.

### Frame alignment

`envelope_check.py` checks alignment against the known kicks on reel 12 (44 kicks). The offset is the frame of the
envelope event minus `floor(kick·fps)`:

| fps | onset peak | bass largest rise | sub largest rise |
|---|---|---|---|
| 30 | 0 frames: 38 kicks, −1: 6 | 0: 44 | 0: 44 |
| 60 | 0: 38, −1: 6 | 0: 44 | 0: 37, +1: 7 |

The six −1 cases are exactly the score's `BIG` hits at 2.0, 3.0, 7.0, 14.0, 19.0 and 22.5 s. Their sub boom and crash
start at t − 0.01 s, and those kicks fall on a frame boundary. So the onset correctly lands in the earlier frame. An
earlier version used centred STFT frames and fired onsets one frame early (−1 for 39/44 kicks at 60 fps), which is why
it switched to end-of-window assignment.

### Determinism

`determinism.sh` runs each case twice in fresh processes, compares the SHA-256 of the JSON, then compares a CPU run
against an MPS run with the `device` field removed.

| Case | Run A | Run B | Rerun | CPU vs MPS |
|---|---|---|---|---|
| `audio/reel11.wav --fps 30` | 22d6d382002eb0d2 | 22d6d382002eb0d2 | **IDENTICAL** | same |
| `audio/reel12.wav --fps 60` | 26060cedba056679 | 26060cedba056679 | **IDENTICAL** | same |
| `audio/it_had_to_be_you_1924.oga --fps 60` | 2a0666945a53478c | 2a0666945a53478c | **IDENTICAL** | same |
| `audio/it_had_to_be_you_1924.oga --fps 30 --offset 30.017 --duration 26` | 1118f93f1707257f | 1118f93f1707257f | **IDENTICAL** | same |
| `audio/beat_electronic_pd.ogg --fps 60 --offset 10 --duration 26` | a85bad7f69b41366 | a85bad7f69b41366 | **IDENTICAL** | same |

### Evidence in `spikes/beats/out/`

- `envelopes_reel12_60fps.png` and `envelopes_reel12_60fps_zoom.png` (8–12 s): five envelopes with the detected beats
  (grey) and downbeats (red). Kicks show as sub/bass attacks, the clap as mid/high, offbeat hats as high and onset.
- `envelopes_ihtby_30fps.png`: the 1924 track, offset 30 s, 26 s. The old acoustic recording keeps the band envelopes
  high (0.5–1.0), because surface noise fills every band. The onset baseline subtraction keeps onset contrast.
- `click_it_had_to_be_you_1924.mp3`, `click_beat_electronic_pd.mp3`, `click_reel11.mp3`: click overlays to listen to.
  High click (1760 Hz) = downbeat, low click (1100 Hz) = beat.
- `reel11.json`, `ihtby_30.json`, `beat_electronic_30.json`: sample sidecar outputs.
- Raw tables: `eval_reels_cpu.md`, `bench.md`, `cli_wall.txt`, `real_tracks.md`, `envelope_check.txt`, `determinism.md`.

### Reproduce

```
cd spikes/beats
./fetch_audio.sh                                   # reel audio + 2 PD tracks (sha1-checked); audio/ is git-ignored
uv sync --group eval                               # or plain `uv run analyze.py …` for runtime deps only
uv run --group eval eval_reels.py                  # F-measure table (§2)
uv run --group eval real_tracks.py                 # real-track table (§3)
uv run bench.py                                    # speed table (§4)
uv run --group eval envelope_check.py              # alignment + PNGs (§5)
./determinism.sh                                   # determinism table (§5)
uv run analyze.py audio/it_had_to_be_you_1924.oga --fps 30 -o out/ihtby_30.json
uv run make_click.py audio/it_had_to_be_you_1924.oga out/ihtby_30.json -o out/click_it_had_to_be_you_1924.mp3
```

## 6. Failures and caveats

1. **20 ms output grid.** Beat This! picks peaks on its 50 fps logit grid. A deduplicated pair of peaks gives a 10 ms
   step.
   - On final0, the max |error| was 20 ms and the mean was +1.3 to +5.1 ms. That held 100 % of downbeats within ±1
     frame at 60 fps in the rhythmic span.
   - small0 is biased late (+4 to +15 ms mean) and only keeps 46–92 % of downbeats within 1 frame at 60 fps.
   - **The M3 criterion "±1 frame" holds for final0 only.**
2. **Phantom beats in the tail and the intro.** The model keeps beating for about 1 s over a sustained final chord
   (24.0 s on reels 9 and 12, including a false downbeat). It also marked a beat at 0.00 s on reel 12 (a whoosh).
3. **Meter on ambiguous music is unreliable.** On "Beat, electronic", meter_guess = 2 with confidence 0.46, and small0
   and final0 disagree on downbeats (F 0.32). Clear 4/4 (all reels, the 1924 track) gives confidence 1.0.
4. **Footprint.**
   - The venv is 719 MB, of which torch is 569 MB. The cold install took 99.8 s on this connection.
   - final0 adds 81 MB, downloaded from JKU's Nextcloud. By default this happens on the first call (about 50 s here),
     which conflicts with the "no network during a job" principle.
5. **MPS** gives identical results and is 3.4× faster on 3 min warm. However, the very first MPS call on a machine took
   5.1 s, and in a fresh CLI process MPS only wins for long tracks (4.2–4.7 s vs 6.1–6.4 s at 180 s). It loses slightly
   at 26 s (2.2 s vs 2.0 s).
6. Real-track correctness is **not verified by ear**. The model-agreement and onset-contrast numbers are proxies only.
7. Envelope scaling (40 dB range, p99.5 reference) is a starting point. On dense or noisy masters the bands sit at
   0.5–1.0 (see `envelopes_ihtby_30fps.png`). `[INFERENCE]` Styles will want their own shaping curve (gamma or
   attack/release) on the page side.

## 7. Recommendation for the M3 sidecar

- **Adopt Beat This! `final0`, minimal postprocessing (no DBN/madmom), on CPU by default.**
  - CPU is deterministic, identical to MPS, and a 26 s reel finishes in about 2 s end to end.
  - Use `--device mps` only for tracks longer than about 90 s `[INFERENCE: crossover from the 26 s and 180 s points]`.
  - Do not use small0: it fails the 60 fps ±1 frame bar.
- **Packaging.**
  - Run `sidecar/` as a uv project pinned by `uv.lock`, with the Python 3.12 + `beat-this==1.1.0` + `torch` +
    `numpy` + `scipy` stack measured here.
  - `reelgen setup` should download the checkpoint once into the app data directory. Verify its SHA-256 (final0
    `8c328b45f59d8dd3dff219253ff6a8d6482be57d0133a29140e2febbf8eb8331`), then pass the **local path** as
    `checkpoint_path`, or set `TORCH_HOME`. Never let `torch.hub` fetch during a job.
  - Decode with ffmpeg (as in `analyze.py`), not with torchaudio I/O.
- **CLI shape** (same as the spike):

  ```
  reel-sidecar analyze <audio> --fps 30|60 [--offset s] [--duration s] [--device cpu|mps] -o out.json
  ```

  Progress and timings go to stderr. Exit codes: 0 = ok, 2 = bad arguments, 3 = undecodable audio, 4 = model missing
  (run setup).
- **JSON schema v1**:
  - `version`
  - `source{sha256, duration, offset}`
  - `analysis{model, device, sr, n_fft, n_fft_onset, hop, onset_baseline_hops, frame_assign, band_db_range,
    ref_percentile}`
  - `duration`, `beats[s]`, `downbeats[s]`, `bpm` (median IBI), `meter_guess`, `meter_confidence`
  - `envelopes{fps, sub[], bass[], mid[], high[], onset[]}`: 0..1, length `round(duration·fps)`, frame i covers
    `[i/fps, (i+1)/fps)` of video time
  - All times are relative to the clip start. Sorted keys, fixed rounding, no timestamps.
- **Timing engine rules to add:**
  - Trust downbeats only when `meter_confidence ≥ 0.8`. Otherwise fall back to every 4th beat counted from the first
    strong downbeat, or ask the user in the UI.
  - Drop beats after the last bar where onset energy collapses, and before the first sustained onset. This removes the
    tail and intro phantoms.
  - For generated music, keep the analytic grid (`60/bpm`, T0). Do not analyse it.
- **Cache by audio hash** (content sha256 of the file bytes, not the path):
  1. `beats/<sha256>-<model>-<beat_this version>.json` holds the **full-track** beats and downbeats.
     - This is the expensive, offset-independent part: 0.3–2.4 s compute plus a 1–2 s torch start-up.
     - Any offset/duration trim is a pure function of this file.
  2. `env/<sha256>-<fps>-<offset>-<duration>-<envelope params hash>.json` holds the envelopes.
     - They are cheap (0.16–1.2 s), but caching avoids starting Python at all on re-render.
     - The full-track normalisation reference depends only on `<sha256, fps, params>`, so trims stay consistent.
  3. Invalidate on a change of beat-this/torch version (the lockfile hash) or the envelope parameters.
- **Avoid:**
  - the DBN path (per the Beat This! README it needs madmom from git, because the PyPI release only supports Python < 3.10 and numpy < 1.20)
  - torchaudio file loading
  - centred-STFT envelope assignment (one frame early)
  - normalising per clip (values would change when the trim changes)
  - runtime checkpoint downloads
