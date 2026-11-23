# M0d: harfbuzzjs Hebrew outlines → morph

**Verdict: PASS WITH CAVEATS**

| Question | Verdict | Key number |
|---|---|---|
| harfbuzzjs shapes Hebrew + niqqud + variable wght like Chromium (Node and browser under CSP) | **PASS** | word IoU 94.97–98.42 % (mean 97.30 %), 0 px differ by more than 1 px; niqqud centroid offset ≤ 0.765 px; advance width Δ ≤ 0.18 px |
| flubber, as-is, morphs glyphs (holes, multi-contour, unequal counts) | **FAIL** | `interpolate` keeps 1 subpath (coverage jump 42–418 % at t=0⁺); `interpolateAll` throws on 7/9 pairs; shapes end 23–87 % off the real letter |
| Own contour matching (Hungarian on area/centroid + collapse/grow extras) after a boolean union | **PASS** letter / shape→letter, **PASS WITH CAVEATS** word→word | 0 self-crossings on 6/9 pairs; per frame 19.5–106.8 µs (Chromium); setup 0.2–1.6 ms (Chromium) |
| Determinism (same t ⇒ same path string) | **PASS** within one engine | 56/56 strategy×pair hashes identical across seek order, rebuild and reruns (Node and Chromium); Node≠Chromium for 13/56 (all flubber, see §4) |
| Weight animation by re-shaping with harfbuzz every frame | **PASS** | 50–180 µs/frame in Chromium for 3–11-glyph words, deterministic, bit-identical Node vs Chromium |

Environment: Apple M1 Pro. Node v26.13.0 (V8 14.6.202.34). chrome-headless-shell 159.0.8154.6 via `launch('shell')` (WebGL: ANGLE Metal, Apple M1 Pro). harfbuzzjs 0.4.15 (HarfBuzz 12.3.0), flubber 0.4.2, polygon-clipping 0.15.7 (**new dependency**, added with `pnpm add polygon-clipping` in `spikes/`; it changes `spikes/package.json` and `pnpm-lock.yaml`).

## How to reproduce

All scripts write to `spikes/morph/out/`. The browser scripts rebuild `spikes/morph/www/` (esbuild bundle + `hb.wasm` + fonts; git-ignored), serve it with `lib.ts serve()` (production CSP), and use `launch('shell')`.

```
node spikes/morph/shape.ts      # step 1: shaping, per-cluster SVG paths       (~0.1 s)
node spikes/morph/fidelity.ts   # step 2: harfbuzz SVG vs DOM text in Chromium  (~5–20 s)
node spikes/morph/morph.ts      # steps 3+4: morphs, sheets, perf, determinism  (~40 s; run twice → cross-run hash check)
node spikes/morph/varfont.ts    # step 5: per-frame re-shape wght 400→900       (~1.5 s)
```

Library modules (not entry points): `hb.ts` (environment-agnostic shaping → positioned outlines), `node-hb.ts` (Node loader), `geom.ts` (flattening, contour classification, Hungarian matching, own morph, self-intersection metric), `pairs.ts` (test pairs + strategy builders, shared by Node and page), `page.ts` (browser side, `window.M`), `www.ts` (build + serve + open page).

## 1. harfbuzzjs loading and shaping

- **Node:** `require('harfbuzzjs')` resolves to the hbjs wrapper. WASM init takes 3.7 ms; loading the NotoSansHebrew face+font takes 0.80 ms.
- **Browser:** esbuild bundles `harfbuzzjs/hb.js` + `harfbuzzjs/hbjs.js` with `--external:fs` (`hb.js` only calls `require("fs")` in its Node branch). `createHarfBuzz({ locateFile: p => './' + p })` fetches `hb.wasm` from the same origin, and this works under the production CSP (`'wasm-unsafe-eval'`). The init, including fetching the 3 fonts, measured 11.4–26.0 ms across runs.
- **Variations API:** `font.setVariations({ wght: 900 })` wraps `hb_font_set_variations`, and `face.getAxisInfos()` lists the axes. NotoSansHebrew: wght 100–900 (default 100), wdth 62.5–100. Both advances and `glyphToPath` outlines follow the variation. Widths at 400 → 900: שָׁלוֹם 445.4 → 493.6 px, קפה 371.0 → 399.4, דילמה 529.2 → 586.8, Talk 358.4 → 423.2 (NotoSansHebrew also covers Latin).
- **Clusters:** שָׁלוֹם shapes to 7 glyphs in 4 clusters. The 3 marks (qamats and shin dot on ש, holam on ו) are zero-advance glyphs with GPOS offsets. `out/shape.json` has positioned SVG path data per cluster for every word × {400, 900}. `out/shape.svg` shows them, one colour per cluster.
- **Caveat:** at the default font scale, positions are integer font units (all measured widths are multiples of 0.2 px). That quantises positions to 0.2 px at 200 px / 1000 upem. The 0.1–0.2 px lerp-vs-reshape error in §5 matches this step [INFERENCE: cause not isolated]. `font.setScale(upem * k)` would give finer positions, but then the outline scale has to be divided by k as well [INFERENCE: not tested].

