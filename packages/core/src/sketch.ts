/**
 * Sketch & Line overlays (SKETCH-PLAN.md, out/sketch/BRIEF.md "Data model"): the canonical drawing (`SketchDoc`), the
 * section's sketch entries (`SectionSketch`) and the look they are drawn with (`SketchLook`). Node-safe and
 * browser-safe; everything the timing engine reads from here is bit-exact (+ − × ÷ only).
 */
import { z } from 'zod';
import { Slug } from './slug.ts';
import type { StyleRef } from './spec.ts';

/** Hard limits of a stored drawing. */
export const SKETCH_LIMITS = {
  /** Largest side of `box`. */
  box: 1000,
  strokes: 400,
  points: 6000,
  /** Sketches per section and per job. */
  perSection: 3,
  perJob: 12,
} as const;

export const SketchMode = z.enum(['sketch', 'line']);
export type SketchMode = z.infer<typeof SketchMode>;

export const SketchDetail = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);
export type SketchDetail = z.infer<typeof SketchDetail>;

const Coord = z.number().int().min(0).max(SKETCH_LIMITS.box);
/** `[x, y]` or `[x, y, pressure 0..1]`, integers in box space (quantised so hashes are stable). */
export const SketchPoint = z.union([z.tuple([Coord, Coord]), z.tuple([Coord, Coord, z.number().min(0).max(1)])]);
export type SketchPoint = z.infer<typeof SketchPoint>;

export const SketchStroke = z.object({
  pts: z.array(SketchPoint).min(2),
  /** Relative pen width (the doc's widest stroke draws at the look's width). */
  w: z.number().positive().max(10).optional(),
  closed: z.boolean().optional(),
});
export type SketchStroke = z.infer<typeof SketchStroke>;

/** One drawing: ordered vector strokes in DRAWING ORDER. Every source (preset, LLM, image) ends in this. */
export const SketchDoc = z
  .object({
    v: z.literal(1),
    box: z.tuple([z.number().int().min(1).max(SKETCH_LIMITS.box), z.number().int().min(1).max(SKETCH_LIMITS.box)]),
    mode: SketchMode,
    strokes: z.array(SketchStroke).min(1).max(SKETCH_LIMITS.strokes),
    meta: z.object({
      source: z.enum(['llm', 'image', 'image+llm', 'preset']),
      prompt: z.string().max(500).optional(),
      imageHash: z.string().max(128).optional(),
      provider: z.string().max(80).optional(),
      model: z.string().max(120).optional(),
      detail: SketchDetail,
      seed: z.number().int(),
      version: z.string().min(1).max(80),
    }),
  })
  .superRefine((d, ctx) => {
    const [w, h] = d.box;
    let n = 0;
    d.strokes.forEach((s, i) => {
      n += s.pts.length;
      const out = s.pts.findIndex((p) => p[0] > w || p[1] > h);
      if (out >= 0) ctx.addIssue({ code: 'custom', path: ['strokes', i, 'pts', out], message: `point outside the ${w}×${h} box` });
    });
    if (n > SKETCH_LIMITS.points) ctx.addIssue({ code: 'custom', path: ['strokes'], message: `${n} points; at most ${SKETCH_LIMITS.points}` });
    if (d.mode === 'line' && d.strokes.length !== 1) {
      ctx.addIssue({ code: 'custom', path: ['strokes'], message: `a line drawing is one stroke (got ${d.strokes.length})` });
    }
  });
export type SketchDoc = z.infer<typeof SketchDoc>;

export const SKETCH_PRESETS = ['circle', 'underline', 'arrow', 'scribble', 'burst', 'check', 'star', 'heart'] as const;
export const SketchPreset = z.enum(SKETCH_PRESETS);
export type SketchPreset = z.infer<typeof SketchPreset>;

