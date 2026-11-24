import { z } from 'zod';
import { FormatId } from './formats.ts';
import { Slug, TraitAxis } from './style.ts';

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, '#RRGGBB');
const IsoDate = z.iso.date();
const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');
const Text = z.string().trim().min(1).max(200);

export const StyleRef = z.union([
  Slug,
  z.object({
    base: Slug,
    blendWith: z.object({ style: Slug, mix: z.number().min(0).max(1) }).optional(),
    traits: z.partialRecord(TraitAxis, Slug).optional(),
    params: z.record(z.string(), z.number()).optional(),
  }),
]);
export type StyleRef = z.infer<typeof StyleRef>;

/** A catalog palette id or explicit colours. */
export const Palette = z.union([
  Slug,
  z.object({ bg: Hex, text: Hex, accents: z.array(Hex).min(1).max(5) }),
]);

const common = {
  /** Stable id; defaults to `<role>-<index>` after parsing. */
  id: Slug.optional(),
  /** Per-section style override (PLAN.md §5.3). */
  style: StyleRef.optional(),
  /**
   * Per-section palette. Default: the job's `palette` when the section resolves to the job's dominant style, else the
   * default palette of the section's own dominant style.
   */
  palette: Palette.optional(),
  /** Minimum hold in seconds, overriding the timing engine's default. */
  minHold: z.number().min(0.5).max(10).optional(),
};

export const TEXT_ROLES = ['tagline', 'body', 'teaser', 'cta', 'heading', 'question', 'answer', 'quote'] as const;

export const Section = z.discriminatedUnion('role', [
  z.object({ ...common, role: z.literal('title'), text: Text }),
  z.object({ ...common, role: z.enum(TEXT_ROLES), text: Text }),
  z.object({ ...common, role: z.literal('datetime'), date: IsoDate, time: Time.optional() }),
  z.object({ ...common, role: z.literal('location'), place: Text, city: Text.optional() }),
  z.object({ ...common, role: z.literal('list'), title: Text.optional(), items: z.array(Text).min(1).max(10) }),
  z.object({
    ...common,
    role: z.literal('stat'),
    value: z.number(),
    prefix: z.string().max(4).optional(),
    suffix: z.string().max(4).optional(),
    label: Text,
  }),
  /** Days remaining are computed from `from` (the posting date), never from the clock, so renders stay deterministic. */
  z.object({ ...common, role: z.literal('countdown'), from: IsoDate, to: IsoDate, label: Text.optional() }),
  z.object({
    ...common,
    role: z.literal('lyric'),
    /** `at` = seconds into the track, from tap-to-align or manual entry. */
    lines: z.array(z.object({ text: Text, at: z.number().min(0).optional() })).min(1),
  }),
  z.object({ ...common, role: z.literal('endcard'), logos: z.array(Slug).max(4), text: Text.optional() }),
]);
export type Section = z.infer<typeof Section>;
export type SectionRole = Section['role'];

export const Music = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('preset'),
    preset: Slug,
    bpm: z.number().min(60).max(180),
    seed: z.number().int().nonnegative(),
  }),
  /**
   * Own track: `file` is an asset id resolved to `<specDir>/assets/<file>.{mp3,wav,m4a,aac,flac,ogg}`; `offset`
   * skips the intro (seconds). Beats and downbeats come from the analysis sidecar; the video's text lands on them.
   */
  z.object({
    source: z.literal('track'),
    file: Slug,
    offset: z.number().min(0).default(0),
    /** Seconds of fade-out at the end of the video (the track is cut at `offset + duration`). */
    fadeOut: z.number().min(0).max(5).default(1.5),
  }),
  /**
   * ACE-Step add-on (`reelgen setup music-ai`): a clip generated from `prompt` (+ `lyrics`; instrumental without)
   * at the `bpm` hint and `seed`, `aiClipSeconds` long, cached per (model, prompt, lyrics, length, bpm, seed). From
   * there it is an own track: beats from the analysis sidecar, `offset` skips into the clip, `fadeOut` ends it.
   */
  z.object({
    source: z.literal('ai'),
    prompt: z.string().trim().min(1).max(500),
    lyrics: z.string().max(4000).optional(),
    bpm: z.number().int().min(60).max(180).optional(),
    seed: z.number().int().nonnegative(),
    offset: z.number().min(0).max(60).default(0),
    fadeOut: z.number().min(0).max(5).default(1.5),
  }),
  z.object({ source: z.literal('none') }),
]);

