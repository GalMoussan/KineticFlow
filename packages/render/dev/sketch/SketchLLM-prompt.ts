/**
 * P0 spike S1 — the description → strokes request (out/sketch/BRIEF.md, Generators 1): system prompt, JSON schema,
 * and the parser that turns a provider's JSON back into a raw `SketchDoc` (before `normalize`).
 * Two encodings of a stroke are compared: `strings` ("x,y x,y …", one string per stroke) and `nested` ([[x,y],…]).
 */
import type { Point, SketchDoc } from './doc.ts';

export type Mode = 'sketch' | 'line';
export type Detail = 1 | 2 | 3 | 4 | 5;
export type Encoding = 'strings' | 'nested';

/** The JSON-schema subset `apps/server/src/llm/providers.ts` accepts (copied: spikes don't import the server). */
export interface Schema {
  type: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean';
  description?: string;
  enum?: readonly string[];
  properties?: Record<string, Schema>;
  required?: readonly string[];
  items?: Schema;
}

export interface Subject {
  slug: string;
  description: string;
}

/** The S1 matrix: 10 English subjects, plus two Hebrew descriptions. */
export const SUBJECTS: readonly Subject[] = [
  { slug: 'brain', description: 'brain' },
  { slug: 'face', description: 'face' },
  { slug: 'coffee-cup', description: 'coffee cup' },
  { slug: 'guitar', description: 'guitar' },
  { slug: 'house', description: 'house' },
  { slug: 'tree', description: 'tree' },
  { slug: 'dog', description: 'dog' },
  { slug: 'lightbulb', description: 'lightbulb' },
  { slug: 'heart', description: 'heart' },
  { slug: 'map-pin', description: 'map pin' },
  { slug: 'he-brain', description: 'מוח' },
  { slug: 'he-coffee-cup', description: 'כוס קפה' },
];

/** Subjects that are also run at detail 1 and 5. */
export const DETAIL_SUBJECTS: readonly string[] = ['brain', 'house', 'dog'];

/** Sketch: stroke count per detail (6–60 over 1..5). Line: point count of the single polyline (≤ 600). */
export const DETAIL: Record<Detail, { strokes: [number, number]; linePts: [number, number] }> = {
  1: { strokes: [6, 10], linePts: [60, 120] },
  2: { strokes: [10, 18], linePts: [100, 200] },
  3: { strokes: [18, 28], linePts: [150, 300] },
  4: { strokes: [28, 42], linePts: [250, 450] },
  5: { strokes: [42, 60], linePts: [400, 600] },
};

export const SKETCH_STROKE_PTS = 80;
export const LINE_PTS = 600;

const FORMAT: Record<Encoding, string> = {
  strings: `Each stroke is ONE string of integer points "x,y x,y x,y": a comma inside a point, one space between points.`,
  nested: `Each stroke is an array of integer points [[x,y],[x,y],…].`,
};

export function systemPrompt(mode: Mode, detail: Detail, encoding: Encoding): string {
  const d = DETAIL[detail];
  const common = [
    `You draw with a pen plotter: you write the pen's path as coordinates, and a video animates the strokes in the order you write them.`,
    `Canvas: 1000×1000, origin top-left, x to the right, y down. Center the subject and let it fill most of the canvas (roughly 80..920).`,
    `Draw a clean, instantly recognisable line drawing of the subject, the way a good illustrator sketches an icon: the most recognisable view (front, side or 3/4), confident simple lines, correct proportions.`,
    `Ink lines only: no fills, no shading, no text, letters or digits, no frame or ground line unless it is part of the subject.`,
    `The description may be in any language (Hebrew, English, …). Draw the thing it names; never write the words.`,
  ];
  const body =
    mode === 'sketch'
      ? [
          `Mode: sketch. Write ${d.strokes[0]}–${d.strokes[1]} strokes. A stroke is one pen-down polyline of 2–${SKETCH_STROKE_PTS} points: 2 points for a straight line, more on curves (a point every 15–40 units along a curve).`,
          `Order: first the outer outline / silhouette, then the major features, then the small details.`,
          `To close a loop, end the stroke on its first point.`,
        ]
      : [
          `Mode: line (continuous one-line art). The pen never lifts: write exactly ONE stroke, a single continuous polyline of ${d.linePts[0]}–${d.linePts[1]} points (never more than ${LINE_PTS}).`,
          `Start on the outer outline and travel around it, then reach the inner features by gliding along lines already drawn or with short connecting moves; loops and doubled-back lines are fine, as in one-line art. Keep a point every 10–30 units on curves.`,
        ];
  const out = [
    `Reply with JSON only: {"plan": one short sentence naming the parts in the order you draw them, "strokes": [ … ]}.`,
    FORMAT[encoding],
  ];
  return [...common, ...body, ...out].join('\n');
}

export function userPrompt(description: string, detail: Detail, variant = 0, variants = 1): string {
  const lines = [`Subject: "${description}"`, `Detail: ${detail} of 5.`];
  if (variants > 1) lines.push(`Variant ${variant + 1} of ${variants}: ${variant === 0 ? 'the most typical drawing.' : 'a different view, pose or composition from the typical one.'}`);
  return lines.join('\n');
}

const POINT: Schema = { type: 'array', items: { type: 'integer' } };

export function schema(encoding: Encoding): Schema {
  return {
    type: 'object',
    properties: {
      plan: { type: 'string', description: 'one short sentence: the parts in drawing order' },
      strokes:
        encoding === 'strings'
          ? { type: 'array', description: 'strokes in drawing order', items: { type: 'string', description: '"x,y x,y …" integers' } }
          : { type: 'array', description: 'strokes in drawing order', items: { type: 'array', items: POINT } },
    },
    required: ['plan', 'strokes'],
  };
}

