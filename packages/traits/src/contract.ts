/**
 * The trait contract (PLAN.md §5): what a trait implementation sees and may do. Type-only plus identity helpers, so
 * it is safe to import from Node. The page host that drives these hooks is `host/host.ts`; the authoring guide is
 * `packages/traits/README.md`.
 */
import type {
  ItemKind,
  ParamSpec,
  ReelInput,
  ReelSection,
  ResolvedPalette,
  ResolvedStyle,
  SectionRole,
  SectionTiming,
  SoundCue,
  TraitAxis,
  TraitMeta,
} from '@reel/core';

/** Trait params as the implementation receives them (unprefixed names, resolved values). */
export type ParamsOf<M extends TraitMeta> = { readonly [K in keyof M['params']]: number };

/** Declares a trait's metadata with its literal param names kept, checked against `TraitMeta`. */
export const defineMeta = <const M extends TraitMeta & { params: Record<string, ParamSpec> }>(m: M): M => m;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Camera state of a scene layer: the layer point (x, y) is drawn at the focus point (the centre of the format's safe
 * area), rotated by −r degrees and scaled by s. `{ x: cx, y: cy, r: 0, s: 1 }` is the identity.
 */
export interface View {
  x: number;
  y: number;
  r: number;
  s: number;
}

/** Per-unit channel record. Reset to identity before every frame; traits add into or multiply it; one commit writes it. */
export interface Channels {
  // ── outer box (the unit's element, in its section group's coordinates; transform origin `unit.origin`) ──
  tx: number;
  ty: number;
  sx: number;
  sy: number;
  /** Degrees. */
  rot: number;
  /**
   * skewX in degrees, applied between rotate and scale (`rotate → skewX → scale`), so rot + skx + sx/sy express any
   * 2D linear map: planar faces in parallel projection (isometric, card flips, orthographic orbits). Use
   * `affine()` from `@reel/runtime` to decompose a matrix. Never 3D transforms (composited, see README §1).
   */
  skx: number;
  opacity: number;
  /** px. */
  blur: number;
  // ── inner content, moving inside the outer box (which clips it when `unit.masked`; origin `unit.innerOrigin`) ──
  itx: number;
  ity: number;
  isx: number;
  isy: number;
  irot: number;
  /** Inner skewX in degrees (as `skx`). */
  iskx: number;
  /** Visible fraction 0..1 of the outer box, revealed from `clipFrom` (an inset clip); 1 = no clip. */
  clip: number;
  /** `start`/`end` follow the section's text direction. */
  clipFrom: 'start' | 'end' | 'top' | 'bottom';
  /** Fill colour override for this frame; null = `unit.color`. */
  color: string | null;
  /** Glow blur radius in px (0 = none); the outer halo is 3× wider. */
  glow: number;
  /** null = the fill colour. */
  glowColor: string | null;
  /** RGB-split offset in px (two shadows in `--split-a` / `--split-b`). */
  split: number;
  /**
   * Extra `text-shadow` layers appended after glow/split (comma-separated CSS, '' = none), in the inner element's
   * own (transformed) coordinates: stacked offsets give extrusion, long shadows, stickers' outlines.
   */
  shadow: string;
  /** Absolute `font-weight` for this frame; 0 = `unit.font.weight`. DOM flow only (measured units do not reflow). */
  wght: number;
  /**
   * Variable-font width axis (`wdth`, % of normal) for this frame via `font-variation-settings`; 0 = the font's
   * default. Fonts without the axis ignore it. DOM flow only (measured parts keep their places).
   */
  wdth: number;
  /** false hides the unit regardless of the other channels. */
  visible: boolean;
}

