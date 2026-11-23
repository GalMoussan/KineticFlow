# @reel/traits: authoring guide

A **style** is a recipe: one **trait** per axis plus param overrides (`packages/styles/<id>/recipe.json`). This
package holds every trait, the resolver that turns a spec into per-section styles, and the one generic page host
that runs any combination of traits. Read this before you add a trait or a style.

```
src/
  index.ts          Node-safe entry: TRAIT_META, resolveStyles, usedTraits, contract types
  registry.ts       every trait's meta (one import per trait)
  resolve.ts        resolveStyles(spec, recipes, traitMeta) → per-section ResolvedStyle + scenes + diagnostics
  contract.ts       Unit, Section, Layer, Host, channel records, per-axis hook interfaces, define* helpers
  files.ts          Node-only: where impl.ts / style.css live (used by the bundler)
  host/host.ts      runHost(traits): the ReelPage implementation (browser)
  host/commit.ts    channel reset + the single DOM commit
  host/host.css     base stylesheet (always bundled first)
  lib/deco.ts       shared decorations: logoBadge, pinSVG/PIN_METRICS, quoteSVG
  traits/<axis>/<id>/meta.ts    Node-safe metadata (no DOM, no runtime imports)
  traits/<axis>/<id>/impl.ts    browser implementation: `export default define<Axis>({ meta, …hooks })`
  traits/<axis>/<id>/style.css  optional; bundled only when the trait is used
dev/stills.ts       contact sheets, safe-area/overlap check, fingerprint diff, determinism for any spec
```

## 1. Rules that never bend

- **Pure function of t.** `frame(c, t)` must not read or write state that depends on earlier frames. No CSS
  animations or transitions, no `Date`, no network, no randomness (use `hash(n)` from `@reel/runtime`). Frames are
  seeked in any order, in several browsers, and the result must be identical (the QA gate allows ≤ 2/255 GPU residue).
- **Node stays bit-exact.** `meta.ts` and anything the resolver runs use `+ − × ÷` only. `Math.sin/cos/exp/log/pow`
  run only in the page (`impl.ts`).
- **Measured units only.** Never split text into naive inline-blocks. Ask for parts with `unit.split`; the host splits
  with `splitMeasured` (measured-absolute, bidi- and niqqud-safe) and gives you `unit.parts`.
- **Traits write channels, not CSS.** Units, layers and the stage are written by the host's single commit. Write CSS
  yourself only on elements your trait created itself (a canvas, wipe panels), and then rewrite them completely in
  every `frame`.
- **Text stays inside `format.safe`** at every section hold, in all four formats and in RTL and LTR. Layouts fit
  against `host.safe` and `host.zoomRange(section)` (see §5).

## 2. A trait module

`meta.ts`:

```ts
import { defineMeta } from '../../../contract.ts';

export const meta = defineMeta({
  id: 'slam',                    // unique per axis; equals the folder name
  axis: 'reveal',
  layer: 'dom',                  // 'dom' | 'canvas' | 'webgl'
  label: 'Slam',
  params: {                      // what blends interpolate; values reach the impl unprefixed
    scale: { min: 1, max: 5, default: 3.2, label: 'Start scale' },
  },
  requires: { unit: ['word', 'grapheme'] },  // optional: axis → allowed trait ids
  excludes: { layout: ['world-blocks'] },    // optional: axis → forbidden trait ids
  needs: { chars: true },        // optional: some units need grapheme parts (unit traits with chars:false fail)
  formats: ['9:16', '1:1'],      // optional: restrict formats
  // layout only:  roles: [...section roles it can lay out]   (required), world: true if sections can share one world
  // camera only:  world: true if it can travel a world
  // transition:   scope: 'world' (camera move inside a chain) | 'layer' (replaces one scene layer by the next)
});
```

`impl.ts`:

```ts
import { clamp01, lerp } from '@reel/runtime';
import { defineReveal } from '../../../contract.ts';
import { meta } from './meta.ts';

export default defineReveal({
  meta,
  prepare(c, u) { u.data.reveal = { anim: 'slam' }; u.hit = { t: u.at + 0.12, amp: u.font.size / 14 }; },
  frame({ section, params }, t) {
    for (const u of section.units) {
      if (!u.revealed) continue;
      const k = clamp01((t - u.at) / 0.28);
      u.ch.visible &&= t >= u.at;
      const s = lerp(params.scale, 1, section.motion.enter(k));
      u.ch.isx *= s; u.ch.isy *= s;
      u.ch.opacity *= clamp01(k * 6);
    }
  },
});
```

