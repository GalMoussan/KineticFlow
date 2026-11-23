# M0c — Grapheme / word / bidi splitting in DOM and troika-three-text

**Verdict: PASS WITH CAVEATS.** Hebrew with niqqud, English and mixed bidi text split cleanly into grapheme and word units in the DOM, as long as the unit positions are measured on the unsplit line. Naive `inline-block` splitting breaks both kerning and bidi order. Stock troika-three-text misplaces niqqud. A 3-hunk bundle-time patch fixes it, and a Canvas2D-texture path also works without any patch.

| Question | Verdict | Key numbers |
|---|---|---|
| DOM grapheme split | **PASS WITH CAVEATS** (only with the measured-absolute strategy) | `abs`: ≤ 0.84 % ink diff, 0 px ink-bbox shift, ≤ 0.02 px width Δ, 0 order errors (30 line×font cases). Naive `inline-block`: ≤ 79.62 % diff, ≤ 13.92 px kerning loss, 162 misplaced units |
| DOM word split | **PASS WITH CAVEATS** (same) | `abs`: ≤ 1.18 % ink diff, 0 px bbox shift, 0 order errors. Naive: ≤ 76.11 %, ≤ 7.83 px kerning loss (Rubik), 72 misplaced units |
| Mixed bidi | **PASS** | bidi-js visual order equals Chromium's native order in 20/20 line×granularity cases (0 mismatches). Isolate-tree and visual-order strategies: 0 order errors. bidi-js costs 15.1 µs per line |
| troika niqqud (GPOS marks) | **FAIL** stock; **PASS WITH CAVEATS** patched | Stock: marks off by up to **64.7 px** vs HarfBuzz at 96 px (shin dot ↔ sin dot). Patched: marks ≤ 2.4 px vs HarfBuzz; per-grapheme render ≤ 14.13 % diff, bbox ≤ 1 px (the SDF-vs-DOM noise floor is 11–14 %) |
| troika per-glyph access | **PASS WITH CAVEATS** | `glyphBounds` per renderable glyph, `caretPositions` per char (5/5 mark carets sit on their base), `aTroikaGlyphIndex` attribute. There is no public glyph→char map. Per-unit animation works by making one `Text` per unit inside a `BatchedText` (1 draw call): 0.88–0.90 ms/frame for 35 units |

All numbers below are measured on this machine (M1 Pro, chrome-headless-shell, `launch('shell')`, Metal WebGL2, DPR 1, viewport 2600×240, 96 px text). They come from the last run of each script.

## 1. What was tested, and how to reproduce it

```
node spikes/text/dom.ts      # ≈45 s: DOM grapheme + word split, 10 lines × 3 fonts × 7 strategies → out/dom*.png, out/dom.json
node spikes/text/bidi.ts     # ≈10 s: bidi-js vs Chromium order, isolation strategies → out/bidi.png, out/bidi.json
node spikes/text/troika.ts   # ≈45 s: troika stock vs patched, Canvas2D paths, HarfBuzz GPOS check, latency, frame cost
node spikes/text/fonts.ts    # optional: static wght-400 instances (troika.ts runs it itself; uses `uvx --from fonttools`)
```

Files in `spikes/text/`:

- `strings.ts` holds all test strings and fonts.
- `units.ts` is the splitter prototype: emphasis parsing, `Intl.Segmenter`, bidi-js levels, visual order, level tree.
- `dom-page.ts`, `troika-page.ts` and `analyze-page.ts` are the browser pages. They are bundled with esbuild and served by `lib.ts serve()` under the production CSP.
- `troika-patch.ts` is the esbuild plugin that patches troika.
- `harness.ts` holds the shared helpers.

Generated `build/` and `fonts/` are git-ignored.

**Test strings** (`strings.ts`):