/** Channels of one grapheme/word part of a split unit (positions are relative to the part's measured place). */
export interface PartChannels {
  tx: number;
  ty: number;
  sx: number;
  sy: number;
  rot: number;
  /** skewX in degrees (as `Channels.skx`). */
  skx: number;
  opacity: number;
  blur: number;
  color: string | null;
  glow: number;
  glowColor: string | null;
  split: number;
  /** Extra `text-shadow` layers (as `Channels.shadow`). */
  shadow: string;
  /** Text shown instead of the part's own (slot spin, scramble); null = its own. Must be final at section holds. */
  glyph: string | null;
  /** Absolute `font-weight` of this part for this frame; 0 = the unit's weight. The part keeps its measured place. */
  wght: number;
}

/** Stage-level channels: shared by every visible layer's camera, reset per frame. */
export interface StageChannels {
  /** Added zoom: the camera scale is multiplied by (1 + kick) around the focus point. */
  kick: number;
  shakeX: number;
  shakeY: number;
  /** Degrees. */
  shakeRot: number;
  /** Full-frame flash opacity 0..1 over everything. */
  flash: number;
  flashColor: string;
}

/** Scene-layer channels, written by transitions (and backgrounds). */
export interface LayerChannels {
  visible: boolean;
  opacity: number;
  /** CSS `clip-path` of the whole layer (background and content), or null. */
  clip: string | null;
  /** Push of the layer's content (camera), around the focus point; the background stays. */
  tx: number;
  ty: number;
  s: number;
  blur: number;
}

/** One measured part of a split unit (`runtime/split.ts` measured-absolute spans; whitespace parts are dropped). */
export interface Part {
  /** Logical order inside the unit (sequential reveals); spatial sweeps sort by `x`. */
  index: number;
  text: string;
  span: HTMLSpanElement;
  /** Measured rect relative to the unit's inner element, untransformed px. */
  x: number;
  y: number;
  w: number;
  h: number;
  ch: PartChannels;
}

/** Semantic tags the layout puts on units; reveals and materials map tags to behaviour instead of re-deriving roles. */
export interface UnitTags {
  /** The section's key unit (the title's last word, …). */
  hero: boolean;
  /** Aligned accent line (not justified/centred): the side it hugs, in text direction. */
  align: 'start' | 'end' | null;
  /** Line index inside the section (-1 = none). */
  line: number;
  /**
   * Index among the reel's emphasised textual units (emphasis, not hero, not numeric), in reel order; -1 otherwise.
   * Assigned by the host after layout so every trait cycles treatments identically.
   */
  ordinal: number;
  /** Date, time, stat or countdown value. */
  numeric: boolean;
}

/** How a unit's text is split into parts (decided by the `unit` trait, overridable by a reveal's `prepare`). */
export type Split = 'none' | 'word' | 'grapheme';

