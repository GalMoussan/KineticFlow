/** Shared state of the word-per-beat traits (`layout/beat-stack` writes it; `reveal/beat-cut`, `material/beat-swap` read it). */

/** `section.data.layout` of a beat-stack section. */
export interface BeatSection {
  /** Recap time: the solos give way to the banded stack of the real units. */
  stackT: number;
  /** Content units. */
  n: number;
}

/** `unit.data.layout`: solo copy, full-frame panel, recap band, or a recap row (the content unit itself). */
export type BeatData =
  | { kind: 'solo'; of: number; k: number }
  | { kind: 'panel' }
  | { kind: 'band'; of: number; k: number; row: number }
  | { kind: 'row'; k: number; row: number };
