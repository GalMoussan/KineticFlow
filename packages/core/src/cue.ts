/** Timing engine output (PLAN.md §7): the one source of time for the page, the music and QA. */
import type { Item } from './items.ts';
import type { SectionRole } from './spec.ts';

export const CUE_TYPES = [
  /** Decoration landing at T0 before the first section (e.g. an opening quote mark). */
  'intro',
  'section-in',
  /** A content item lands; `section` + `unit` index into `ReelSection.items`. */
  'land',
  /** Emitted together with `land` for emphasised items. */
  'emphasis',
  /** Transition between two sections, from `t` to `until`; `section` is the incoming one. */
  'camera-move',
  'endcard',
  /** Decoration after the end card's last item (e.g. a closing quote mark). */
  'outro',
] as const;
export type CueType = (typeof CUE_TYPES)[number];

export interface Cue {
  /** Seconds from video start. */
  t: number;
  type: CueType;
  section?: string;
  unit?: number;
  /** 0..1 intensity; music presets scale hits by it. */
  weight: number;
  /** End time for cues with a duration (`camera-move`). */
  until?: number;
}

export interface SectionTiming {
  /** Entry starts (camera arrives); the previous section's `out` precedes it by the transition. */
  in: number;
  firstLand: number;
  lastLand: number;
  /** All items fully on screen; QA samples text between holdStart and holdEnd. */
  holdStart: number;
  holdEnd: number;
  /** Section leaves (transition to the next starts). Equals the video duration for the last section. */
  out: number;
}

export interface TimedItem extends Item {
  /** Landing time in seconds; always on the half-beat grid. */
  at: number;
}

export interface ReelSection {
  id: string;
  role: SectionRole;
  items: TimedItem[];
  timing: SectionTiming;
}

export const BANDS = ['sub', 'bass', 'mid', 'high', 'onset'] as const;
export type Band = (typeof BANDS)[number];

export interface CueSheet {
  duration: number;
  fps: number;
  frames: number;
  /** Present for generated grids; detected grids may drift in tempo. */
  bpm?: number;
  /** First downbeat. */
  t0: number;
  beats: number[];
  downbeats: number[];
  sections: ReelSection[];
  /** Sorted by `t`, then by type order in CUE_TYPES. */
  cues: Cue[];
  /** Per-frame 0..1 band energies from track analysis; drives `rhythm: audio-reactive` (M3). */
  envelopes?: Record<Band, number[]>;
}