export interface Unit {
  readonly id: number;
  readonly section: Section;
  /** Index into `section.cue.items`; -1 for decorations. Units with item ≥ 0 are what `boxes()` reports. */
  readonly item: number;
  readonly kind: ItemKind | 'deco';
  /** Decoration name (`pin`, `quote`, `rule`, `badge`, `swipe`, …) for item = -1 units; null for content. */
  deco: string | null;
  /** NFC text (content units); '' for decorations. */
  text: string;
  emphasis: boolean;
  /** Lay out left-to-right inside a right-to-left section (numbers, Latin). */
  ltr: boolean;
  graphemes: number;
  /** Landing time in seconds (content: the timing engine's `at`); NaN when it does not land. */
  at: number;
  tags: UnitTags;
  // ── typography + geometry, set by the layout trait (section-group coordinates, untransformed px) ──
  font: { family: 'display' | 'text'; size: number; weight: number };
  /** The outer element's box: the mask when `masked`. */
  box: Rect;
  /** Position of the inner element's top-left inside `box`. */
  textAt: { x: number; y: number };
  /** Ink rect relative to the inner element (what QA reads); null = the outer box. */
  inkBox: Rect | null;
  /** Baseline y in group coordinates (NaN when not text). */
  baseline: number;
  /** Extra class names of the outer / inner element. */
  cls: string;
  innerCls: string;
  /** Static inline styles, applied once at build. */
  style: Record<string, string>;
  innerStyle: Record<string, string>;
  /** Inner content: `text` by default; `html` (SVG…) or `mount` (appends nodes) instead. `null` + no html = no inner. */
  html: string | null;
  mount: ((inner: HTMLElement) => void) | null;
  /** Fingerprint stand-in for what `mount` draws (it cannot be serialised). */
  mountKey: string;
  /** Stacking inside the group: lower first; equal z keeps creation order. */
  z: number;
  // ── set by unit / reveal / material `prepare` ──
  split: Split;
  /** The outer box clips the inner content. */
  masked: boolean;
  /** Animated by the section's reveal trait (content units by default); otherwise its creator animates it. */
  revealed: boolean;
  /** Base fill colour (CSS colour). */
  color: string;
  /** CSS transform-origin of the outer / inner element. */
  origin: string;
  innerOrigin: string;
  /** An impact (camera shake, flash, burst) the unit causes, declared by its reveal. */
  hit: { t: number; amp: number } | null;
  /** Serialisable per-unit trait state, keyed by axis (`data.reveal = { anim: 'mask' }`). Fingerprinted. */
  data: Partial<Record<TraitAxis, unknown>>;
  // ── DOM, available from `mount` on ──
  el: HTMLElement | null;
  inner: HTMLElement | null;
  ink: HTMLElement | null;
  parts: Part[];
  /** Extra elements a trait attaches to the unit (not fingerprinted). */
  els: Record<string, HTMLElement>;
  ch: Channels;
}

/** Easing curves of a section's `motion` trait; every reveal/decoration should ease through these. */
export interface Motion {
  /** Entrance curve 0→1 (smooth: expo-out; overshoot: back-out). */
  enter(k: number): number;
  /** Physical entrances (drop, pop, slot): back-out whose overshoot `c` the motion scales. */
  bounce(k: number, c: number): number;
  /** Exit curve 0→1 (accelerating). */
  exit(k: number): number;
  /** Symmetric in-out curve (camera moves, wipes). */
  inOut(k: number): number;
}

export interface SafeBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
  w: number;
  h: number;
  /** Focus point: the safe area's centre. */
  cx: number;
  cy: number;
}

export interface Metrics {
  /** Ink box left/right of the pen origin, ink ascent/descent, font ascent/descent; all per 1 px of font size. */
  bl: number;
  br: number;
  ia: number;
  id: number;
  fa: number;
  fd: number;
  /**
   * Pen advance per 1 px of font size (`measureText` width). Absent on hand-built pin and badge metrics.
   * Positive `bl` is ink to the left of the pen; a negative `bl` is ink to the right of it.
   */
  w?: number;
}

export interface Section {
  readonly index: number;
  readonly id: string;
  readonly role: SectionRole;
  /** The cue sheet's section: timed items and timing. */
  readonly cue: ReelSection;
  readonly timing: SectionTiming;
  readonly style: ResolvedStyle;
  /** The section's colours (`style.palette`). Never read another palette for this section's content. */
  readonly palette: ResolvedPalette;
  readonly layer: Layer;
  readonly dir: 'rtl' | 'ltr';
  readonly prev: Section | null;
  readonly next: Section | null;
  /** Incoming transition window [t0, t1] = [prev.out, this.in]; null for the first section. */
  readonly window: { t0: number; t1: number } | null;
  /** Content units first (units[i].item === i), then decorations in creation order. */
  readonly units: Unit[];
  /** The section's content group inside its layer's camera; units are positioned in its coordinates. */
  readonly group: HTMLElement;
  /** Group placement in layer coordinates (set by the layout; applied after splitting). */
  place: { x: number; y: number; rot: number };
  /** Camera key for this section (layout). Identity by default. */
  frame: View;
  /** Layer-coordinate AABB of everything the section draws (layout); null = treat as always on screen. */
  bounds: { x0: number; y0: number; x1: number; y1: number } | null;
  /** The section's motion curves. */
  readonly motion: Motion;
  /** The section's rhythm pulse 0..1 (1 on a beat, decaying). */
  pulse(t: number): number;
  /** Camera travel from `a` to `b` at linear progress k, as the section's incoming transition shapes it. */
  travel(a: View, b: View, k: number): View;
  /** Serialisable per-section trait state, keyed by axis. Fingerprinted while the section can be on screen. */
  readonly data: Partial<Record<TraitAxis, unknown>>;
}