export interface Request {
  name: string;
  system: string;
  prompt: string;
  schema: Schema;
}

export function request(description: string, mode: Mode, detail: Detail, encoding: Encoding, variant = 0, variants = 1): Request {
  return { name: 'drawing', system: systemPrompt(mode, detail, encoding), prompt: userPrompt(description, detail, variant, variants), schema: schema(encoding) };
}

export interface Parsed {
  /** Raw doc exactly as written (numbers unrounded, nothing clamped); `null` when no stroke could be read. */
  doc: SketchDoc | null;
  plan: string;
  /** Shape or limit problems of the response as written. Empty = valid before normalize. */
  issues: string[];
  /** Strokes/points within the requested detail range. */
  countInRange: boolean;
}

/** One stroke from either encoding. Unreadable tokens are counted, not thrown. */
function readStroke(item: unknown): { pts: Point[]; bad: number } {
  const pts: Point[] = [];
  let bad = 0;
  const push = (x: unknown, y: unknown): void => {
    const nx = typeof x === 'number' ? x : typeof x === 'string' && x.trim() !== '' ? Number(x) : NaN;
    const ny = typeof y === 'number' ? y : typeof y === 'string' && y.trim() !== '' ? Number(y) : NaN;
    if (Number.isFinite(nx) && Number.isFinite(ny)) pts.push([nx, ny]);
    else bad++;
  };
  if (typeof item === 'string') {
    for (const tok of item.trim().split(/[\s;]+/)) {
      if (!tok) continue;
      const xy = tok.split(',');
      if (xy.length === 2) push(xy[0], xy[1]);
      else bad++;
    }
  } else if (Array.isArray(item)) {
    for (const p of item) {
      if (Array.isArray(p) && p.length >= 2) push(p[0], p[1]);
      else bad++;
    }
  } else bad++;
  return { pts, bad };
}

export function parseResponse(raw: unknown, o: { encoding: Encoding; mode: Mode; detail: Detail; meta: SketchDoc['meta'] }): Parsed {
  const issues: string[] = [];
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  const plan = typeof obj?.plan === 'string' ? obj.plan : '';
  if (!obj) return { doc: null, plan, issues: ['response is not an object'], countInRange: false };
  if (!Array.isArray(obj.strokes)) return { doc: null, plan, issues: ['no strokes array'], countInRange: false };
  const want = o.encoding === 'strings' ? 'string' : 'array';
  const strokes: SketchDoc['strokes'] = [];
  let bad = 0;
  let wrongType = 0;
  for (const item of obj.strokes as unknown[]) {
    if ((want === 'string') !== (typeof item === 'string')) wrongType++;
    const s = readStroke(item);
    bad += s.bad;
    if (s.pts.length) strokes.push({ pts: s.pts });
  }
  if (wrongType) issues.push(`${wrongType} strokes not in the ${o.encoding} encoding`);
  if (bad) issues.push(`${bad} unreadable points`);
  if (!plan) issues.push('no plan');
  const cap = o.mode === 'line' ? LINE_PTS : SKETCH_STROKE_PTS;
  const over = strokes.filter((s) => s.pts.length > cap).length;
  if (over) issues.push(`${over} strokes over ${cap} points`);
  const short = strokes.filter((s) => s.pts.length < 2).length;
  if (short) issues.push(`${short} strokes under 2 points`);
  let outside = 0;
  let fractional = 0;
  for (const s of strokes)
    for (const p of s.pts) {
      if (p[0] < 0 || p[1] < 0 || p[0] > 1000 || p[1] > 1000) outside++;
      if (!Number.isInteger(p[0]) || !Number.isInteger(p[1])) fractional++;
    }
  if (outside) issues.push(`${outside} points outside 0..1000`);
  if (fractional) issues.push(`${fractional} non-integer points`);
  if (!strokes.length) issues.push('no strokes');
  if (o.mode === 'line' && strokes.length !== 1) issues.push(`line mode has ${strokes.length} strokes`);
  if (strokes.length > 400) issues.push(`${strokes.length} strokes > 400`);
  const points = strokes.reduce((n, s) => n + s.pts.length, 0);
  if (points > 6000) issues.push(`${points} points > 6000`);
  const d = DETAIL[o.detail];
  const countInRange =
    o.mode === 'sketch' ? strokes.length >= d.strokes[0] && strokes.length <= d.strokes[1] : points >= d.linePts[0] && points <= d.linePts[1];
  const doc: SketchDoc | null = strokes.length ? { v: 1, box: [1000, 1000], mode: o.mode, strokes, meta: o.meta } : null;
  return { doc, plan, issues, countInRange };
}

/** The `strokes` value of a doc's points in one encoding, as the model would write it (JSON text). */
export function encodeStrokes(doc: SketchDoc, encoding: Encoding): string {
  const value =
    encoding === 'strings'
      ? doc.strokes.map((s) => s.pts.map((p) => `${p[0]},${p[1]}`).join(' '))
      : doc.strokes.map((s) => s.pts.map((p) => [p[0], p[1]]));
  return JSON.stringify(value);
}

/**
 * Token proxy for coordinate text (no tokenizer offline): every run of up to 3 digits is one token, every run of
 * punctuation (`,` `"` `],[` `[[`) is one token, whitespace joins the next token. A rough stand-in for BPE tokenizers,
 * which split digit runs into chunks of ≤ 3 and merge common punctuation runs. Use it only to compare encodings.
 */
export function tokenProxy(text: string): number {
  let n = 0;
  for (const m of text.matchAll(/\d+|[^\s\d]+/g)) n += /^\d/.test(m[0]) ? Math.ceil(m[0].length / 3) : 1;
  return n;
}