- `שָׁלוֹם עוֹלָם`, typed with shin dot before qamats
- `בְּרֵאשִׁית שַׂר` (dagesh+sheva, shin dot+hiriq, sin dot+patah)
- `קפה דילמה וג׳אם` (U+05F3 geresh)
- `סוף הקיץ בדרך לגן החלום` (ף ץ ך ן ם)
- `בית החאן · Beit HaChan · 19:30 · 01.12.2026`
- `(שאלה?) [A/B]`
- `Let's *talk* tonight`
- `הערב *נדבר* על זה`

I added two bidi stress lines: `Meet at בית החאן 19:30 tonight` (LTR paragraph, levels 0/1/2) and `השעה (19:30) והמחיר 45₪`.

**Metrics.** Each split render is screenshotted and compared with the unsplit render of the same line, font and position.

- **diff % ink**: pixels with |Δluminance| > 64/255, divided by pixels where either image has ink (darkness > 96), × 100.
- **bbox shift**: the largest absolute difference among the 4 edges of the ink bounding box, in px.
- **unit shift**: max(|Δleft|, |Δright|) of each unit's box against its `Range` rect in the unsplit text.
- **width Δ**: the extent of all units minus the unsplit extent. This is the kerning lost at unit boundaries.
- **order errors**: visual positions whose unit differs from the unsplit text's left-to-right order.
- **Control**: rendering the unsplit line twice gives 0.00 % and 0 px.

DOM strategies (`dom-page.ts`):

- `inline`: `display:inline` spans. These cannot take transforms; this row is a kerning control.
- `ib`: naive `display:inline-block` units in logical order.
- `iso`: inline-block units nested in `unicode-bidi:isolate` spans built from bidi-js levels.
- `isok`: `iso` plus a per-unit `margin-inline-end` that restores the advance the unit had in the shaped line.
- `visual`: units emitted in bidi-js visual order inside an LTR `bidi-override` line.
- `abs`: unit rects measured with `Range.getBoundingClientRect` on the unsplit line, then each unit absolutely positioned, anchored at its logical start edge (`right` for odd levels, `left` for even).

## 2. Results

### 2.1 DOM grapheme split (10 lines × Rubik / Noto Sans Hebrew / Frank Ruhl Libre)

| strategy | max diff % ink | mean | max bbox shift px | max width Δ px | order errors |
|---|---|---|---|---|---|
| plain (control) | 0 | 0 | 0 | 0 | 0 |
| inline (no transforms) | 4.94 | 1.17 | 1 | 0.38 | 0 |
| ib (naive) | **79.62** | 38.05 | 14 | **13.92** | **162** (mixed, mirror, nested, numparen) |
| iso | 66.38 | 24.99 | 14 | 13.92 | 0 |
| visual | 66.38 | 24.99 | 14 | 13.92 | 0 |
| isok | 8.55 | 2.95 | 1 | 0.64 | 0 |
| **abs** | **0.84** | **0.11** | **0** | **0.02** | **0** |

- **Kerning.** Inline-block units **do lose kerning.** With isolation but no compensation (`iso`), the worst width Δ is 13.92 px for Rubik, 8.73 px for Noto and 8.66 px for Frank. The worst single line is `finals`/Rubik: 13.92 px, 66.4 % diff.
- **`abs` unit shift.** The `abs` boxes still differ from the Range rects by up to 6.42 px. This is the box edge, not ink: an isolated unit's advance excludes the in-line kerning. Its ink matches (0 px bbox shift, ≤ 0.84 %).
- **`isok` drift.** `isok` accumulates up to 0.64 px over 43 units. [INFERENCE] The likely cause is Chromium's 1/64-px LayoutUnit rounding of margins.
- **Niqqud, geresh, finals.** These stay intact in every strategy. Intl.Segmenter puts base + marks in one grapheme (`שָׁ`, `בְּ`, `שִׁ`, `שַׂ`); geresh is its own grapheme. Visually, in `out/dom-niqqud-zoom.png`, the shin dot stays on the right, the sin dot on the left, holam on vav, and dagesh in bet, for all 3 fonts in `ib` and `abs`.
- **Bidi.** The `ib` failures on bidi lines are reordering: `6202.21.10 · 03:91 · nahCaH tieB`, `[B/A]` (see `out/bidi.png`). Inline-block atoms are bidi neutrals, so in an RTL paragraph they take the RTL direction.