export interface Layer {
  readonly index: number;
  readonly world: boolean;
  /** Colours of the layer's sections (one per layer: world chains require equal palettes). CSS vars are set on `el`. */
  readonly palette: ResolvedPalette;
  readonly sections: Section[];
  /** Visible from `start` (incoming transition start) to `end` (the next layer's transition end, or the duration). */
  readonly start: number;
  readonly end: number;
  /** Mounts, back to front: `under` (screen space) · `cam` [`back` (layer space), `content` (section groups)] · `over` (screen space). */
  readonly el: HTMLElement;
  readonly under: HTMLElement;
  readonly cam: HTMLElement;
  readonly back: HTMLElement;
  readonly content: HTMLElement;
  readonly over: HTMLElement;
  /** Optional camera key before the first section (an intro close-up), set by the layout. */
  intro: View | null;
  /** This frame's camera, written by the camera trait. */
  view: View;
  ch: LayerChannels;
  /** Serialisable per-layer trait state (camera/layout/background), keyed by axis. Fingerprinted. */
  readonly data: Partial<Record<TraitAxis, unknown>>;
}

/** Everything about the page a trait may read; `deco`/`el`/`metrics` are its building helpers. */
export interface Host {
  readonly reel: ReelInput;
  readonly W: number;
  readonly H: number;
  readonly safe: SafeBox;
  /** Palette accent `i` (wrapping around) of a section's or layer's palette. */
  accent(i: number, of: Section | Layer): string;
  /** Reel text direction (from the spec language). */
  readonly dir: 'rtl' | 'ltr';
  /** CSS family names of the display/text fonts. */
  readonly families: { display: string; text: string };
  readonly stage: HTMLElement;
  readonly sections: readonly Section[];
  readonly layers: readonly Layer[];
  readonly stageCh: StageChannels;
  /** Decoded logo images by URL (clone them; never move the originals). */
  readonly images: ReadonlyMap<string, HTMLImageElement>;
  /** Canvas2D metrics per 1 px of font size (font kerning on; cached). */
  metrics(text: string, weight: number, ltr: boolean, family?: 'display' | 'text'): Metrics;
  /** Creates a decoration unit in `section` (item = -1). Only during `layout`/`setup`. */
  deco(section: Section, init: Partial<Omit<Unit, 'id' | 'section' | 'item' | 'kind'>> & { deco: string }): Unit;
  /** Camera/rhythm zoom range a hold may reach for `section`: [smallest, largest] scale multiplier. */
  zoomRange(section: Section): [number, number];
  /**
   * Creates an element. Called from a trait's `setup`/`layout`/`mount`, the element is **owned** by that trait
   * instance: while the instance is idle (its layer is not drawn this frame) the host hides it, unless the trait
   * implements `idle`.
   */
  el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: Element | null, style?: Record<string, string>): HTMLElementTagNameMap[K];
  /** Registers an element created otherwise (`innerHTML`, `cloneNode`) as owned by the running hook's instance. */
  own(el: HTMLElement | SVGElement): void;
  /**
   * Replaces a canvas drawn once (in `setup`/`mount`) by an `<img>` of its pixels, keeping class, inline style, CSS
   * size and ownership. Canvases are composited layers; composited content under text makes Chromium promote that
   * text into layers whose tiles depend on seek history (README §1). Redrawn-per-frame canvases cannot be frozen.
   */
  freeze(canvas: HTMLCanvasElement): Promise<HTMLImageElement>;
  /** Beat pulse from the cue sheet's beat grid: 1 on each beat, decaying as exp(−decay · age). */
  beatPulse(t: number, decay?: number): number;
  /**
   * Stereo position −1 (left) … 1 (right) of a unit as seen on screen at t (default: its landing `at`): its ink
   * centre through the section placement and the layer's camera at t, scaled so nothing is hard-panned.
   */
  pan(u: Unit, t?: number): number;
}