Then register the meta in `registry.ts` (the test `registry: every trait folder is registered…` fails otherwise) and
add any `style.css` next to `impl.ts`. Params arrive in `c.params` with their unprefixed names; in recipes and specs
they are addressed `<axis>.<param>` (`"reveal.scale": 2.5`).

## 3. Units, parts and channels

The host creates one **content unit** per cue-sheet item (`section.units[i].item === i`, so `kind`, `text`,
`emphasis`, `ltr`, `graphemes` and `at` come from `@reel/core`'s `sectionItems`). Layouts and materials add
**decoration units** with `host.deco(section, { deco: 'rule', … })` (`item = -1`). Only units with `item ≥ 0` are
reported to QA by `boxes()`; a `logos` item must therefore be drawn by a unit that keeps that item index.

Each unit becomes `div.u` (the outer box at `unit.box`, clipping when `unit.masked`) containing `div.t` (the inner
content at `unit.textAt`, font from `unit.font`, colour `unit.color`, text / `html` / `mount`). With `unit.split` ≠
`none` the inner text is replaced by measured part spans (`unit.parts`, whitespace dropped, logical order). If
`unit.inkBox` is set, an invisible ink box moving with the inner element is what QA measures.

Channels are reset to identity before every frame. Add (`+=`) translations and rotations, multiply (`*=`) scales and
opacity, and use `&&=` on `visible`, so traits compose.

| record | fields | written to |
|---|---|---|
| `unit.ch` (outer) | `tx ty sx sy rot opacity blur visible`, `clip` + `clipFrom` (inset reveal; start/end follow text direction) | `div.u` transform (translate → rotate → scale, origin `unit.origin`), opacity, filter, clip-path, visibility |
| `unit.ch` (inner) | `itx ity isx isy irot`, `color`, `glow` + `glowColor`, `split` (RGB split px), `wght` | `div.t` transform (origin `unit.innerOrigin`), colour, text-shadow, font-weight |
| `part.ch` | `tx ty sx sy rot opacity blur color glow glowColor split glyph` | part span; `glyph` replaces its text (slot spin, scramble); it must be the real text again by the section hold |
| `layer.ch` | `visible opacity clip` (CSS clip-path string), `tx ty s blur` (push of the layer's content) | `.layer` / `.cam` |
| `host.stageCh` | `kick` (zoom ×(1+kick)), `shakeX shakeY shakeRot`, `flash` + `flashColor` | every visible layer's camera, the flash overlay |

A unit whose `visible` is false, whose opacity or clip is 0, or whose scale is (near) 0 is hidden and not reported to
QA. Glow and split shadows use `--split-a` / `--split-b` (magenta / cyan by default; override in your CSS).

**Tags** (`unit.tags`) carry semantics from the layout to the other axes so they never re-derive roles: `hero` (the
section's key unit), `align` (`'start' | 'end'` for aligned accent lines), `line`, `numeric` (date/time/stat/countdown
values), and `ordinal`: the host numbers the reel's emphasised textual units (emphasis, not hero, not numeric) in
reel order after layout, so a reveal and a material can rotate treatments in lockstep (`ordinal % 3`).

## 4. Hooks and their call order

Scope: `camera`, `layout` and `background` are **layer-scoped** (`LayerCtx { host, layer, params }`, one instance per
scene layer, taken from the layer's first section). All other axes are **section-scoped** (`SectionCtx` adds
`section`). Every hook is optional except `camera.view`, `layout.layout` and `motion.curves`.

Setup (once, inside `reelPage.ready()`):

1. Host: palette/font custom properties, scene layers and section groups, content units; fonts loaded, logos decoded.
2. Per section: `motion.curves(c)` → `section.motion`; `rhythm.setup(c)`.
3. Per content unit: `unit.prepare(c, u)` (default `split`).
4. Per layer: `layout.layout(c)`: typeset and place every unit (`font`, `box`, `textAt`, `inkBox`, `baseline`,
   `tags`), create decorations, set each section's `place`, `frame`, `bounds`, optionally `layer.intro`. It may call
   `host.zoomRange(section)` (camera `range` × rhythm `headroom`) and `host.metrics(text, weight, ltr)`.
5. Host assigns `tags.ordinal`.
6. Per unit: `reveal.prepare(c, u)` for units with `revealed` (content by default, plus decorations the layout marked
   `revealed: true`), then `material.prepare(c, u)` for every unit.
7. `setup(c)` of every other trait in axis order (camera, layout, unit, reveal, motion, axis, material, background,
   transition). Last chance to create decorations (`host.deco` throws afterwards).
8. Host builds the DOM (units sorted by `z`, then creation order), splits parts, then applies `section.place`
   (`translate(x, y) rotate(rot)`) to each section group.
9. `mount(c)` of every trait in axis order: the DOM exists (`unit.el/inner/parts`, `layer.under/back/over`).

Every frame (`seek(t)`), for the layers whose window contains t (§6):

1. Reset stage, layer and unit/part channels.
2. `rhythm.frame` (sections) → `camera.view` (sets `layer.view`), then `camera.frame` → `layout.frame` →
   `unit.frame` → `reveal.frame` → `motion.frame` → `axis.frame` → `material.frame` (sections) →
   `background.frame` (layers) → `transition.frame` (sections).
3. For each layer inside its incoming transition window: the incoming first section's `transition.between`.
4. One commit.

Per-axis extras:

| axis | extra hooks | contract |
|---|---|---|
| rhythm | `headroom(c)`, `pulse(c, t)` | largest kick zoom while the section holds (layouts fit against it); beat pulse for others (`section.pulse(t)`, default `host.beatPulse(t)`) |
| camera | `view(c, t)`, `range(c, s)` | `View {x, y, r, s}`: layer point (x, y) shown at the safe-area centre, rotated −r°, scaled s; identity is `{x: cx, y: cy, r: 0, s: 1}`. `range` = zoom multipliers [lo, hi] around a section's frame during its hold |
| layout | `layout(c)` | see setup step 4 |
| unit | `prepare(c, u)` | `word`: multi-word items split into word parts; `grapheme`: every text unit split into graphemes |
| reveal | `prepare(c, u)` | choose per unit; set `split`, `masked`, origins, `hit`; keep choices in `u.data.reveal` |
| motion | `curves(c)` | `Motion { enter, bounce(k, c), exit, inOut }`; every reveal and decoration should ease through `section.motion` so a motion swap restyles everything |
| material | `prepare(c, u)` | `u.color`, static `u.style`/`innerStyle`; may create decorations (swipes) in `setup` |
| background | — | draw into `layer.under` (screen space, behind), `layer.back` (layer space, moves with the camera), `layer.over` (screen space, in front) |
| transition | `between(c, w, t)`, `move(c, a, b, k)` | layer scope: write `w.incoming.ch` / `w.outgoing.ch` while t ∈ [w.t0, w.t1); world scope: the camera path between two keys at linear progress k (`section.travel` calls it) |

## 5. Geometry helpers

- `host.safe`: `{left, top, right, bottom, w, h, cx, cy}`; fit text into `w × h` minus a margin and divide by
  `host.zoomRange(section)[1]` so camera drift and rhythm kicks cannot push it out.
- `host.metrics(text, weight, ltr, family?)`: Canvas2D ink and font metrics per 1 px of font size (kerning on,
  cached). The kinetic-quote layout positions text so its ink sits exactly on the computed baseline; copy that recipe
  (world-blocks `layoutBlock`) for any layout that needs ink-tight boxes.
- `host.dir` / `section.dir`: `'rtl'` for Hebrew specs. Start/end, not left/right: lines start at the start edge,
  rules grow away from text, slides come from the start side.
- `host.accent(i)` wraps around the palette; CSS sees `--bg --text --a0…--a7 --display --textfont`.
- `host.el(tag, cls, parent, style)` for trait-owned DOM; `host.images` holds decoded logos (clone them).

## 6. Scene layers, world chains and transitions

`resolveStyles` partitions the sections into **scene layers** (`REEL.scenes`). Each layer has one background, one
camera and one `.cam` holding a content group per section.

- A **world chain** is a run of consecutive sections whose incoming transition has `scope: 'world'` and that share
  layout, camera and background traits *and* their params, with `layout.world && camera.world`. They share one layer
  and one camera (kinetic-quote: one paper world, the camera pans/turns from block to block).
- Every other section starts a new layer. Its incoming transition (`scope: 'layer'`) bridges the outgoing layer and
  the new one during the window `[prev.timing.out, section.timing.in]` (the cue sheet's `camera-move` cue).
- An invalid transition (a world-scope one where no chain can form) falls back to `cut`; the resolver records a
  `transition-fallback` warning that ends up in `qa.json` (gate `style`) and in `receipt.json` (`styles.diagnostics`).
- Layer windows: a layer is evaluated and drawn from its incoming window's start to the end of the next layer's
  incoming window (both layers are visible inside a window, incoming on top). `between` decides what each shows:
  `cut` hides the outgoing layer at the window start; a panel wipe would clip the incoming layer
  (`ch.clip = 'inset(…)'`), push/blur the outgoing content (`ch.tx/ty/s/blur`) and draw its accent panels in its own
  elements (insert them before `w.incoming.el`).
- Reveals own **exits** too: `section.next`, `section.timing.out` and `section.window` tell a reveal when its content
  has to be gone (neon whip/zoom/fall). Exit only when there is a next section in another layer
  (`section.next && section.next.layer !== section.layer`); inside a world chain the camera moves on instead.
- The job's choreography (timing engine) comes from the job style's dominant recipe; per-section styles do not
  change timing.

## 7. Fingerprint duty

`reelPage.fingerprint(t0, t1)` keys the chunk cache: **two specs with equal fingerprints for a window must render
identical frames there**, and a date-only edit must change only the windows that show the date. The host builds it
from, for every layer visible in the window:

- format, palette, fonts, direction, beat grid;
- each layer-scoped trait's id, params and `fingerprint()`; `layer.data`, `layer.intro`, the layer window;
- for every section of the layer: id, role, timing, window, resolved style (traits + params) and the
  `fingerprint()` of each of its section-scoped traits;
- for sections that can be **on screen** in the window, additionally `place`, `frame`, `bounds`, `section.data` and a
  snapshot of every unit (text, kind, tags, font, box, textAt, inkBox, baseline, classes, static styles, html,
  `mountKey`, split, masked, revealed, colour, origins, hit, `unit.data`). In a world layer "on screen" means its
  `bounds` (+40) meet the camera view (+80 px slack) at any quarter-frame of the window, or its time span overlaps it;
  in other layers every section counts.

Your duty as a trait author:

1. Keep setup-derived, pixel-relevant state in `unit.data[axis]`, `section.data[axis]` or `layer.data[axis]` as plain
   JSON. It is fingerprinted automatically, but only when the section can be on screen.
2. State you keep elsewhere (a module `WeakMap`, closures) must be returned from `fingerprint(c, t0, t1)`, limited to
   what reaches the window (camera keys active in the window, kicks within their decay length, bursts alive then).
3. Anything that draws outside its own section's units (stage kick/shake/flash, a camera, a background, an FX canvas)
   must report what reaches the window from `fingerprint()`; it is called even when the section is off screen.
4. A `mount` callback cannot be serialised: set `unit.mountKey` to a string that changes whenever its output does.
5. Do not put whole-reel state into `layer.data` if one section's content changes it (a date edit would then
   invalidate every chunk); report the window's slice from `fingerprint()` instead (see `camera/pan-turn`).

`node packages/traits/dev/stills.ts --spec <spec> [--date YYYY-MM-DD]` prints which windows change for a date-only
edit, plus contact sheets, safe-area/overlap checks and both determinism checks.

## 8. CSS and decorations

- `host/host.css` is always first in `engine.css`; each used trait's `style.css` follows in axis order. Scope
  selectors to your classes (`.u.rule`, `.swipe`, `.grid`) and use the palette custom properties.
- Decorations are units: create them in `layout.layout` or a `setup` via `host.deco(section, {deco, box, cls, style,
  html, mount, z, origin, at, revealed})` and animate them from your `frame` through their channels. Store the
  animation spec in `unit.data[axis]`. Use `z` for stacking (world-blocks: block rules −3, swipes −2, accent rules −1,
  text 0, quotes/badge 1).
- Shared pieces live in `lib/deco.ts`: `logoBadge(host, logos, maxW, opts)` (sized badge + `mount` + `key`; give it to
  the unit of the `logos` item so QA sees it), `pinSVG(size, colours)` with `PIN_METRICS` (sits on a baseline like a
  glyph) and `quoteSVG(kind, size, colour)`. Add Bauhaus shapes, cups, stripes there if two traits need them.

## 9. Adding a style (recipe)

`packages/styles/<id>/recipe.json`, validated by `StyleRecipe` in `@reel/core`, registered in
`packages/styles/src/index.ts`:

```json
{
  "id": "swiss-title-reveal", "name": "…", "families": ["reveal"], "energy": 3, "background": "light",
  "traits": { "rhythm": "…", "camera": "…", "layout": "…", "unit": "…", "reveal": "…", "motion": "…",
              "axis": "…", "material": "…", "background": "…", "transition": "…" },
  "params": { "<axis>.<param>": 0.5 },
  "defaults": { "palette": "…", "music": { "preset": "…", "bpm": 120 }, "fonts": { "display": "rubik" } },
  "constraints": { "maxWordsPerSection": 5, "formats": ["9:16", "1:1", "4:5", "16:9"], "roles": ["…"] },
  "choreography": { … }
}
```

All ten axes are required and must name registered traits; `params` keys must be params of the recipe's own trait on
that axis and inside [min, max]. `constraints.roles` narrows the layout's `roles`. `signature: {module, owns}` locks
axes against spec overrides; use it only when one module truly owns several axes.

Specs combine styles three ways, all resolved by `resolveStyles` (tests in `resolve.test.ts`):

- **override**: `"style": { "base": "kinetic-quote", "traits": { "motion": "overshoot" }, "params": { "motion.overshoot": 2 } }`;
- **per section**: `section.style` (a style id or the same object) resolves independently for that section;
- **blend**: `"blendWith": { "style": "…", "mix": 0.3 }`. Discrete traits come from the dominant side (`mix < 0.5`
  → base). Every param of the final traits lerps `a + (b − a) · mix`, where each side's value is its recipe override,
  else its own trait's default for that param, else the final trait's default. Spec `params` then override.

Then render the shared test set (`examples/test-set/*.json`) with QA passing in all four formats.

## 10. Expressing the other catalog styles

| feature | where it goes |
|---|---|
| per-section solid backgrounds + panel wipes (up/down/rtl/ltr/doors/iris/diag), 1–2 accent panels leading | `background: solid` per layer (each non-world section is its own layer); `transition: panel-wipe` with `between` writing `incoming.ch.clip`, `outgoing.ch.tx/ty/s/blur`, and drawing its own accent-panel elements inserted before `w.incoming.el` |
| Bauhaus circles/half-circles/stripes/rules/cup, pulsing on the beat | decorations created by the layout (or material) via `host.deco`, animated in its `frame`, pulse from `section.pulse(t)` |
| letters rise from a baseline mask with stagger, line slides from a mask edge, pop with overshoot, rules grow | reveal with `split: 'grapheme'` + `masked`, part `ty` in em-scaled px (`u.font.size`); slide = inner `itx`; pop = `sx/sy` via `motion.bounce`; grow = `sx` with `origin` |
| odometer digits | reveal `mount` appends its own digit-strip elements to `u.el` (never to `u.inner`: QA reads the inner text) at the digit parts' measured rects and hides those parts (part `opacity`) while they spin; `glyph` is enough for a simple slot spin. The real digits must show at the hold |
| static camera, centred stack layout | `camera: static` (`view` returns identity), `layout: center-stack` (`world: false`) |
| dark canvas background (starfield, orbs, atom, energy pulse) | `background` with `layer: 'canvas'`, a canvas in `layer.under` redrawn fully in `frame` from t and `host.beatPulse` |
| FX canvas: bursts, rings, flashes | material (or rhythm) trait owning a canvas in `layer.over`; flashes via `host.stageCh.flash`; report live bursts from `fingerprint()` |
| neon glow + RGB split | material sets `ch.glow/glowColor/split` (unit or parts) |
| slam / drop / pop / scramble / slot | reveal; `glyph` for scramble/slot; declare `u.hit` for impacts |
| exits (whip, zoom, fall) | reveal, ending by `section.timing.out` when `section.next && section.next.layer !== section.layer` |
| camera shake on hits | camera trait summing `u.hit` of the layer's units into `host.stageCh.shake*` (report the hits in the window from `fingerprint()`) |