### 2.2 DOM word split

| strategy | max diff % ink | mean | max bbox shift px | max width Δ px | order errors |
|---|---|---|---|---|---|
| inline | 1.87 | 0.58 | 1 | 0.17 | 0 |
| ib (naive) | 76.11 | 24.25 | 8 | 7.83 | **72** |
| iso / visual | 58.27 | 4.83 | 8 | 7.83 | 0 |
| isok | 2.88 | 1.01 | 1 | 0.27 | 0 |
| **abs** | **1.18** | **0.17** | **0** | **0.02** | **0** |

Word-level kerning loss is significant only in Rubik, which kerns across the space (up to 7.83 px). Noto loses ≤ 0.05 px and Frank ≤ 0.17 px.

### 2.3 Mixed bidi

- **bidi-js vs Chromium.** For all 10 lines × {grapheme, word}, the unit order from bidi-js (`getEmbeddingLevels` with auto direction + `getReorderedIndices`) is **identical** to Chromium's rendered order (unit rect centres in the unsplit text): 0 mismatches.
- **Levels.** Levels are UBA-correct. In `mixed`, the whole run `Beit HaChan · 19:30 · 01.12.2026` is one level-2 run, because W7 turns the numbers after Latin into L. `nested` produces the tree `L0[Meet at R1[בית החאן L2[19:30]] tonight]`.
- **Isolate tree (`iso`).** Units nested in `unicode-bidi:isolate` spans, grouped by maximal runs with level > p, recursively, gave **0 order errors** on all lines.
- **Manual visual order (`visual`).** Gave **0 order errors** too. The two produce pixel-identical results.
- **Mirroring.** Mirroring was correct whenever each unit carries `dir` = its level parity, because the browser then mirrors `(`/`[` itself.
- **Decision.** Do not choose positions by either ordering scheme. Let the browser lay out the **unsplit** line and measure it (`abs`). bidi-js is still needed for two things:
  1. each unit's `dir` (needed for mirroring when a unit is shaped alone);
  2. the WebGL path and reveal ordering.

  If flow layout must be kept, use the isolate tree (DOM stays in logical order); never naive inline-blocks.

### 2.4 troika-three-text 0.52.5 (Noto Sans Hebrew and Rubik, static wght-400 instances)

Every WebGL mode was compared with the DOM reference (all 10 lines × 2 fonts). `+patch` means the build uses `troika-patch.ts`.

| mode | max diff % ink | mean | max bbox shift px | mean sync ms |
|---|---|---|---|---|
| line (one Text) | 53.9 | 20.68 | 6 | 1.78 |
| g-troika (Text per grapheme, troika caret positions) | 76.31 | 29.62 | **46** | 0.70 |
| g-dom (Text per grapheme, DOM positions) | 73.62 | 23.29 | **46** | 0.45 |
| line+patch | 53.9 | 19.94 | 6 | 1.90 |
| g-troika+patch | 53.9 | 19.94 | 6 | 0.68 |
| **g-dom+patch** | **14.13** | 12.47 | **1** | 0.48 |
| **g-canvas** (Canvas2D texture per grapheme, DOM positions) | **9.39** | 6.02 | **1** | 0.71 |
| canvas (whole line as one texture) | 11.31 | 0.72 | 2 | 0.18 |

**SDF noise floor.** Lines with no marks and no kerning issues give 11.2–14.1 % diff with bbox ≤ 1 px, for example `english`/Noto line at 13.7 %/1 px and `geresh` at 14.0 %/1 px. This is the difference between SDF and Skia anti-aliasing, not a layout error.

**Niqqud / GPOS** (troika glyph origins vs harfbuzzjs shaping of the same font, which is what Chromium uses; px at 96 px, median offset removed):