export interface LayerCtx<P> {
  readonly host: Host;
  readonly layer: Layer;
  readonly params: P;
}

export interface SectionCtx<P> extends LayerCtx<P> {
  readonly section: Section;
}

/** The two layers a layer-scoped transition bridges, and its window. */
export interface TransitionWindow {
  t0: number;
  t1: number;
  incoming: Layer;
  outgoing: Layer;
}

interface Hooks<C> {
  /** After layout and the prepare passes, before the host builds the DOM (create decorations, compute state). */
  setup?(c: C): void | Promise<void>;
  /** After the DOM is built and split (`unit.el/inner/parts` exist): attach trait-owned elements. */
  mount?(c: C): void | Promise<void>;
  /** Writes channels for time t. Must be a pure function of t (frames are seeked in any order). */
  frame?(c: C, t: number): void;
  /**
   * Called instead of `frame` on every seek where the instance is not evaluated (its layer is not drawn). Default
   * (no `idle`): the host sets `display: none` on every element the instance owns and restores the previous inline
   * `display` before its next `frame`. Implement it only to reset state the default cannot (e.g. clear a shared
   * canvas); it must not make anything visible.
   */
  idle?(c: C, t: number): void;
  /**
   * What, besides the host's automatic snapshot (trait ids, params, units, `data`, place/frame/bounds, timing), can
   * affect pixels in [t0, t1]. Called for every trait of every layer visible in the window, also for sections that
   * are off screen (their stage-level effects still count). JSON-serialisable.
   */
  fingerprint?(c: C, t0: number, t1: number): unknown;
  /**
   * Sound effects for what this instance animates (README §7a), called once after every `mount`. `section` defaults
   * to the instance's section. Landing sounds belong to the reveal: when a section's reveal has no `sounds`, the host
   * voices its content units itself (`hit` → impact, else pop).
   */
  sounds?(c: C): SoundCue[];
}

export interface RhythmTrait<M extends TraitMeta = TraitMeta> extends Hooks<SectionCtx<ParamsOf<M>>> {
  readonly meta: M;
  /** Largest zoom multiplier its stage kicks reach while the section holds (default 1). Called during layout. */
  headroom?(c: SectionCtx<ParamsOf<M>>): number;
  /** Beat pulse 0..1 for other traits (default: `host.beatPulse(t)`). */
  pulse?(c: SectionCtx<ParamsOf<M>>, t: number): number;
}

export interface CameraTrait<M extends TraitMeta = TraitMeta> extends Hooks<LayerCtx<ParamsOf<M>>> {
  readonly meta: M;
  /** Zoom multipliers [lo, hi] the camera applies around a section's frame while it holds (default [1, 1]). */
  range?(c: LayerCtx<ParamsOf<M>>, s: Section): [number, number];
  /** The layer's camera at t (also used by the host to find which world sections are on screen). */
  view(c: LayerCtx<ParamsOf<M>>, t: number): View;
}

export interface LayoutTrait<M extends TraitMeta = TraitMeta> extends Hooks<LayerCtx<ParamsOf<M>>> {
  readonly meta: M;
  /**
   * Places every content unit of the layer's sections (font, box, textAt, inkBox, baseline, tags) and creates its
   * decorations; sets each section's place/frame/bounds and optionally `layer.intro`. No DOM yet.
   */
  layout(c: LayerCtx<ParamsOf<M>>): void | Promise<void>;
}

