import type { CueSheet } from './cue.ts';
import type { Format } from './formats.ts';
import type { JobSpec } from './spec.ts';
import type { StyleRecipe, TraitAxis } from './style.ts';

/** Fully resolved per-section style after overrides and blending (PLAN.md §5.3). */
export interface ResolvedStyle {
  recipe: StyleRecipe['id'];
  traits: Record<TraitAxis, string>;
  params: Record<string, number>;
}

export interface ResolvedPalette {
  bg: string;
  text: string;
  accents: string[];
}

/** Injected as `window.REEL` before any page script runs (live preview and capture alike). */
export interface ReelInput {
  spec: JobSpec;
  cues: CueSheet;
  format: Format;
  /** Section id → resolved style. */
  styles: Record<string, ResolvedStyle>;
  palette: ResolvedPalette;
  /** Asset id → URL relative to the bundle root (fonts, logos). */
  assets: Record<string, string>;
}

export interface TextBox {
  section: string;
  text: string;
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
  /** Visible text boxes at `t`, for the QA bounds/overlap/fidelity gates. */
  boxes(t: number): TextBox[];
  destroy?(): void;
}

declare global {
  interface Window {
    REEL: ReelInput;
    reelPage: ReelPage;
  }
}
