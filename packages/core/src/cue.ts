/** Timing engine output (PLAN.md §7): the one source of time for the page, the audio graph and QA. */

export const CUE_TYPES = [
  'section-in',
  'section-hold',
  'section-out',
  'land',
  'emphasis',
  'beat',
  'downbeat',
  'slam',
  'wipe',
  'camera-move',
  'slot-start',
  'slot-land',
  'drop',
  'endcard',
] as const;
export type CueType = (typeof CUE_TYPES)[number];

export interface Cue {
  /** Seconds from video start. */
  t: number;
  type: CueType;
  section?: string;
  /** Index of the unit (word/grapheme) inside the section, for `land`/`emphasis`. */
  unit?: number;
  /** 0..1 intensity; music presets scale hits by it. */
  weight: number;
}

export interface SectionTiming {
  id: string;
  /** Entry starts. */
  in: number;
  /** Fully on screen; QA samples text bounds between holdStart and holdEnd. */
  holdStart: number;
  holdEnd: number;
  /** Exit complete. */
  out: number;
}

export const BANDS = ['sub', 'bass', 'mid', 'high', 'onset'] as const;
export type Band = (typeof BANDS)[number];

export interface CueSheet {
  duration: number;
  fps: number;
  frames: number;
  /** Present for generated grids; detected grids may drift in tempo. */
  bpm?: number;
  beats: number[];
  downbeats: number[];
  sections: SectionTiming[];
  cues: Cue[];
  /** Per-frame 0..1 band energies from track analysis; drives `rhythm: audio-reactive`. */
  envelopes?: Record<Band, number[]>;
}