## 2. Fidelity: harfbuzz SVG vs Chromium DOM text (200 px, `dir=rtl`)

Method (`fidelity.ts`):
1. Lay out the DOM text: font-size 200 px, `font-variation-settings: 'wght' W`.
2. Find the baseline from a zero-size inline-block, and the run box from a `Range`.
3. Place the harfbuzz SVG with the run's right edge (RTL) or left edge (LTR) at the DOM run edge, on the same baseline. Harfbuzz is loaded **in the page**.
4. Screenshot both with the same clip and threshold at 50 % luminance.
5. Compute IoU, plus the XOR pixels farther than 1 px from the other mask.
6. Isolate niqqud in both renderers the same way: full render minus the render with niqqud stripped. Then compare mark masks and match connected-component centroids.

| case | word IoU % | XOR px > 1 px from edge | niqqud IoU % | max niqqud centroid offset px | width DOM / hb px |
|---|---|---|---|---|---|
| שָׁלוֹם noto@400 | 96.70 | 0 | 90.91 | 0.765 | 445.48 / 445.4 |
| קפה noto@400 | 96.38 | 0 | – | – | 371.03 / 371 |
| דילמה noto@400 | 98.26 | 0 | – | – | 529.19 / 529.2 |
| Talk noto@400 | 96.76 | 0 | – | – | 358.33 / 358.4 |
| בְּרֵאשִׁית noto@400 | 97.82 | 0 | 91.23 | 0.375 | 674.25 / 674.4 |
| שָׁלוֹם noto@650 | 97.78 | 0 | 93.77 | 0.437 | 469.55 / 469.4 |
| קפה noto@650 | 96.88 | 0 | – | – | 385.22 / 385.4 |
| דילמה noto@650 | 97.72 | 0 | – | – | 558 / 558 |
| Talk noto@650 | 96.75 | 0 | – | – | 390.77 / 390.8 |
| בְּרֵאשִׁית noto@650 | 97.52 | 0 | 92.17 | 0.395 | 712.63 / 712.6 |
| שָׁלוֹם noto@900 | 98.19 | 0 | 93.92 | 0.631 | 493.61 / 493.6 |
| קפה noto@900 | 98.30 | 0 | – | – | 399.41 / 399.4 |
| דילמה noto@900 | 98.42 | 0 | – | – | 586.81 / 586.8 |
| Talk noto@900 | 97.81 | 0 | – | – | 423.2 / 423.2 |
| בְּרֵאשִׁית noto@900 | 98.01 | 0 | 92.00 | 0.376 | 751 / 751 |
| שָׁלוֹם rubik@400 | 96.06 | 0 | 92.51 | 0.493 | 419.83 / 419.8 |
| בְּרֵאשִׁית rubik@700 | 96.98 | 0 | 93.68 | 0.607 | 702.53 / 702.6 |
| שָׁלוֹם frank@400 | 94.97 | 0 | 91.71 | 0.535 | 380.81 / 380.8 |

- In all 18 cases, every mismatched pixel lies within 1 px of the other renderer's edge. The difference is purely edge/antialiasing.
- The DOM rasteriser consistently paints 1.6–5.2 % more ink than the SVG fill (for example 20638 vs 19958 px for שָׁלוֹם@400). The diff PNGs show a uniform red (DOM-only) halo.
- All niqqud components were found and matched (3 for שָׁלוֹם, 7 for בְּרֵאשִׁית). Max centroid error is 0.765 px, so the **marks land where Chromium puts them**.
- The lower niqqud IoU (90.9–93.9 %) comes from the same 1 px halo on small shapes.
- 650 (an intermediate instance: harfbuzz `setVariations` vs CSS `font-variation-settings`) matches as well as the masters do.

