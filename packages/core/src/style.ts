import { z } from 'zod';
import { FormatId } from './formats.ts';
import type { SectionRole } from './spec.ts';

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

/** `<axis>.<param>`: recipe/spec params are addressed per axis so blends lerp values of the same concept. */
export const ParamKey = z.string().regex(/^[a-z]+\.[a-zA-Z][a-zA-Z0-9]*$/, '<axis>.<param>');

/** `styles/<id>/recipe.json`: a catalog style as one trait per axis (PLAN.md §5). */
export const StyleRecipe = z.object({
  id: Slug,
  name: z.string().min(1),
  families: z.array(Family).min(1),
  energy: z.number().int().min(1).max(5),
  background: z.enum(['light', 'dark']),
  /** Trait id per axis (all ten axes); ids are those of `@reel/traits`' registry. */
  traits: z.record(TraitAxis, Slug),
  /**
   * Several axes implemented by one module (split-flap board, chat UI, map). The owned axes are locked: spec
   * `traits` overrides on them are rejected, and in a blend they always come from this recipe's side.
   */
  signature: z.object({ module: Slug, owns: z.array(TraitAxis).min(1) }).optional(),
  /** Overrides of trait param defaults, keyed `<axis>.<param>`; these are what a blend interpolates. */
  params: z.record(ParamKey, z.number()),
  defaults: z.object({
    palette: Slug,
    music: z.object({ preset: Slug, bpm: z.number().min(40).max(200) }),
    fonts: z.object({ display: Slug, text: Slug.optional() }),
  }),
  constraints: z.object({
    maxWordsPerSection: z.number().int().positive(),
    formats: z.array(FormatId).min(1),
    /** Section roles this style can lay out (on top of its layout trait's `roles`); others are rejected before rendering. */
    roles: z.array(z.string().min(1)).min(1),
  }),
  choreography: Choreography,
});
export type StyleRecipe = z.infer<typeof StyleRecipe>;

/** One numeric trait parameter. Values are validated against [min, max]; blends lerp between two in-range values. */
export interface ParamSpec {
  min: number;
  max: number;
  default: number;
  label: string;
}

/**
 * Node-safe description of a trait module (no DOM). The resolver, the bundler and the UI read only this; the
 * browser implementation (`impl.ts` in `@reel/traits`) carries the same object as its `meta`.
 */
export interface TraitMeta {
  /** Unique per axis; the folder name `packages/traits/src/traits/<axis>/<id>/`. */
  id: string;
  axis: TraitAxis;
  layer: Layer;
  label: string;
  params: Readonly<Record<string, ParamSpec>>;
  /** Axis → acceptable trait ids on that axis. */
  requires?: Readonly<Partial<Record<TraitAxis, readonly string[]>>>;
  /** Axis → trait ids that must not be on that axis. */
  excludes?: Readonly<Partial<Record<TraitAxis, readonly string[]>>>;
  /** Layout traits: the section roles they can lay out (required for `axis: layout`). */
  roles?: readonly SectionRole[];
  /** Formats the trait supports; absent = all. */
  formats?: readonly FormatId[];
  /** Capabilities the trait needs from other axes. `chars`: some units must be split into graphemes. */
  needs?: Readonly<{ chars?: boolean }>;
  /** Unit traits: whether units can be split into graphemes for traits that `need` chars (default true). */
  chars?: boolean;
  /**
   * Layout: consecutive sections with this layout (and equal layout/camera/background traits and params) can share
   * one world and one camera. Camera: able to travel inside such a world.
   */
  world?: boolean;
  /** Transition traits: `world` moves the camera inside a world chain; `layer` replaces one scene layer by the next. */
  scope?: 'world' | 'layer';
}
