# Sketch & Line overlays: plan

Source brief: `out/sketch/BRIEF.md` (Nov 24, 2026). This file records what the P0 spikes found, the decisions taken, every change to the brief, and the phase plan. **Approved by the user on Nov 25, 2026, with SK1 as written (matisse for photos).** P1 has started.

Spike evidence (all in the `sketch` worktree):
- reports: `out/sketch/{SketchImage,SketchLLM,SketchRender}-report.md`, `out/sketch/S6-ux.md`
- contact sheets: `out/dev/sketch-spikes/`
- docs: `out/sketch/S1..S3/`

## 1. Spike results

### S1: description → LLM strokes (`s1-stand-in.png`, `s1-stand-in-detail.png`)
No Gemini or Claude key exists on this machine, and the Grok stand-in ran out of balance before it was called. **The only measured column is a stand-in:** a coding agent wrote the 36 responses in one pass, from the exact prompt and schema. They went through the real parse → normalize → join → sheet path. This tests the pipeline, not how Gemini or Claude draw.

| Finding | Value |
| --- | --- |
| Valid before / after `normalize()` | 36/36 / 36/36 |
| Determinism (two replays) | byte-identical |
| Encoding | one string per stroke, `"x,y x,y …"`: 42.6k chars vs 53.1k nested arrays (−20 %, ≈ −23 % tokens) |
| Sketch mode | 12/12 read as the subject (incl. `מוח`, `כוס קפה`); detail 1 → 5 scales well |
| Line mode, model writes one planned line | 12/12 read; 7/12 have a long straight jump across the drawing; worse at detail 5 |
| Line built by chaining Sketch strokes | connectors are 38 % of the length (23 % nearest-next); scribbled over in every cell. **Not usable.** |
| Output budget | detail 5 needs > 4096 output tokens; the spike used 16384 |

Run the real columns once keys exist: `node packages/render/dev/sketch/SketchLLM-run.ts --providers gemini,claude`.

### S2: image → one Line (`s2-line.png`, `s2-line-progress.png`)

| Engine | Time / image (M1) | Deterministic | Look |
| --- | --- | --- | --- |
| spiralist **matisse** (MIT; ONNX informative-drawings MIT + MediaPipe Apache, wasm CPU) | ≈ 4.4 s inference, 4.6–7.1 s wall with browser | yes | **Most elegant** on portrait and cup, and draws the features first (eyes, nose, mouth, then contour), a delight to watch. **Garbles Hebrew letters** on the logo. The scenes don't read. |
| spiralist contour | same run | yes | Logo text reads but the "8" is gone; the portrait doesn't read; frame lines appear |
| own stipple tour | 0.9–1.3 s | yes | A maze or TSP-art texture; fills region by region. **Rejected.** |
| own **sketch chain** (S3 strokes, 2-opt order, straight connectors) | 0.6–1.1 s | yes | Reads on 4/5, including **correct Hebrew letters**. Connectors are 26–36 % of the line and look scrappy. |

### S3: image → Sketch (`s3-sketch.png`, `s3-xdog-vs-canny.png`, `s3-sketch-order.png`)
- Pipeline: XDoG, skeletonise, own tracer, RDP, outline-first order. XDoG beats Canny: one line per dark feature, and 15–45 % fewer points.
- Logo, portrait, cup and landscape read at detail ≥ 3. The logo keeps every Hebrew letter. The pencil etching doesn't read at any detail; no engine handles it.
- Speed: 0.5–1.2 s per image including Python start-up; the pipeline alone is 59–633 ms. The target was < 10 s. ✓
- Determinism: 20/20 byte-identical across two fresh processes.

### S4: per-frame page cost of draw-on (6000 points, 1080×1920, `s4-drawon.png`)
The overlay's own cost per frame, median / p95 ms. Measured on GPU raster with the renderer's launch flags, 120 frames, 3 runs under load. The target was < 4 ms.

| Mode | Approach | Cost | Verdict |
| --- | --- | --- | --- |
| Line | fixed path + `stroke-dashoffset` per frame | 0.16–0.20 / 0.27–0.29 | **chosen** |
| Line | rebuild the visible prefix per frame | 0.50–0.55 / 0.70–0.71 | ok, not needed |
| Sketch | perfect-freehand outlines precomputed at `ready()` | 0.45–0.48 / 0.60–0.63 | **chosen** |
| Sketch | every outline recomputed per frame | 7.1–7.3 / 16.6–17.1 | ✗ |
| Sketch, boil | jitter pass rebuilt every 4 frames (as briefed) | 0.62–0.64 / 9.5–9.9 | ✗ at p95 |
| Sketch, boil | **boil-shift**: precomputed outlines, the jitter pass moved by a per-stroke `translate` every 4 frames | 0.83–0.86 / 1.50–1.57 | **chosen** |