Evidence: `spikes/morph/out/fid-<font>-<wght>-<word>.png` (black = both, red = DOM only, blue = harfbuzz only), for example `out/fid-noto-400-bereshit.png` and `out/fid-noto-400-shalom.png`. Raw data is in `out/fidelity.json`.

## 3. Morphs

### Strategies tested (`pairs.ts`)

| name | what |
|---|---|
| `flubber.interpolate` | Whole multi-subpath strings, as documented. For shape pairs: `fromCircle`/`fromRect` → largest contour. |
| `flubber.interpolateAll` | Contours paired by visual order; `single: true`. |
| `flubber.separate/combine` | Order pairing; the surplus goes through `separate()` (1→n) or `combine()` (n→1). |
| `flubber.ownPairs` | Fairness check: our pairing, `flubber.interpolate` per ring, extras via `toCircle`/`fromCircle(r≈0)`. |
| `own.collapse` | Our strategy (below) on raw font contours. |
| `own.split` | Same, but an unmatched outer emerges from (or merges into) a **copy** of the nearest matched outer instead of a point. |
| `own.union` | `own.collapse` after a nonzero boolean union of each side (polygon-clipping). |

The own strategy (`geom.ts ownMorph`) works in five steps:
1. Flatten curves (≤ 2 px chords).
2. Classify rings per glyph: outer if the winding matches the glyph's largest ring, otherwise hole. Link each hole to the smallest outer containing it, and normalise orientation (outers +, holes −) so that **nonzero** fill keeps holes.
3. Match outers ↔ outers with the Hungarian algorithm. Cost = Δ(centroid in each side's normalised bbox)² + 0.05·ln²(area ratio). Holes are matched only to holes whose parents are paired, with the cost measured relative to the parent centroid.
4. For each pair, resample both rings to N = max(24, ⌈max perimeter / 2 px⌉) points by arc length, then pick the cyclic offset that minimises the centred sum of squared distances.
5. Each unmatched contour scales to or from a point about its own centre, or its parent's centre for holes of unmatched outers. That centre rides along the displacement of the nearest matched contour. Shrinking happens during t ∈ [0, 0.6] and growing during [0.4, 1].

Coordinates are rounded to 0.01 px. t ≤ 0 and t ≥ 1 return the rest outlines.

### Quality metrics (`morph.ts`, Node; coverage rasterised in Chromium)

- **selfX**: interior frames (of 59, t = 1/60 … 59/60) whose rings cross themselves, and the maximum crossings in any one frame. This measures twisting.
- **maxStep**: the largest ink-coverage change between consecutive 1/60 steps, as % of mean coverage. Pops show up as spikes.
- **endsOff**: how far frame(0)/frame(1) is from the real outline's ink. This catches holes or contours that are missing at the hand-off back to real text.

| pair | strategy | selfX frames / max | maxStep % | endsOff % | Node setup ms | Chromium setup ms | Node µs/frame | Chromium µs/frame |
|---|---|---|---|---|---|---|---|---|
| קפה→דילמה | flubber.interpolate | 0 / 0 | **418.24** | 0 | 0.62 | 13.80 | 28.4 | 26.3 |
| | flubber.interpolateAll | throws (unequal counts) | | | | | | |
| | flubber.separate/combine | **37 / 12** | 2.49 | 0.70 | 16.07 | 14.60 | 430.0 | 406.3 |
| | flubber.ownPairs | 27 / 7 | 3.19 | 0.70 | 5.08 | 5.40 | 336.4 | 302.1 |
| | own.collapse | 19 / 2 | 4.45 | 0.08 | 0.55 | 1.40 | 102.7 | 93.8 |
| | own.split | 33 / 4 | 3.30 | 0.08 | 0.95 | 1.90 | 183.8 | 164.6 |
| | **own.union** | 19 / 2 | 3.62 | 0.08 | 0.26 | 1.20 | 102.6 | 96.6 |
| שָׁלוֹם→Talk | flubber.interpolate | 0 / 0 | **144.68** | 0 | 1.18 | 8.90 | 43.0 | 40.4 |
| | flubber.separate/combine | 19 / **13** | 1.91 | 1.29 | 25.75 | 22.60 | 434.5 | 397.1 |
| | flubber.ownPairs | 32 / 7 | 1.57 | 1.30 | 7.39 | 8.00 | 362.2 | 331.7 |
| | own.collapse | 23 / 3 | 1.60 | 0.06 | 0.76 | 1.80 | 123.3 | 107.1 |
| | own.split | 24 / 3 | 3.44 | 0.06 | 1.27 | 2.40 | 214.2 | 192.3 |
| | **own.union** | 25 / 2 | 1.66 | 0.06 | 0.54 | 1.60 | 121.3 | 106.8 |
| ם→ס (Noto, 2→1 contours) | flubber.interpolate | 19 / 6 | **68.25** | 0 | 0.89 | **85.40** | 64.2 | 55.0 |
| | flubber.separate/combine | 30 / 2 | 3.74 | 0.32 | 38.40 | 32.60 | 103.4 | 93.8 |
| | flubber.ownPairs | 28 / 10 | 2.32 | 0.32 | 1.16 | 3.00 | 121.2 | 109.7 |
| | own.collapse | 18 / 4 | 1.89 | 0.14 | 0.37 | 0.80 | 41.5 | 34.9 |
| | **own.union** | **0 / 0** | 0.59 | 0.14 | 0.11 | 0.60 | 37.0 | 33.5 |
| ם→ס (Rubik, 2→2) | flubber.interpolate | 0 / 0 | **49.33** | 0 | 0.50 | 29.20 | 34.2 | 28.8 |
| | flubber.interpolateAll | 0 / 0 | 1.17 | 0.05 | 0.39 | 1.40 | 78.3 | 65.6 |
| | **own.union** | 0 / 0 | 1.26 | 0.04 | 0.09 | 0.50 | 31.7 | 28.9 |
| B→8 (Rubik, 3→3) | flubber.interpolate | 0 / 0 | **42.54** | 0 | 0.64 | 56.80 | 40.8 | 36.7 |
| | flubber.interpolateAll | 0 / 0 | 6.50 (outer↔hole mis-paired) | 0.24 | 0.77 | 2.80 | 130.7 | 114.4 |
| | flubber.ownPairs | 0 / 0 | 0.45 | 0.31 | 0.82 | 1.60 | 112.2 | 97.7 |
| | **own.union** | 0 / 0 | 0.46 | 0.19 | 0.18 | 0.90 | 51.0 | 40.7 |
| circle→ש | flubber.interpolate (fromCircle) | 0 / 0 | 1.86 | **23.11** (inner stroke missing) | 0.07 | 0.50 | 69.0 | 60.4 |
| | flubber.separate/combine | 16 / 10 | 4.75 | 1.26 | 13.98 | 11.00 | 97.8 | 86.9 |
| | own.collapse | 0 / 0 | 1.78 | 0.11 | 0.22 | 0.60 | 62.3 | 33.0 |
| | **own.union** | 3 / 1 | 2.43 | 0.11 | 0.29 | 0.60 | 42.5 | 36.9 |
| square→ם | flubber.interpolate (fromRect) | 0 / 0 | 1.35 | **87.23** (hole missing) | 0.06 | 0.20 | 51.9 | 42.7 |
| | flubber.separate/combine | 0 / 0 | 6.72 | 0.03 | 14.24 | 11.50 | 91.8 | 80.9 |
| | **own.union** | 0 / 0 | 4.34 | 0.02 | 0.04 | 0.20 | 21.0 | 19.5 |
| circle→B | flubber.interpolate (fromCircle) | 0 / 0 | 0.33 | **66.77** (holes missing) | 0.06 | 0.40 | 57.2 | 51.1 |
| | flubber.separate/combine | 0 / 0 | 3.52 | 0.13 | 13.49 | 10.80 | 109.1 | 97.2 |
| | **own.union** | 0 / 0 | 2.72 | 0.06 | 0.09 | 0.40 | 33.1 | 27.0 |
| square→ק | flubber.interpolate (fromRect) | 0 / 0 | 4.70 | **38.31** (stem missing) | 0.05 | 0.10 | 54.5 | 46.9 |
| | flubber.separate/combine | 0 / 0 | 7.85 | 0.05 | 46.57 | 36.70 | 92.9 | 81.9 |
| | **own.union** | 0 / 0 | 4.30 | 0 | 0.12 | 0.20 | 31.3 | 28.5 |

The full table, including every strategy for every pair, is in `out/morph.json` and the console output of `morph.ts`.

**Outline preparation** (shape + flatten + classify + union, Node, median of 15): 0.06–1.50 ms per pair. Strategy setup is on top of that.

**Per frame**, own.union produces a 3.2k–16.9k-character path string. Flubber's strings are 3–6× larger (full-precision floats, 2 px resampling everywhere); separate/combine reaches 92.6k characters. Writing the string to the DOM and rasterising it were not measured [INFERENCE: that, not interpolation, will dominate frame cost].

### Contact sheets (12 frames, t = 0 … 1, rendered as SVG in Chromium)

Rows top to bottom: flubber.interpolate, flubber.interpolateAll (an error row when it throws), flubber.separate/combine, flubber.ownPairs, own.collapse, own.split, own.union.

| morph type | sheet |
|---|---|
| word→word | `spikes/morph/out/sheet-word-kafe-dilema.png` (קפה→דילמה) |
| word→word, niqqud + script change | `spikes/morph/out/sheet-word-shalom-talk.png` (שָׁלוֹם→Talk) |
| letter→letter with holes | `spikes/morph/out/sheet-letter-mem-samekh-noto.png`, `spikes/morph/out/sheet-letter-mem-samekh-rubik.png`, `spikes/morph/out/sheet-letter-B-8.png` |
| shape→letter | `spikes/morph/out/sheet-circle-shin.png`, `spikes/morph/out/sheet-square-mem.png`, `spikes/morph/out/sheet-circle-B.png`, `spikes/morph/out/sheet-square-kuf.png` |
| variable weight 400→900 (§5) | `spikes/morph/out/varfont-sheet.png` |

### Quality judgement (from the sheets)

- **flubber.interpolate (FAIL):** It uses only the first subpath. Words collapse to one letter fragment (`ר`-like stroke, `T`) and then pop back to the full word at t=1. Holes vanish (B→8 is a solid blob until t=1). `fromCircle`/`fromRect` morph only into the outer contour and never show holes or second contours. With string input in Chromium, flubber samples paths through DOM `getPointAtLength`: 8.9–85.4 ms setup (0.5–1.2 ms in Node), and output that differs from Node.
- **flubber.interpolateAll (FAIL as a general tool):**
  - It needs equal contour counts and throws on 7/9 pairs.
  - It forces one winding on every ring, so it needs `evenodd`. Overlapping contours (common in variable fonts) then XOR into holes.
  - With naive order pairing on B→8 it pairs outers with holes: the counters swap and invert mid-morph (6.5 % coverage step).
  - It is fine when contours correspond 1:1 (Rubik ם→ס: 0 crossings).
- **flubber.separate/combine (FAIL):** Triangulated wedge slices show as white diagonal cuts across the shape for most of the morph (square→ם, circle→ש, square→ק). It produces up to 13 self-crossings per frame, takes 11–47 ms to set up, and costs 400+ µs/frame on words.
- **flubber.ownPairs:** With our pairing, flubber's per-ring interpolation is acceptable on letters (B→8 0 crossings), but it is 2.4–3.7× slower per frame than own.union in Chromium and twists more on words (27/59 frames, max 7). The pairing and the winding are the real problem, not the ring interpolation.
- **own.collapse:** Clean on B→8, Rubik ם→ס, and all shape→letter pairs: 0 crossings, holes open from a point inside the shape, no pops. On Noto ם→ס the target ס is a **single self-overlapping contour** (the counter is closed only by the left stroke overlapping the top bar). Holes cannot be matched, so the ם hole shrinks while the ס counter opens from the side: 18/59 frames twist and two holes show mid-morph.
- **own.split:** Duplicated outers overlap into heavy black blobs (קפה→דילמה, circle→ש "tulip", ש/k pile-up in שָׁלוֹם→Talk). This is worse than collapse; **do not adopt.**
- **own.union (best):** The boolean union rewrites the ס into a clean outer plus hole. Noto ם→ס becomes a textbook morph (0/59 crossings, maxStep 0.59 %, down from 1.89 %). Elsewhere it is equal to own.collapse.
  - קפה→דילמה is readable throughout. ה maps to the final ה, ק→ד; the מ grows in the gap from t=0.4.
  - שָׁלוֹם→Talk is readable only near the ends. Mid-frames are blobby, 25/59 frames have ≤ 2 crossings, and the ם hole lingers inside the T until t=0.6.

## 4. Determinism

`morph.ts` evaluates 61 t values per strategy × pair (56 combinations that build):

| check | result |
|---|---|
| same t, sequential vs shuffled seek order (same interpolator) | identical, 56/56 |
| fresh rebuild from the font, same t | identical, 56/56 |
| rerun in a new process (`out/morph-hashes.json` from the previous run) | Node 56/56, Chromium 56/56 identical |
| Node vs Chromium | 43/56 identical; the 13 that differ are all flubber variants: string input (DOM `getPointAtLength` vs `svg-path-properties`), `fromCircle`/`toCircle`, and `separate` on circles. **All own.\* strategies are identical across engines.** |
| `Math.sin/cos/atan2/exp/log` bitwise, Node V8 14.6 vs Chromium 159, 20 000 inputs each | **differ**; `pow`, `sqrt` and `hypot` are identical |
| harfbuzz re-shape at 61 weights (`varfont.ts`) | identical across order and runs, and Node == Chromium for all 5 words (wasm is bit-exact) |

Our pipeline is identical across engines only because it avoids transcendental functions in the morph path and rounds to 0.01 px. `circleRing` uses `cos`/`sin`; it happened to round identically here, but that is not guaranteed.

## 5. Variable font: re-shape per frame vs CSS

`varfont.ts`: 300 frames, wght 400→900, full re-shape (`setVariations` + shape + `glyphToPath` for every glyph + path string, no cache).

| word (glyphs) | Node µs/frame | Chromium µs/frame | shape-only µs (Node) | CSS `font-variation-settings` + forced layout µs (Chromium) | lerp(400, 900) vs true 650, max px |
|---|---|---|---|---|---|
| שָׁלוֹם (7) | 110.7 | 95.7 | 8.0 | 132.3 | 0.2 |
| קפה (3) | 52.2 | 50.3 | 2.3 | 27.0 | 0.1 |
| דילמה (5) | 70.6 | 68.3 | 2.9 | 25.3 | 0 |
| Talk (4) | 58.8 | 55.3 | 2.6 | 32.3 | 0 |
| בְּרֵאשִׁית (11) | 203.6 | 179.7 | 6.0 | 40.0 | 0.2 |

- **Cost:** `glyphToPath` + parse takes 21.2 µs per glyph (Node) and dominates the cost. Shaping alone is 2–8 µs. Re-shaping is cheap enough per frame (14–17 µs/glyph in Chromium, i.e. about 1 % of a 60 fps frame for an 11-glyph word).
- **CSS column:** it measures only style + layout; raster is not included, so it is not a like-for-like total.
- **Structure:** command structure is identical at 400 and 900 for all words. Linear interpolation of the two instances matches a true 650 re-shape to within 0.2 px: 0 px for דילמה and Talk, 0.1–0.2 px for the others, consistent with the 0.2 px position quantisation. So weight animation can also be done as a point lerp between two cached instances [INFERENCE: this font's outlines appear linear in wght across 400–900; only 650 was checked].
- **Visual:** `out/varfont-sheet.png` shows שָׁלוֹם re-shaped at 12 weights, with niqqud following the GPOS anchors.

## 6. Failures and caveats

1. **flubber cannot be the morph engine for glyphs.**
   - first subpath only
   - one winding
   - equal-count requirement
   - triangulation wedges
   - DOM-dependent sampling in the browser

   Keep it, if at all, only as a single-ring helper. Its per-ring interpolation was never better than ours.
2. **Font outlines are not clean polygons.** Noto Sans Hebrew ס is one self-overlapping contour, and variable TTFs keep overlaps. Without a nonzero union, hole matching is wrong (18/59 frames twisted). Union is mandatory.
3. **Cross-script or structurally different word pairs** (שָׁלוֹם→Talk) are blobby mid-morph with all strategies. Expect ≤ 2 self-crossings in up to 25/59 frames on word pairs, and holes that linger up to t=0.6.
4. **Unequal letter counts:** extra letters grow from points (מ in דילמה). There is a visible gap mid-morph until t≈0.4. This is acceptable for a morph style, but it is not a "letters rearrange" look.
5. **Edge weight at hand-off:** the harfbuzz SVG fill has 1.6–5.2 % less ink than Chromium's DOM text (a ≤ 1 px halo). Swapping DOM text ↔ SVG at the start or end of a morph may show a slight weight flicker [INFERENCE: not observed in video, measured only on stills]. Use the same renderer for rest frames, or accept the halo.
6. **Positions are integer font units** at the default hb scale (0.2 px at 200 px). Weight animation via re-shape can jitter glyph positions by up to 0.2 px between frames [INFERENCE: not observed in video].
7. **Not measured:** DOM `setAttribute('d')` plus SVG raster cost per frame, which will dominate the 20–110 µs interpolation cost. Also not measured: other fonts' contour quirks, and sizes other than 200 px.
8. **Metric limits:** the coverage-step metric flags pops but cannot separate them from legitimate area change. The judgements above also rely on the sheets.

## 7. Recommendation: production morph pipeline

Applies to `traits/reveal/morph-from-previous`, transition `morph`, and styles `glyph-morph` / `shape-to-type`. Adopt the **own.union** strategy:

1. **Shape in the page with harfbuzzjs.** Use the same font file as the DOM (bundled `hb.js` + `hb.wasm`, served same-origin; init ≈ 11–26 ms once per page). Set the weight with `font.setVariations({ wght })`. Cache shaped outlines by (text, font, wght, size). Place glyphs from harfbuzz advances.
2. **Flatten** curves to ≤ 2 px chords at render size.
3. **Normalise** each side with a nonzero boolean union (polygon-clipping was used here; a wasm Clipper2 is an option [INFERENCE]) into clean `[outer, ...holes]` polygons. This removes overlaps and "slit" counters.
4. **Match contours.** Hungarian assignment on outers, cost = Δcentroid² in each side's normalised bbox + 0.05·ln²(area ratio). Match holes only within matched parents, cost relative to the parent centroid. Normalise orientation (outer +, hole −) and **always fill nonzero**; never evenodd.
5. **Correspond each pair of rings:** arc-length resample to N = max(24, ⌈perimeter / 2 px⌉), then the cyclic offset with minimum centred SSD.
6. **Unmatched contours:** collapse or grow at their centre (holes of an unmatched outer use the parent centre), riding the nearest matched contour's displacement. Shrink over t ∈ [0, 0.6] and grow over [0.4, 1]. Do **not** use duplicate-and-split.
7. **Frames are pure functions of eased t:** linear point lerp, coordinates rounded to 0.01 px, no transcendental `Math` in the frame path. Build interpolators at section load or seek: ≤ 1.6 ms strategy setup in Chromium, plus 0.06–1.5 ms outline preparation (shape + flatten + union) measured in Node. Never precompute frames in Node expecting bitwise equality with the page.
8. **shape-to-type:** source = circle or square sized to the letter bbox, as one outer. The letter's other outers and all its holes grow from points inside. Measured on the 4 shape→letter pairs: ≤ 0.11 % end error. Self-crossings were 0 everywhere except circle→ש with own.union (3/59 frames, 1 crossing); own.collapse had 0 there.
9. **Variable-weight traits** (`axis: weight-wave` etc.) may re-shape per frame with harfbuzz (50–180 µs/word in Chromium, deterministic), or lerp two cached instances (≤ 0.2 px error on this font). Keep CSS `font-variation-settings` for plain DOM text.

**Known bad cases to encode as compat rules or QA:**
- cross-script morphs (Hebrew ↔ Latin): blobby mid-frames
- very different letter counts: growth gap
- fonts with unusual contour construction: always union first
- niqqud: becomes tiny extras that shrink or grow; acceptable, but a niqqud-heavy line morphing into a different line will "sparkle" with dots

Consider limiting `morph-from-previous` to same-script pairs of similar length. Otherwise fall back to a crossfade.
