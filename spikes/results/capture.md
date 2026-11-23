# M0a + M0b: capture throughput, GPU, determinism, motion blur, supersampling

**Verdict: PASS.**
- Headless Chromium on this M1 Pro uses the Metal GPU.
- Our own capture loop renders the reference reels **4–10× faster** than the OpenKatana path, writes no frame files,
  and survives 780 frames in one page.
- Motion blur via ffmpeg `tmix` works, and 2× supersampling works once the CDP `clip.scale` quirk is handled.
- **Caveat:** with the GPU on, pixels are reproducible across launches but can differ by 1–2/255 depending on the
  *order* frames are rendered in. That changes how the determinism gate must work (see the recommendations).

Machine: Apple M1 Pro (8P+2E), 32 GB. Chromium 159 (Playwright 1.65 `chrome-headless-shell`), ffmpeg 9.0.2.
The three other spikes were running at the same time (up to ~2.5 cores of Python), so absolute numbers are
conservative.

Test pages:
- `reel12` (flat Swiss, DOM + clip-path)
- `reel9` (neon: canvas particles, glow, grain, blur)
- `webgl` (fullscreen 6-octave fbm domain-warp shader + DOM type with glow + animated `wght`)

All are pure functions of `t`, at 1080×1920. reel9/reel12 are the unmodified dilemaCafe engines.

## 1. GPU availability (`gpu/probe.ts`)

| Launch mode | WebGL2 renderer | Launch ms |
|---|---|---|
| shell + `--disable-gpu` (OpenKatana) | SwiftShader (CPU) | 1753 |
| **shell + GPU flags** | **ANGLE Metal, Apple M1 Pro** | **148** |
| full Chromium, new headless | ANGLE Metal | 3614 |
| system Chrome 157, headless | ANGLE Metal | 471 |
| headed | ANGLE Metal | 914 |

GPU flags: `--use-angle=metal --enable-gpu-rasterization --ignore-gpu-blocklist`. **Risk retired:** no headed
fallback is needed.

## 2. Per-frame cost by capture method (`capture/bench.ts modes`, 40 frames sampled across a 13 s chunk, 1 worker)

Output frames per second:

| Page | OpenKatana: no GPU + `page.screenshot` PNG | GPU + `page.screenshot` PNG | GPU + CDP PNG (`optimizeForSpeed`) | GPU + CDP JPEG q92 |
|---|---|---|---|---|
| reel12 flat | 16.6 | 8.3 | 16.0 | **19.7** |
| reel9 neon | 1.87 | 1.86 | 9.85 | **19.7** |
| webgl | 3.2 | 3.4 | 11.9 | **19.7** |

- **The bottleneck was Playwright's `page.screenshot`, not the GPU.** On neon it takes 495–526 ms per frame, versus
  90 ms for CDP PNG and 33 ms for CDP JPEG. Neon frames are 2.8 MB PNGs because of the grain.
- Seeking the page (`render(t)` + double rAF) costs only 9–27 ms per frame on every page.
- The OpenKatana baseline is consistent with the spec: 390 neon frames at 1.87 fps ≈ 209 s (observed: 231 s).

## 3. Determinism with the GPU on (`capture/bench.ts determinism`, 6 frames per page, PNG pixel diff)

| Page | GPU: across launches (same order) | GPU: same launch, different order | CPU (`--disable-gpu`): either |
|---|---|---|---|
| reel12 | 0 px differ | 1 frame: max Δ 1/255 on 0.0002 % of pixels | 0 px |
| reel9 | 0 px | 3 frames: max Δ 1/255, ≤ 0.0011 % | 0 px |
| webgl | 0 px | 4 frames: max Δ 2/255, ≤ 1.16 % | 0 px |

Rendering order leaves sub-visible residue under GPU rasterisation, likely from the compositor reusing tiles
[INFERENCE]. A fixed chunk plan rendered in a fixed order is **byte-reproducible**. OpenKatana's forward-vs-reverse
hash check would **fail** with the GPU on.

## 4. End-to-end: the whole 26 s reel (`capture/bench.ts e2e <reel> <workers> <shot> [final]`)

Pipeline:
- N browsers each render a contiguous chunk and pipe frames into their own `ffmpeg` (libx264 `slow` CRF 14, BT.709,
  closed 2 s GOP).
- The chunks join with `concat -c copy` and are muxed with the original reel's audio as AAC 256k with `+faststart`.

| Reel | Workers | Capture | Wall time | Output (ffprobe) |
|---|---|---|---|---|
| reel12 flat | 4 | CDP PNG | **16.0 s** | 1080×1920, 780 frames, H.264 High, yuv420p, 26.000 s, 3.2 MB |
| reel9 neon | 4 | CDP PNG | 55.5 s | 780 frames, 26.000 s, 75 MB |
| reel9 neon | 4 | CDP JPEG q92 | **42.5 s** | 780 frames, 26.000 s, 91 MB |
| reel9 neon | 1 | CDP JPEG q92 | 52.4 s | 780 frames **in one page, no crash** (the OpenKatana 780-frame crash does not reproduce) |
| reel12 flat, **final preset** | 4 | CDP JPEG, 60 fps, 6 sub-frames, 2× | **201 s** | 1560 frames at 60 fps, 26.000 s, 4.1 MB (9360 captures at 2160×3840) |

