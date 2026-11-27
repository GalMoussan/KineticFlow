import type { CueSheet } from './cue.ts';
import type { Format } from './formats.ts';
import type { JobSpec } from './spec.ts';
import type { SoundCue } from './sound.ts';
import type { SketchDoc, SketchLook, SketchPlace } from './sketch.ts';
import type { TraitAxis } from './style.ts';

/**
 * Fully resolved style of one section after overrides and blending (PLAN.md §5.3), produced by
 * `resolveStyles` in `@reel/traits`. `traits.transition` is the effective one (after any fallback).
 */
export interface ResolvedStyle {
  /** The dominant recipe: its discrete traits, defaults and choreography apply. */
  recipe: string;
  traits: Record<TraitAxis, string>;
  /** Every param of every trait in `traits`, keyed `<axis>.<param>`, blended and overridden. */
  params: Record<string, number>;
  /**
   * The section's colours: its own `palette`, else the job's `palette` for sections of the job's dominant recipe, else
   * the default palette of its own dominant recipe. (On `job`: the job palette.)
   */
  palette: ResolvedPalette;
}

/**
 * A scene layer: one background + camera shared by consecutive sections. Several sections share one layer only as
 * a world chain (world layout, equal layout/camera/background, camera-move transitions between them).
 */
export interface Scene {
  /** Section ids in reel order. */
  sections: string[];
  world: boolean;
}

export interface ResolvedPalette {
  bg: string;
  text: string;
  accents: string[];
}

export interface FontRef {
  /** CSS family name to register with `FontFace`. */
  family: string;
  /** URL relative to the bundle root. */
  url: string;
  /** Variable weight range, or a single static weight as [w, w]. */
  weights: [number, number];
}

export interface LogoRef {
  id: string;
  url: string;
  /** Intrinsic pixel size, so layout needs no decode round-trip. */
  w: number;
  h: number;
}

/** Injected as `window.REEL` before any page script runs (live preview and capture alike). */
export interface ReelInput {
  spec: JobSpec;
  /** Timing, sections with timed items, cues. `cues.sections` is the content the page draws. */
  cues: CueSheet;
  format: Format;
  /** Section id → resolved style. */
  styles: Record<string, ResolvedStyle>;
  /** Scene layers in reel order; every section belongs to exactly one. */
  scenes: Scene[];
  /** Params of the job-level style (`spec.style`) after blending; part of the job-wide look. */
  params: Record<string, number>;
  /** The job palette (`spec.palette`); sections may use others (`styles[id].palette`). */
  palette: ResolvedPalette;
  fonts: { display: FontRef; text: FontRef };
  logos: LogoRef[];
  /** Section sketches in reel order (absent when the job has none). Timing comes from the cue sheet's sketch cues. */
  sketches?: SketchRef[];
}

/** One sketch as the page draws it: the resolved drawing, look and placement request. */
export interface SketchRef {
  id: string;
  /** Owning section id. */
  section: string;
  /** Last section id it stays through (its own by default). */
  until: string;
  /** sha256 of the drawing's canonical JSON (`sketchDocHash`); part of every fingerprint it reaches. */
  hash: string;
  /** The drawing, inline (presets and generated docs alike; not a bundle file, SKETCH-PLAN.md SK16). */
  doc: SketchDoc;
  look: SketchLook;
  place: SketchPlace;
}

/** Where a sketch sits on screen (`ReelPage.overlays()`), for the sketch QA gates. */
export interface OverlayBox {
  id: string;
  section: string;
  /** Placement mode as requested. A `word` sketch is drawn on its word, inside the word's own transforms (P5). */
  place: SketchPlace['mode'];
  layer: 'under' | 'over';
  /** Auto placement found no free space wide enough and put the sketch under the text. */
  fallback: boolean;
  /** The content item a `word` placement points at. */
  item?: number;
  /** How a `word` placement fits its word (an `around` ring covers only its band; QA measures that, not its box). */
  fit?: Extract<SketchPlace, { mode: 'word' }>['fit'];
  /** A `word` sketch's pen width in screen px (the ring's band is the ellipse inside its box, this thick). */
  pen?: number;
  /** The word inside the item a `word` placement names (`place.part`), and that word's screen box while drawn. */
  part?: number;
  word?: { x: number; y: number; w: number; h: number };
  /**
   * A `word` sketch inside its time window: whether its word is on screen now. When it is `hidden` (its unit or the
   * word's letters are not drawn) or `offscreen`, the sketch hides with it.
   */
  anchor?: 'shown' | 'hidden' | 'offscreen';
  /** Drawn at the current `t`. */
  visible: boolean;
  /** Screen pixels: axis-aligned box of the placed drawing (after rotation, or after the word's transforms). */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextBox {
  section: string;
  /** Index into the section's items. */
  unit: number;
  text: string;
  /** Screen pixels, axis-aligned (after camera transforms). */
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Page contract, shaped like HyperFrames' frame adapter: `ready` once, then `seek` many times in any order.
 * `seek(t)` must be a pure function of `t` and resolve only after the frame is painted.
 */
export interface ReelPage {
  readonly width: number;
  readonly height: number;
  ready(): Promise<void>;
  seek(t: number): Promise<void>;
  /** Text items visible at `t` (call after `seek(t)`), for the bounds/overlap/fidelity QA gates. */
  boxes(): TextBox[];
  /**
   * Everything that can influence pixels of frames in [t0, t1): layout geometry, text, colours, timings of the
   * elements that may be on screen. JSON-serialisable; the renderer hashes it into the chunk cache key, so two
   * specs with equal fingerprints for a range MUST render identical frames there.
   */
  fingerprint(t0: number, t1: number): unknown;
  /**
   * Sound effects for what the page animates (impacts, wipes, camera moves, ticks, flashes), sorted by `t`.
   * Pure function of `REEL`; valid after `ready()`.
   */
  soundCues(): SoundCue[];
  /** Every sketch's placement, with `visible` for the last `seek(t)`. Absent on pages without overlays. */
  overlays?(): OverlayBox[];
  destroy?(): void;
}

declare global {
  interface Window {
    REEL: ReelInput;
    reelPage: ReelPage;
  }
}