| line / font | stock: mark max \|dx\| (marks > 2 px off) | patched | base glyph max \|dx\| (both builds) |
|---|---|---|---|
| niqqud / Noto | 32.45 (5/5) | 0.96 (0/5) | 0.96 |
| niqqud2 / Noto | 64.70 (6/7) | 2.40 (2/7) | 2.40 |
| niqqud / Rubik | 60.29 (1/5) | 0 (0/5) | 1.73 |
| niqqud2 / Rubik | 60.29 (4/7) | 0 (0/7) | 0 |
| finals / emphasis (no marks), both fonts | — | — | 3.46–3.94 |

- **The stock bug is in troika's RTL run flip.** troika mirrors every glyph as `x' = right − (x + advance − left)`. A zero-advance mark at `base + d` therefore lands at `base' + advance − d`: it is mirrored about the base's centre. The shin dot renders as a sin dot, holam drifts, and qamats goes off-centre (`out/troika-niqqud-zoom.png`).
- **Per-grapheme troika Texts are worse (46 px bbox shift).** For a grapheme whose last glyph is a mark, `line.width` is taken from the mark, so the anchor shifts.
- **The patch** (`troika-patch.ts`, 3 string replacements in `dist/troika-three-text.esm.js` at bundle time) does three things:
  1. re-attaches zero-advance glyphs at their pre-flip offset from the base;
  2. excludes them from the flip extent;
  3. excludes them from `line.width`.

  I also tried a variant that flipped by the GPOS-adjusted pen advance. It made kerning worse (base error 4.9–6.2 px), so I dropped it.
- **Remaining base drift of ≤ 3.94 px per line** comes from troika's own GPOS. troika logs `unsupported GPOS table LookupType 8 format 3` (console.debug, seen while probing), i.e. chained contextual positioning. With Rubik this accumulates on some lines: `numparen` 53.9 %/6 px, `nested` 31.8 %/4 px, `mirror` 26.6 %/4 px for the whole-line Text. Per-unit Texts at DOM positions remove it (`g-dom+patch` ≤ 14.13 %/1 px).

**Mixed bidi order in troika is correct.** The bidi lines with Noto sit at the noise floor: `mixed` 13.1 %/1 px, `mirror` 14.0 %/1 px, `nested` 13.8 %/1 px, `numparen` 13.6 %/0 px. Order and mirroring match the DOM visually (`out/troika.png`). The larger Rubik numbers come from the GPOS drift above, not from order.

**Per-glyph access.**

- `textRenderInfo` exposes `glyphBounds` (one quad per renderable glyph: 13 for the 14-char niqqud line, 35 for the 43-char mixed line; whitespace is omitted), `glyphAtlasIndices`, `caretPositions` (one per char, 14/14 and 43/43), `blockBounds`, `visibleBounds` and `timings`. The geometry carries `aTroikaGlyphBounds` and `aTroikaGlyphIndex`.
- Mark carets sit inside their base's caret range in 5/5 cases, so char→base mapping works through carets.
- There is **no public glyph→char map**. Glyph ids are replaced by atlas indices, and `charIndex` stays inside the typesetter. I read raw glyph ids only through the internal `typesetterWorkerModule.onMainThread._getInitResult()`.
- Marks are separate glyphs, not merged with their base.
- Consequence: per-grapheme animation should use one `Text` per unit, which `BatchedText` packs into one draw call via per-member matrices. [INFERENCE] A per-glyph vertex shader keyed on `aTroikaGlyphIndex` would also work, but needs an app-side glyph→unit map, which troika does not provide.

**Latency** (`useWorker:false`, fresh page, `niqqud` line):

| font | sync | first frame (incl. shader compile) | same text again | new text, same font |
|---|---|---|---|---|
| Noto | 17.5 ms | 31.3 ms | 2.1 ms | 7.1 ms |
| Rubik | 20.3 ms | 34.8 ms | 2.7 ms | 12.6 ms |

troika's internal split (Noto / Rubik): fontLoad 4.9 / 7.1 ms, typesetting 2.7 / 3.5 ms, SDF generation 0.9 / 1.2 ms.