- **Seek order:** all approaches are pixel-identical (0/255) in reverse, shuffled, history and fresh-browser order, on GPU and CPU raster.
- **Real docs:** the 35 real S2/S3 docs cost less than the synthetic worst case (p95 ≤ 1.53 ms).
- **Baseline:** the dilemma page's own work is ≈ 1.14 ms per frame. A visible sketch adds ≈ 0.8 ms main thread + ≈ 1 ms raster. That is under 4 % of a captured frame, but +40–90 % of the page's own work.

### S5: determinism with one sketch in the real page (`s5-stills-*.png`)
- **Setup:** one sketch on section 2, in kinetic-quote (sketch mode, boil-shift) and chalkboard-cafe (line mode, dash), all 4 formats.
- **Determinism:** `stills.ts` checks (a), (b), (c) all pass, 0/255. The checks were also re-run on 7 frames inside the sketch window: 0/255 on CPU raster, ≤ 2/255 on GPU.
- **Fingerprints:**
  - Without the sketch, all 24 windows match main, and the stills sheets are byte-identical to main's.
  - With the sketch, only the windows where it is visible change.
- **Layers:** the composited layer list is identical with and without the sketch at 8 sample times, in 3 styles. No text gets promoted.
- **Shown by the sheets:**
  - Fixed-frame placement runs past the safe area in 16:9 and overlaps text in chalkboard-cafe. Auto placement and a height-clamped fit are required (already in P1).
  - Dense hatching (196 strokes on the cup) merges into a dark patch at the default width, so stroke width must scale down with density.
- **Spike hook:** `host.ts` +7 lines plus `host/spike-sketch.ts`, marked `// SPIKE (P0)`. P1 replaces them.

### S6: click paths (`out/sketch/S6-ux.md`)

| Story | Clicks after content exists |
| --- | --- |
| (a) paste a café invitation → accept the suggested cup | 1 (chip → generates, variant 1 applied) + 1 optional (pick another variant) |
| (b) type "מוח", Line, keep across 2 sections | 4: `+ Sketch`, `Line`, `Generate`, `Keep until: +1` |
| (c) circle an emphasis word | 2 (`✎` on the emphasised chip → `Circle`), or 3 if the word isn't emphasised yet |

## 2. Decisions (defaults; change any before approving)

| # | Decision | Why |
| --- | --- | --- |
| SK1 | **Line from an image: spiralist matisse for photos; the S3 stroke tracer for logos.** "Draw the logo" uses the logo's traced strokes (pen lifts allowed, drawn with the clean Line look), not a forced single line. | Matisse is clearly the most beautiful single line on photos but garbles letters. The tracer keeps every Hebrew letter. Chaining strokes into one line looks scrappy in both S1 and S2. *Alternative:* sketch chain only (no model download, uglier lines). |
| SK2 | **Line from a description: the model draws one planned line.** Never join a Sketch answer into a line. Detail is capped at 3 for Line. A cheap check catches long straight lines across the drawing and regenerates once. | S1: joined sketches are unusable; planned lines read, but long jumps appear at high detail. |
| SK3 | Stroke encoding: one string per stroke. | Shorter output, same validity. |
| SK4 | `JsonCall` gains `maxTokens` (16384 for sketches, the split stays at 4096), `temperature`/`seed` for variants, and `images`. | Detail 5 overflows 4096 tokens. |
| SK5 | **No OpenCV.** The sidecar uses scipy + scikit-image + numpy (all BSD). | `opencv-python-headless` bundles LGPL libraries (FFmpeg and others), which aren't on the allowed list. Every call has a scipy/skimage equivalent, and dropping it saves 121 MB. |
| SK6 | The spiralist model files (≈ 43 MB: ONNX model + MediaPipe wasm and models) download in `reelgen setup sketch`, sha256-checked like the fonts. The vendored JS (≈ 0.8 MB, MIT) lives in `packages/sketch-line/vendor/spiralist/` with its LICENSE. It runs headless through the Playwright Chromium the renderer already uses, CPU wasm only. | Same pattern as fonts and the music-ai model; no new runtime. |
| SK7 | UI copy stays English, as today (the studio has no i18n layer). Content fields are `dir="auto"`, and chips and thumbnails are RTL-correct. | "Hebrew + English strings in the existing pattern": the existing pattern is English UI with Hebrew-safe content. A Hebrew UI would be its own project. |
| SK8 | A generated variant 1 is applied on arrival. `Keep until` is a chip row (`This section · +1 · +2 · To the end`). Emphasised word chips gain a `✎` menu. | S6 click budget. |
| SK9 | **E2e uses recorded real LLM answers.** A record/replay layer sits at the `callJson` boundary: `REEL_LLM_REPLAY=<dir>` replays, `REEL_LLM_RECORD=1` refreshes with a real key. Fixtures live in `apps/web/e2e/fixtures/llm/`. | Stories (a) and (b) need an LLM; live calls are slow and non-deterministic. |
| SK10 | Word attachment also works on the small line's words (`kind: 'sub'` units). | The sub-line feature shipped after the brief was written. |
| SK11 | `sidecar/sketch/.venv` and the model cache are git-ignored. | 274 MB venv. |
| SK12 | Draw-on: Line uses `stroke-dashoffset` on a fixed path. Sketch uses outlines precomputed at `ready()`. `boil` moves the faint jitter pass with a per-stroke `translate` every 4 frames instead of rebuilding it. Stroke width scales down with stroke density. | S4: these are the only variants under 4 ms at p95; S5 sheets show dense hatching blackening. |
| SK13 | The "+5 %" gate is measured on dilemma **render wall time**, not page main-thread time. | A visible sketch adds 40–90 % to the page's own ≈ 1.1 ms of work, but < 4 % of a captured frame. |
| SK14 | The determinism check times include frames inside every sketch window. | `stills.ts`'s fixed times missed the section-2 sketch in S5. |
| SK15 | Adding the overlay module changes the page bundle, so every job's chunk cache key changes once (pixels and fingerprints stay the same). Accepted. | One-time re-render of cached chunks. |