/** How a sketch looks and moves. Each style owns one (its recipe's `sketch`); the user's `sketch.look` overrides fields. */
export const SketchLook = z.object({
  /** How presets are drawn in this style; generated docs keep their own mode. */
  presetMode: SketchMode,
  /** Pen width multiplier (1 = house pen: 0.75 % of the frame's short side). */
  width: z.number().min(0.25).max(4),
  /** Faint second pass offset by per-stroke jitter, 0 (clean single pass) … 1 (loose, 1.5 % of the drawing). */
  rough: z.number().min(0).max(1),
  /** The jitter pass moves every 4 frames (hand-animation wobble). */
  boil: z.boolean(),
  /** Glow 0..1: the share of the section material's text glow the strokes carry (none where text has no glow). */
  glow: z.number().min(0).max(1),
  /** Draw-on length in beats. Feeds the section budget. */
  drawBeats: z.number().min(0.5).max(16),
  ease: z.enum(['smooth', 'functional', 'snap']),
  /** After `until`'s hold: stay to the cut, fade (0.3 s) or draw backwards (0.5 s). */
  exit: z.enum(['stay', 'fade', 'undraw']),
  /** Pen-tip dot at the leading point while drawing. */
  pen: z.boolean(),
  color: z.enum(['text', 'accent0', 'accent1', 'accent2', 'accent3', 'accent4']),
  layer: z.enum(['under', 'over']),
  sfx: z.enum(['scribble', 'pop', 'none']),
  /** Flip the drawing horizontally in right-to-left sections. */
  mirrorRtl: z.boolean(),
});
export type SketchLook = z.infer<typeof SketchLook>;
/** Some look fields (a style's `sketch` block, the job's `sketchLook`, a sketch's `look`); unset fields fall through. */
export type SketchLookOverrides = { [K in keyof SketchLook]?: SketchLook[K] | undefined };

/** The house default: a clean single pass in the section's text colour over the scene. */
export const HOUSE_SKETCH_LOOK: SketchLook = Object.freeze({
  presetMode: 'sketch',
  width: 1,
  rough: 0,
  boil: false,
  glow: 0,
  drawBeats: 2,
  ease: 'smooth',
  exit: 'fade',
  pen: false,
  color: 'text',
  layer: 'over',
  sfx: 'scribble',
  mirrorRtl: false,
});

/** Seconds an exit takes, ending at the `until` section's `out`. */
export const SKETCH_EXIT_S: Record<SketchLook['exit'], number> = { stay: 0, fade: 0.3, undraw: 0.5 };

/**
 * Merges look layers over the house default, in order; undefined fields are skipped. Callers go through
 * `sectionSketchLook`, the one place a section sketch's layers are chosen.
 */
export function resolveSketchLook(...layers: (SketchLookOverrides | undefined)[]): SketchLook {
  const out: Record<string, unknown> = { ...HOUSE_SKETCH_LOOK };
  for (const l of layers) {
    if (!l) continue;
    for (const [k, v] of Object.entries(l)) if (v !== undefined) out[k] = v;
  }
  return out as SketchLook;
}

/** What the look resolver needs of the style catalog: recipe id → its optional `sketch` block (`StyleRecipe` fits). */
export type SketchRecipes = Readonly<Record<string, { readonly sketch?: SketchLookOverrides | undefined }>>;

/** Look fields a blend interpolates; every other field is discrete and comes from the dominant style. */
export const LERPED_SKETCH_FIELDS = ['width', 'rough', 'glow', 'drawBeats'] as const satisfies readonly (keyof SketchLook)[];

/**
 * A style reference's sketch look: each side's recipe block over the house default. With `blendWith`, the numeric
 * fields lerp `a + (b − a) · mix` and the discrete ones come from the dominant side (`mix ≥ 0.5` → the partner), the
 * trait rule of PLAN.md §5.3. Bit-exact (+ − × only). An unknown recipe adds nothing (`resolveStyles` reports it).
 */
export function styleSketchLook(ref: StyleRef, recipes: SketchRecipes): SketchLook {
  const o = typeof ref === 'string' ? { base: ref } : ref;
  const a = resolveSketchLook(recipes[o.base]?.sketch);
  if (!o.blendWith) return a;
  const mix = o.blendWith.mix;
  const b = resolveSketchLook(recipes[o.blendWith.style]?.sketch);
  const out: SketchLook = { ...(mix >= 0.5 ? b : a) };
  for (const k of LERPED_SKETCH_FIELDS) out[k] = a[k] + (b[k] - a[k]) * mix;
  return out;
}