**Steady per-frame cost.** Each frame moves, rotates, scales and fades every unit, renders, then calls `readPixels(1px)` as a GPU sync. 240 frames, `mixed` line, 35 units, patched build:

| setup | mean ms | p95 ms | setup ms |
|---|---|---|---|
| line Text (1 object) | 0.74–0.76 | 1.0 | 1.5–1.9 |
| per-grapheme Text in BatchedText | 0.88–0.90 | 1.1 | 2.5–2.6 |
| per-grapheme Text, separate meshes | 0.96–0.97 | 1.2–1.6 | 5.1–5.5 |
| per-grapheme Canvas2D textures | 0.83–0.88 | 1.2–1.4 | 17.6–19.0 |
| whole-line canvas texture | 0.76–0.78 | 0.9–1.0 | 5.1–5.4 |

The render-throughput spike was running at the same time, so treat these as upper bounds. [INFERENCE] At 35 units every mode costs < 1 ms/frame, and most of that is the GPU sync, not troika.

## 3. Failures and caveats

1. **troika's default worker mode hangs under the production CSP.** The worker's `importScripts(blob:)` is blocked (24 console errors), and `Text.sync()` did not resolve within 10 s. Fix: `configureTextBuilder({ useWorker: false })`, measured above. The alternative is to add `blob:` to `script-src`.
2. **A codepoint missing from the font also hangs troika.** troika fetches fallback fonts from `cdn.jsdelivr.net`, the CSP blocks it, and `sync()` did not resolve within 10 s (tested with U+202D/U+202C on Noto). This also killed my LRO/PDF trick for dodging the RTL flip. Every string must be checked against the font's cmap before it reaches troika.
3. **troika ignores variable-font axes and renders the default instance.** Noto's default is wght 100: ink is 0.36× the DOM at 400, with 97.78 % diff. Rubik's default is wght 300: 0.66× ink, 84.23 % diff (`out/troika-varfont.png`). WebGL needs a static instance per weight; `fonts.ts` builds them with fonttools `varLib.instancer`. The `axis` traits (`weight-wave` etc.) are therefore DOM-only.
4. **Stock troika: niqqud FAIL** (section 2.4). The patch targets troika 0.52.5's exact source text and throws if the text is not found. It must be re-checked on every troika upgrade, or sent upstream.
5. **troika lacks chained-context GPOS** (≤ 3.94 px base drift per line vs HarfBuzz, more with Rubik over long lines). Placing units from DOM measurements hides this.
6. **Canvas2D kerning.** Canvas2D needs `ctx.fontKerning = 'normal'`. With the default, the first run measured the Rubik `finals` whole-line canvas at 58.6 % diff / 7 px; with `'normal'` it measured 1.0 % / 0 px.
7. **`abs` units are fixed to the measured layout.** Anything that changes advances (weight/width axis animation, font swap, resize) needs a re-measure. Not measured: the cost of measuring per frame.
8. **Scope of the troika test.** Emphasis was rendered at weight 400 there (markers stripped), because a bold run would need a second static instance. Frank Ruhl Libre was tested in the DOM only.
9. **Pixel diff includes anti-aliasing noise.** Split text runs produce 0–5 % with 0–1 px bbox, even for `display:inline` spans that do not move. Treat ≤ 5 % / ≤ 1 px (DOM) and ≤ 14 % / ≤ 1 px (SDF vs DOM) as equal.

## 4. Evidence (`spikes/text/out/`)

- `dom-grapheme.png`, `dom-word.png`: reference plus all 7 strategies, every line × font.
- `dom-grapheme-overlay.png`, `dom-word-overlay.png`: red = unsplit only, cyan = split only, black = both.
- `dom-niqqud-zoom.png`: niqqud, geresh and finals at 1:1 (plain / ib / abs / overlays).
- `bidi.png`: mixed, mirror, nested and numparen lines, Rubik: native vs ib / iso / visual / abs.
- `troika.png`, `troika-overlay.png`: DOM vs all WebGL modes, stock and patched.
- `troika-niqqud-zoom.png`: niqqud at 1:1, stock vs patched vs Canvas2D, with overlays.
- `troika-varfont.png`: variable font files, DOM at 400 vs troika's default instance.
- `dom.json`, `bidi.json`, `troika.json`: every raw number.