The brief's own open questions keep its defaults unless you say otherwise:
- refine on, capped at 3 calls per Generate (cost not measured yet: expected +35–45 % tokens and one extra round trip)
- boil off
- colour = the section's `text` token
- P5 word attachment in this build

## 3. Changes to the brief

1. **54 styles, not 25.**
   - P2 adds `sketch` blocks to all 54 recipes.
   - The matrix gate is 54 styles × 5 specs (270), plus the new sketch spec.
   - The full matrix takes ≈ 2 h at 3 workers, so it runs at the end of P1, P2 and P6.
   - P3–P5 run a fixed 12-style sample: the R1 heavy hitters, kinetic-quote, one per-letter style, and the 4 M7 path/scroll styles.
2. The line engine split, SK1. The brief offered spiralist **or** an own engine.
3. No OpenCV, SK5.
4. Line from text: one planned line, detail ≤ 3, SK2.
5. UI copy in English, SK7.
6. Record/replay fixtures for e2e, SK9.
7. `Keep until` chips and variant 1 auto-applied, SK8.
8. P4 acceptance: "pixel diff against a no-sketch render" stays, and it uses the replay fixtures.

## 4. Phases

As in the brief, with the gate from §3.1. Each phase has one worker and one reviewer who didn't write the code.

| Phase | Builds | Accept when |
| --- | --- | --- |
| P1 Core | `section.sketches[]` + `drawLogo`, presets in `@reel/core`, `SketchDoc` zod, anchor resolution and budget rule in timing, overlay host module (`ovUnder`/`ovOver`), both draw modes, auto + free placement, `until`, fingerprint, QA gates, sound cues | As in the brief, plus: no-sketch fingerprints identical to main on all 5 test specs × 3 styles |
| P2 Style integration | `sketch` look in 54 recipes, blend, per-section, material carry-over, job `sketchLook`, style stills with sketches | Full matrix green (270 + sketch spec); swap/blend/per-section checks as in the brief |
| P3 Generators | `callJson` extensions, LLM path + refine, `sidecar/sketch` (scipy/skimage), spiralist line runner, image + description crop, split `sketchIdea`, logo line version, cache, endpoints, CLI | As in the brief. The 10 subjects are re-run on real providers (keys required). |
| P4 UI | Section-card sketch row, `✎` emphasis menu, end-card toggle, Brand sketches + line version, Mixer group, scrub spans, handles | `sketch.ts` e2e runs the three stories (replay fixtures); `happy-path.ts` passes untouched |
| P5 Word attachment | `place.mode = 'word'` incl. sub words, click to attach | Circle tracks an emphasised word in kinetic-quote and one per-letter style, 4 formats, he + en |
| P6 Polish | Copy, RTL review, PLAN.md rows, dead code | Reviewer walks the three stories and finds nothing to reject |

## 5. New dependencies

| Dependency | Where | Licence | Size |
| --- | --- | --- | --- |
| `perfect-freehand` 1.2.2 | page (sketch outlines) | MIT | small |
| spiralist (vendored subset) | `packages/sketch-line/vendor/` | MIT | ≈ 0.8 MB |
| informative-drawings ONNX (Joseph Rocca port) | downloaded by setup | MIT | 17.2 MB |
| MediaPipe tasks-vision wasm + face landmarker + deeplab + magic touch | downloaded by setup | Apache-2.0 | ≈ 25 MB |
| numpy, scipy, scikit-image | `sidecar/sketch` | BSD | venv |

## 6. Open inputs
1. ~~Approve the decisions in §2~~: approved, SK1 as written.
2. `GEMINI_API_KEY` and/or `ANTHROPIC_API_KEY` in `makeAvideo/.env`. Needed by P3 (real S1 columns) and P4 (recorded fixtures). P1 and P2 don't need them.

## Rules learned
(empty)