/** Seconds of room the AI clip leaves for `offset` (skipping a generated intro) without generating a new clip. */
export const AI_INTRO_ROOM_S = 14;
/** Seconds generated past the video's end: ACE-Step writes a song ending (≈ 2–5 s of tail and silence). */
export const AI_TAIL_S = 6;

/**
 * Length of the AI clip a spec needs (whole seconds, ≥ ACE-Step's 10 s minimum): the video, room for an offset of up
 * to `AI_INTRO_ROOM_S` and the tail margin; larger offsets get a longer clip. Shared by the render and the studio,
 * so both name the same cached clip.
 */
export function aiClipSeconds(duration: number, offset: number): number {
  return Math.max(10, Math.ceil(Math.max(duration + AI_INTRO_ROOM_S, offset + duration) + AI_TAIL_S));
}

export const QUALITY_PRESETS = {
  draft: { fps: 30, motionBlur: null, supersample: 1 },
  standard: { fps: 30, motionBlur: null, supersample: 1 },
  final: { fps: 60, motionBlur: { samples: 6, shutter: 180 }, supersample: 2 },
} as const;

export const Quality = z.union([
  z.enum(['draft', 'standard', 'final']),
  z.object({
    fps: z.union([z.literal(30), z.literal(60)]),
    motionBlur: z.object({ samples: z.number().int().min(2).max(16), shutter: z.number().min(1).max(360) }).nullable(),
    supersample: z.union([z.literal(1), z.literal(2)]),
  }),
]);

export const JobSpec = z
  .object({
    id: Slug,
    language: z.enum(['he', 'en']),
    contentType: z.enum(['event', 'list', 'story', 'lyric', 'stats']),
    brief: z.string().max(1000).default(''),
    sections: z.array(Section).min(2),
    style: StyleRef,
    brandKit: Slug.optional(),
    palette: Palette,
    fonts: z.object({ display: Slug, text: Slug.optional() }),
    music: Music,
    sfx: z.boolean().default(true),
    duration: z.number().min(6).max(30),
    formats: z.array(FormatId).min(1),
    quality: Quality.default('standard'),
    outputs: z
      .object({ noMusic: z.boolean().default(true), keepChunks: z.boolean().default(false) })
      .prefault({}),
  })
  .superRefine((spec, ctx) => {
    const roles = spec.sections.map((s) => s.role);
    for (const required of ['title', 'endcard'] as const) {
      if (!roles.includes(required)) {
        ctx.addIssue({ code: 'custom', path: ['sections'], message: `a "${required}" section is required` });
      }
    }
    if (new Set(spec.formats).size !== spec.formats.length) {
      ctx.addIssue({ code: 'custom', path: ['formats'], message: 'duplicate format' });
    }
    if (roles.includes('lyric') && spec.music.source !== 'track') {
      ctx.addIssue({ code: 'custom', path: ['music'], message: 'lyric sections need music.source = "track"' });
    }
    spec.sections.forEach((s, i) => {
      if (s.role === 'countdown' && s.from > s.to) {
        ctx.addIssue({ code: 'custom', path: ['sections', i, 'from'], message: '"from" must not be after "to"' });
      }
    });
  })
  .transform((spec, ctx) => {
    const sections = spec.sections.map((s, i) => ({ ...s, id: s.id ?? `${s.role}-${i}` }));
    if (new Set(sections.map((s) => s.id)).size !== sections.length) {
      ctx.addIssue({ code: 'custom', path: ['sections'], message: 'duplicate section id' });
      return z.NEVER;
    }
    return { ...spec, sections };
  });

export type JobSpecInput = z.input<typeof JobSpec>;
export type JobSpec = z.output<typeof JobSpec>;
export type ResolvedSection = JobSpec['sections'][number];