## 5. Recommendation for `packages/runtime`: unit-splitting algorithm

1. **Parse.** Strip `*emphasis*` markers into ranges (`units.ts parseEmphasis`). Emphasis is a style on the units it covers, never a separate text node in the source.
2. **Paragraph direction.** Run bidi-js `getEmbeddingLevels(text)` with auto (first-strong) direction. Set the line's `dir` explicitly from `paragraphs[0].level`; do not use `dir=auto`, so that the runtime and Chromium cannot disagree (0 mismatches measured). Keep `levels`.
3. **Segment.** Use `Intl.Segmenter('he', { granularity: 'grapheme' | 'word' })`. Keep every segment as a unit, including spaces and punctuation, and flag `wordLike` / whitespace. Each unit gets `level = levels[unit.start]` and `dir = level & 1 ? 'rtl' : 'ltr'`. Marks never become units of their own.
4. **DOM layout (default layer).**
   1. Render the **unsplit** line: text nodes, emphasis as inline spans with their weight.
   2. Await `document.fonts.load(...)` for every family and weight used.
   3. Measure each unit with `Range.getBoundingClientRect()`.
   4. Replace the content with one `position:absolute; top:0; white-space:pre` span per unit, carrying the unit's `dir`. Anchor `right` for odd levels and `left` for even ones, at the measured edge.
   5. The channel `commit` writes `transform`, `opacity`, `filter` and so on to these spans, with `transform-origin` at the centre of the measured rect.

   Re-measure only when line-layout inputs change. This is `abs`: ≤ 0.84 % / 0 px at grapheme level, ≤ 1.18 % / 0 px at word level.
   - When a trait must keep **flow layout** (reflowing per frame, e.g. `axis: weight-wave`), use the isolate tree: `levelTree` → nested `unicode-bidi:isolate` spans, with inline-block units and `margin-inline-end` kerning compensation (`isok`: ≤ 8.55 % / 1 px, ≤ 0.64 px drift).
   - **Never** use naive inline-block units.
5. **Ordering for animation.** Sequential reveals (typewriter, stagger) use logical order (`unit.index`). Spatial sweeps (wipes, left-to-right stagger) use visual order, i.e. sort by measured x, which equals bidi-js `visualOrder`.
6. **WebGL layer († traits).** Lay out in the DOM (step 4), then paint units in WebGL at the measured positions.
   - **Preferred:** troika `Text` per unit inside one `BatchedText`, built with `troika-patch.ts` (≤ 14.13 % / ≤ 1 px vs DOM, marks ≤ 2.4 px vs HarfBuzz, 0.88–0.90 ms/frame for 35 units). Do **not** use troika's own line layout for Hebrew text with niqqud.
   - **No-patch fallback:** Canvas2D-rendered texture per unit (`g-canvas`: ≤ 9.39 % / ≤ 1 px, set `fontKerning='normal'`; setup 17.6–19.0 ms per 35 units). [INFERENCE] It is resolution-bound, so for large scale-ups re-raster at the target size.
   - **troika configuration:**
     - `configureTextBuilder({ useWorker: false })`.
     - One static font instance per weight; no variable files.
     - A cmap coverage check of every codepoint before `sync()` (otherwise it hangs).
     - Await every unit's `sync()` before the first captured frame.
   - Glyph-outline traits (morph, path, extrude) take harfbuzzjs outlines (spike M0d), not troika.
7. **Plan changes to consider.**
   - §5.1 `unit: grapheme` holds in the DOM via measured-absolute units.
   - §5.4 / §13: the "troika niqqud mark positioning" risk is confirmed. Mitigate with DOM-measured layout plus the patched troika or Canvas2D textures, and add font cmap preflight and static per-weight instances to the font pipeline (§11).
   - `axis` traits are DOM-only.