- **Against OpenKatana:** observed there was ~35 s (flat) or ~231 s (neon) per 390-frame chunk, plus 31–151 s
  `start_render`, plus ~3.6 GB of frames on disk. The new path uses 0 bytes of frame files and the concat takes
  0.8–1.0 s.
- Adding workers helps neon only a little (52 → 42 s). With 4 parallel x264 `slow` encoders, **encoding becomes the
  bottleneck** on grainy content.

Encoder comparison: re-encoding the 780-frame neon reel, SSIM against the CRF 14 source.

| Encoder | Time | Size | SSIM |
|---|---|---|---|
| x264 slow CRF 14 | 28.5 s | 81 MB | 0.9943 |
| x264 medium CRF 18 | 13.7 s | 43 MB | 0.9870 |
| x264 fast CRF 18 | 11.4 s | 46 MB | 0.9870 |
| h264_videotoolbox q70 | 4.2 s | 35 MB | 0.9762 |
| h264_videotoolbox 12 Mb/s | 4.3 s | 38 MB | 0.9777 |

JPEG q92 vs PNG as the intermediate (neon, after x264): SSIM 0.984, PSNR 45.2 dB. The difference sits mostly in the
grain.

## 5. Quality levers (`capture/bench.ts quality`, 1 s of video at t = 2–3 s, 1 worker)

Seconds of wall time per second of video:

| Variant | reel9 neon, JPEG | reel12 flat, PNG | webgl, JPEG |
|---|---|---|---|
| standard (30 fps) | 3.0 | 2.1 | 2.8 |
| 2× supersample | 4.9 | — | — |
| motion blur, 6 sub-frames | — | 9.4 | — |
| **final** (60 fps + 6 sub-frames + 2×) | 43.5 | 35.3 | 42.7 |
| final with 4 sub-frames | 29.5 | — | — |

- **CDP quirk:** `Page.captureScreenshot` ignores `deviceScaleFactor` (it returns 1080×1920) unless the request
  carries `clip: {…, scale: 2}`. `page.screenshot` honours DPR, but it is the slow path. Measured in
  `capture/dpr.ts`.
- **Motion blur is correct:** sub-frames are sampled around each frame time (180° shutter). They are piped at
  `fps·S`, then `tmix=frames=S, select='eq(mod(n,S),S-1)', setpts=N/(fps*TB)`. Frame counts match exactly
  (30/30, 60/60).
- Visual evidence: `spikes/capture/out/motion-blur-sheet.png`. Top row is standard, bottom row is 6-sample blur, at
  the same timestamps. The slamming "וג׳אם" and the expanding ring smear in the direction of motion.

## Reproduce
```
cd spikes
node gpu/probe.ts
node capture/bench.ts modes
node capture/bench.ts determinism
node capture/bench.ts e2e 12 4 cdp-png          # or: e2e 9 4 cdp-jpeg / e2e 12 4 cdp-jpeg final
node capture/bench.ts quality reel9a.html cdp-jpeg standard,ss2,final,final-b4
node capture/dpr.ts
```
Results: `capture/out/*.jsonl` and `capture/out/*.mp4`.

## Recommendations for `packages/render`
1. **Launch:**
   - Use `chrome-headless-shell` with the GPU flags above, one browser per worker, a pool of 4.
   - Pin the Chromium build in a manifest and include it in the chunk cache key. GPU output may vary across builds
     [INFERENCE].
2. **Capture:**
   - Use CDP `Page.captureScreenshot` with `optimizeForSpeed: true` and an explicit `clip` whose `scale` = the
     supersample factor.
   - The default intermediate is **JPEG q95**. PNG is opt-in ("lossless intermediate") for flat styles, where it
     costs nothing.
   - Never use `page.screenshot`.
3. **Stream** frames into one ffmpeg per chunk (`image2pipe`), with no frame files. The chunk cache stores chunk MP4s.
4. **Encoders per preset:**

   | Preset | Encoder | Notes |
   |---|---|---|
   | draft | `h264_videotoolbox` | 4.2 s per 780 frames |
   | standard | x264 `medium` CRF 18 | |
   | final | x264 `slow` CRF 14 | |

   All presets: BT.709 tags, closed GOP at chunk boundaries, `concat -c copy`.
5. **Determinism gate:** replace the forward-vs-reverse check with two checks:
   - **(a) reproducibility:** re-render 3 sampled frames of the chunk *in the chunk's own order* in a fresh browser
     and compare hashes exactly.
   - **(b) order-independence:** a reverse-order check with tolerance max Δ ≤ 2/255. This still catches real
     `t`-impurity, which produces large diffs.
6. **Chunk plan:**
   - Keep boundaries stable (fixed 10 s chunks), so cached chunks and fresh renders follow the same order.
   - Seams between chunks differ by ≤ 2/255 at most, which is invisible.
7. **Final preset estimate:**
   - Measured: ~3.4 min for a flat 26 s reel on 4 workers.
   - Heavy styles: ~4–6 min [INFERENCE from the single-worker ratios].
   - Expose 4 sub-frames as the "fast final" option (−32 %).