/**
 * The look a section sketch is drawn and timed with: house default → the section's resolved style (its own `style`,
 * else the job's; blended) → the job's `sketchLook` (Mixer) → the sketch's own `look`. The only call path for both the
 * timing engine (`drawBeats`, exit) and the page input (everything else), so they can never disagree. With no
 * `sketch`, the look the section's sketches start from (the Mixer's per-section strip).
 */
export function sectionSketchLook(
  spec: { style: StyleRef; sketchLook?: SketchLookOverrides | undefined },
  section: { style?: StyleRef | undefined },
  sketch: Pick<SectionSketch, 'look'> | undefined,
  recipes: SketchRecipes,
): SketchLook {
  return resolveSketchLook(styleSketchLook(section.style ?? spec.style, recipes), spec.sketchLook, sketch?.look);
}

const Fraction = z.number().min(0).max(1);

export const SketchPlace = z.discriminatedUnion('mode', [
  /** Free space beside the section's text, solved by the page per format. */
  z.object({ mode: z.literal('auto') }),
  /** A rect in fractions of `format.safe`: top-left `x, y`, width `w`; the height follows the drawing, clamped. */
  z.object({ mode: z.literal('frame'), x: Fraction, y: Fraction, w: z.number().gt(0).max(1), rot: z.number().min(-180).max(180).optional() }),
  /** Attached to a content item (P5); `part` is a word inside the item. */
  z.object({
    mode: z.literal('word'),
    item: z.number().int().min(0),
    part: z.number().int().min(0).optional(),
    fit: z.enum(['around', 'under', 'beside']),
    pad: z.number().min(0).max(200).optional(),
  }),
]);
export type SketchPlace = z.infer<typeof SketchPlace>;

export const SectionSketch = z.object({
  /** Unique in the job. */
  id: Slug,
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('preset'), preset: SketchPreset }),
    z.object({
      kind: z.literal('generated'),
      /** `SketchDoc` asset id (`<specDir>/assets/<asset>.sketch.json`). */
      asset: Slug,
      /** Kept so the card can regenerate. */
      request: z.object({
        description: z.string().trim().max(300).optional(),
        image: Slug.optional(),
        mode: SketchMode,
        detail: SketchDetail,
      }),
    }),
    /** A logo's Line version (P3). */
    z.object({ kind: z.literal('logo'), asset: Slug }),
  ]),
  /** Draw start: the section's entry (`in`) or hold, plus `beats`. Default: the hold. */
  start: z.object({ edge: z.enum(['in', 'hold']), beats: z.number().min(0).max(16).optional() }).optional(),
  /** A later section id the sketch stays on screen through. Default: its own section. */
  until: Slug.optional(),
  place: SketchPlace.default({ mode: 'auto' }),
  /** The user's overrides only. */
  look: SketchLook.partial().optional(),
});
export type SectionSketch = z.infer<typeof SectionSketch>;
export type SectionSketchInput = z.input<typeof SectionSketch>;

/** JSON with object keys sorted at every level: the form hashes are taken of. */
export function canonicalJson(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : x,
  );
}

/** Content hash of a drawing: sha256 (hex) of its canonical JSON. Web Crypto, so it runs in Node and the browser. */
export async function sketchDocHash(doc: SketchDoc): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(doc));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Plain SVG of a drawing (round-capped polylines): the asset thumbnail. */
export function sketchSvg(d: SketchDoc, o: { stroke?: string } = {}): string {
  const [w, h] = d.box;
  const max = Math.max(...d.strokes.map((s) => s.w ?? 1));
  const sw = Math.max(w, h) / 120;
  const body = d.strokes
    .map((s) => {
      const pts = s.pts.map((p) => `${p[0]},${p[1]}`).join(' ');
      const tag = s.closed ? 'polygon' : 'polyline';
      const width = Math.round((((s.w ?? 1) / max) * sw) * 100) / 100;
      return `<${tag} points="${pts}" fill="none" stroke="${o.stroke ?? '#1c1915'}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>\n`;
}
