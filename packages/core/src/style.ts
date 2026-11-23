import { z } from 'zod';
import type { ReelInput } from './page.ts';
import { FormatId } from './formats.ts';

/** One trait per axis; see PLAN.md §5.1. Order is the per-frame evaluation order (§5.2). */
export const TRAIT_AXES = [
  'rhythm',
  'camera',
  'layout',
  'unit',
  'reveal',
  'motion',
  'axis',
  'material',
  'background',
  'transition',
] as const;
export const TraitAxis = z.enum(TRAIT_AXES);
export type TraitAxis = z.infer<typeof TraitAxis>;

export const FAMILIES = [
  'motion',
  'scrolling',
  'dynamic-layout',
  'fluid-typography',
  'beat-synced',
  'audio-reactive',
  'reveal',
  'morph',
  'path',
  'spatial',
  'variable-font',
  'textured',
  'generative',
  'simple',
  'fluid-organic',
  'high-energy',
  'narrative',
  'stats',
] as const;
export const Family = z.enum(FAMILIES);
export type Family = z.infer<typeof Family>;

export const Layer = z.enum(['dom', 'canvas', 'webgl']);
export type Layer = z.infer<typeof Layer>;

export const Slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lowercase-kebab-case id');

/**
 * Style timing rules consumed by the timing engine (PLAN.md §7). Durations in beats are snapped to half-beats.
 */
export const Choreography = z.object({
  /** Beats between consecutive landings in a section. */
  unitBeats: z.number().positive(),
  /** Beats before a short (≤ 3 graphemes, non-emphasis) word that follows another landing. */
  shortUnitBeats: z.number().positive(),
  /** Beats from a section's `out` to the next section's first landing (the transition). */
  moveBeats: z.number().positive(),
  /** Seconds the camera/entry starts before the first landing. */
  leadIn: z.number().min(0),
  /** Minimum seconds a section stays after its last landing. */
  minTail: z.number().positive(),
  /** Seconds a landing takes to settle; QA reads text only after the last landing has settled. */
  entry: z.number().min(0),
  /** Beats between landings inside the end card (a quick restatement of the title). */
  endUnitBeats: z.number().positive(),
  /** Minimum seconds from the end card's last landing (or outro decoration) to the end of the video. */
  endHold: z.number().positive(),
  /** Decorations that occupy beats without being content: an intro mark at T0, an outro mark after the end card. */
  introBeats: z.number().min(0),
  outroBeats: z.number().min(0),
});
export type Choreography = z.infer<typeof Choreography>;

/** `styles/<id>/recipe.json`: a catalog style as a bundle of traits. */
export const StyleRecipe = z.object({
  id: Slug,
  name: z.string().min(1),
  families: z.array(Family).min(1),
  energy: z.number().int().min(1).max(5),
  background: z.enum(['light', 'dark']),
  traits: z.record(TraitAxis, Slug),
  /** Module owning several axes at once (split-flap board, chat UI, map). Its axes ignore `traits` overrides. */
  signature: z.object({ module: Slug, owns: z.array(TraitAxis).min(1) }).optional(),
  /** Continuous parameters; these are what a blend interpolates. */
  params: z.record(z.string(), z.number()),
  defaults: z.object({
    palette: Slug,
    music: z.object({ preset: Slug, bpm: z.number().min(40).max(200) }),
    fonts: z.object({ display: Slug, text: Slug.optional() }),
  }),
  constraints: z.object({
    maxWordsPerSection: z.number().int().positive(),
    formats: z.array(FormatId).min(1),
    /** Section roles this style can lay out; specs using other roles are rejected before rendering. */
    roles: z.array(z.string().min(1)).min(1),
  }),
  choreography: Choreography,
});
export type StyleRecipe = z.infer<typeof StyleRecipe>;

/** Per-unit animation state that traits add into; one commit step writes it to DOM/WebGL (PLAN.md §5.2). */
export interface Channels {
  tx: number;
  ty: number;
  tz: number;
  sx: number;
  sy: number;
  rot: number;
  skew: number;
  opacity: number;
  blur: number;
  /** 0 = fully clipped, 1 = fully visible, along `clipSide`. */
  clip: number;
  clipSide: 'start' | 'end' | 'top' | 'bottom';
  color: string;
  fill: number;
  stroke: number;
  wght: number;
  wdth: number;
  glow: number;
  z: number;
}

export interface Unit {
  id: string;
  section: string;
  /** Grapheme cluster, word or line, depending on the `unit` trait. NFC, niqqud attached to its base letter. */
  text: string;
  index: number;
  emphasis: boolean;
  /** Layout box in format pixels, set by the layout trait. */
  box: { x: number; y: number; w: number; h: number };
  ch: Channels;
}

export interface ParamSpec {
  min: number;
  max: number;
  default: number;
  label: string;
}

export interface TraitModule<P extends Record<string, number> = Record<string, number>> {
  id: string;
  axis: TraitAxis;
  layer: Layer;
  params: { [K in keyof P]: ParamSpec };
  /** Axis → acceptable trait ids. Violations are rejected by the resolver and greyed out in the UI. */
  requires?: Partial<Record<TraitAxis, string[]>>;
  excludes?: Partial<Record<TraitAxis, string[]>>;
  setup?(ctx: TraitSetupContext<P>): void | Promise<void>;
  /** Pure function of t: must not keep state between calls (frames are seeked in any order). */
  frame(ctx: TraitFrameContext<P>, t: number): void;
}

export interface TraitSetupContext<P> {
  reel: ReelInput;
  params: P;
  units: Unit[];
  root: HTMLElement;
}

export interface TraitFrameContext<P> extends TraitSetupContext<P> {
  /** Deterministic hash noise in [0, 1). */
  hash(n: number): number;
}
