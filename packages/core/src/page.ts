import type { CueSheet } from './cue.ts';
import type { Format } from './formats.ts';
import type { JobSpec } from './spec.ts';
import type { TraitAxis } from './style.ts';

/** Fully resolved per-section style after overrides and blending (PLAN.md §5.3). */
export interface ResolvedStyle {
  recipe: string;
  traits: Record<TraitAxis, string>;
  params: Record<string, number>;
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
  /** Section id → resolved style (M2; M1 renders one monolithic style for every section). */
  styles: Record<string, ResolvedStyle>;
  /** Style params after blending. */
  params: Record<string, number>;
  palette: ResolvedPalette;
  fonts: { display: FontRef; text: FontRef };
  logos: LogoRef[];
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
  destroy?(): void;
}

declare global {
  interface Window {
    REEL: ReelInput;
    reelPage: ReelPage;
  }
}