export interface UnitTrait<M extends TraitMeta = TraitMeta> extends Hooks<SectionCtx<ParamsOf<M>>> {
  readonly meta: M;
  /** Default split of each content unit (before layout). */
  prepare?(c: SectionCtx<ParamsOf<M>>, u: Unit): void;
}

export interface RevealTrait<M extends TraitMeta = TraitMeta> extends Hooks<SectionCtx<ParamsOf<M>>> {
  readonly meta: M;
  /** Per revealed unit (after layout): choose its animation, `split`, `masked`, `hit`, origins; store choices in `u.data.reveal`. */
  prepare?(c: SectionCtx<ParamsOf<M>>, u: Unit): void;
}

export interface MotionTrait<M extends TraitMeta = TraitMeta> extends Hooks<SectionCtx<ParamsOf<M>>> {
  readonly meta: M;
  /** The section's easing curves (called before layout). */
  curves(c: SectionCtx<ParamsOf<M>>): Motion;
}

export interface AxisTrait<M extends TraitMeta = TraitMeta> extends Hooks<SectionCtx<ParamsOf<M>>> {
  readonly meta: M;
}

export interface MaterialTrait<M extends TraitMeta = TraitMeta> extends Hooks<SectionCtx<ParamsOf<M>>> {
  readonly meta: M;
  /** Per unit (after the reveal's prepare): colour and static surface styles. */
  prepare?(c: SectionCtx<ParamsOf<M>>, u: Unit): void;
}

export interface BackgroundTrait<M extends TraitMeta = TraitMeta> extends Hooks<LayerCtx<ParamsOf<M>>> {
  readonly meta: M;
}

export interface TransitionTrait<M extends TraitMeta = TraitMeta> extends Hooks<SectionCtx<ParamsOf<M>>> {
  readonly meta: M;
  /**
   * Layer scope: called while t ∈ [w.t0, w.t1) on the incoming layer's first section. Writes both layers' channels
   * (the host default is: both visible, incoming on top) and may draw its own elements.
   */
  between?(c: SectionCtx<ParamsOf<M>>, w: TransitionWindow, t: number): void;
  /** World scope: the camera path from key `a` to key `b` at linear progress k ∈ [0, 1]. */
  move?(c: SectionCtx<ParamsOf<M>>, a: View, b: View, k: number): View;
}

export interface TraitByAxis {
  rhythm: RhythmTrait;
  camera: CameraTrait;
  layout: LayoutTrait;
  unit: UnitTrait;
  reveal: RevealTrait;
  motion: MotionTrait;
  axis: AxisTrait;
  material: MaterialTrait;
  background: BackgroundTrait;
  transition: TransitionTrait;
}

export type AnyTrait = TraitByAxis[TraitAxis];

/** Identity helpers that type-check an implementation against its axis. */
export const defineRhythm = <const M extends TraitMeta>(t: RhythmTrait<M>) => t;
export const defineCamera = <const M extends TraitMeta>(t: CameraTrait<M>) => t;
export const defineLayout = <const M extends TraitMeta>(t: LayoutTrait<M>) => t;
export const defineUnit = <const M extends TraitMeta>(t: UnitTrait<M>) => t;
export const defineReveal = <const M extends TraitMeta>(t: RevealTrait<M>) => t;
export const defineMotion = <const M extends TraitMeta>(t: MotionTrait<M>) => t;
export const defineAxis = <const M extends TraitMeta>(t: AxisTrait<M>) => t;
export const defineMaterial = <const M extends TraitMeta>(t: MaterialTrait<M>) => t;
export const defineBackground = <const M extends TraitMeta>(t: BackgroundTrait<M>) => t;
export const defineTransition = <const M extends TraitMeta>(t: TransitionTrait<M>) => t;
