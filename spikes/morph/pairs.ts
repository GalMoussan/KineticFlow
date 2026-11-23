/** Morph test pairs + strategy builders (shared by Node scripts and the browser page). */
import flubber from 'flubber';
import polygonClipping from 'polygon-clipping';
import { shapeText, type LoadedFont } from './hb.ts';
import { circleRing, contoursFromPolygons, flatten, glyphContours, linkHoles, ownMorph, rectRing, ringsToD, type Contour, type Frame, type Pt, type Ring } from './geom.ts';

export type Side = { text: string; font: 'noto' | 'rubik'; wght?: number } | { shape: 'circle' | 'square' };
export type Pair = { id: string; kind: string; from: Side; to: Side };

export const SIZE = 200;

export const PAIRS: Pair[] = [
  { id: 'word-kafe-dilema', kind: 'word→word', from: { text: 'קפה', font: 'noto' }, to: { text: 'דילמה', font: 'noto' } },
  { id: 'word-shalom-talk', kind: 'word→word (niqqud, script change)', from: { text: 'שָׁלוֹם', font: 'noto' }, to: { text: 'Talk', font: 'noto' } },
  { id: 'letter-mem-samekh-noto', kind: 'letter→letter, holes (2→1 contours)', from: { text: 'ם', font: 'noto' }, to: { text: 'ס', font: 'noto' } },
  { id: 'letter-mem-samekh-rubik', kind: 'letter→letter, holes (2→2 contours)', from: { text: 'ם', font: 'rubik' }, to: { text: 'ס', font: 'rubik' } },
  { id: 'letter-B-8', kind: 'letter→letter, 2 holes each', from: { text: 'B', font: 'rubik' }, to: { text: '8', font: 'rubik' } },
  { id: 'circle-shin', kind: 'circle→letter', from: { shape: 'circle' }, to: { text: 'ש', font: 'noto' } },
  { id: 'square-mem', kind: 'square→letter (hole)', from: { shape: 'square' }, to: { text: 'ם', font: 'noto' } },
  { id: 'circle-B', kind: 'circle→letter (2 holes)', from: { shape: 'circle' }, to: { text: 'B', font: 'rubik' } },
  { id: 'square-kuf', kind: 'square→letter (2 outers)', from: { shape: 'square' }, to: { text: 'ק', font: 'noto' } },
];

/** `union`: the same outline after a nonzero boolean union (no overlaps, no self-overlapping "slit" counters). */
export type Built = { contours: Contour[]; union: Contour[]; d: string; rings: Ring[] };

/** Nonzero union of a contour set → clean [outer, ...holes] polygons. */
export function unionContours(cs: Contour[]): Contour[] {
  const polys = cs.filter((c) => c.outer).map((o) => [o.ring, ...o.holes.map((h) => cs[h]!.ring)]);
  if (!polys.length) return [];
  const [first, ...rest] = polys as [Pt[][], ...Pt[][][]];
  return contoursFromPolygons(polygonClipping.union(first, ...rest));
}

/** Text centred on x=0 with its baseline at y=0. */
export function buildText(f: LoadedFont, text: string, wght = 400): Built {
  const sh = shapeText(f, text, SIZE, wght);
  const dx = -sh.width / 2;
  const perGlyph = sh.glyphs.map((g) => glyphContours(flatten(g.cmds.map(({ c, p }) => ({ c, p: p.map((v, i) => (i % 2 === 0 ? v + dx : v)) })))));
  const contours = linkHoles(perGlyph.flat());
  // exact (curved) path for APIs that take strings
  const d = sh.glyphs.map((g) => g.cmds.map(({ c, p }) => c + p.map((v, i) => (i % 2 === 0 ? v + dx : v)).join(',')).join('')).join('');
  return { contours, union: unionContours(contours), d, rings: contours.map((c) => c.ring) };
}

/** A basic shape sized to the other side's bounding box. */
export function buildShape(shape: 'circle' | 'square', other: Built): Built {
  const xs = other.rings.flat().map((p) => p[0]);
  const ys = other.rings.flat().map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const r = Math.max(x1 - x0, y1 - y0) / 2;
  const ring = shape === 'circle' ? circleRing(cx, cy, r) : rectRing(cx - r, cy - r, 2 * r, 2 * r);
  const contours = linkHoles(glyphContours([ring]));
  return { contours, union: contours, d: ringsToD([ring]), rings: [ring] };
}

export type Strategy = { name: string; fill: 'nonzero' | 'evenodd'; frame: Frame | null; error?: string; note?: string };

export type Fonts = { noto: LoadedFont; rubik: LoadedFont };

export function buildSides(fonts: Fonts, pair: Pair): { A: Built; B: Built } {
  const { from, to } = pair;
  if ('shape' in from && 'text' in to) {
    const B = buildText(fonts[to.font], to.text, to.wght ?? 400);
    return { A: buildShape(from.shape, B), B };
  }
  if ('text' in from && 'shape' in to) {
    const A = buildText(fonts[from.font], from.text, from.wght ?? 400);
    return { A, B: buildShape(to.shape, A) };
  }
  if ('text' in from && 'text' in to) {
    return { A: buildText(fonts[from.font], from.text, from.wght ?? 400), B: buildText(fonts[to.font], to.text, to.wght ?? 400) };
  }
  throw new Error(`pair ${pair.id}: shape→shape is not a test case`);
}

const OPTS = { maxSegmentLength: 2 };

/** Contours ordered visually right→left, then top→bottom (what a naive "pair by order" would use). */
function byOrder(cs: Contour[]): Ring[] {
  return [...cs].sort((a, b) => b.c[0] - a.c[0] || a.c[1] - b.c[1]).map((c) => c.ring);
}

export const STRATEGIES = [
  'flubber.interpolate',
  'flubber.interpolateAll',
  'flubber.separate/combine',
  'flubber.ownPairs',
  'own.collapse',
  'own.split',
  'own.union',
] as const;

export function buildStrategy(name: (typeof STRATEGIES)[number], A: Built, B: Built, pair: Pair): Strategy {
  try {
    switch (name) {
      case 'flubber.interpolate': {
        // Whole multi-subpath strings, as the API is documented to accept. Shapes use fromCircle/fromRect.
        if ('shape' in pair.from) {
          const big = [...B.contours].sort((a, b) => b.area - a.area)[0]!.ring;
          const [x0, y0, x1, y1] = bb(A.rings[0]!);
          const fr =
            pair.from.shape === 'circle'
              ? flubber.fromCircle((x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, big, OPTS)
              : flubber.fromRect(x0, y0, x1 - x0, y1 - y0, big, OPTS);
          return { name, fill: 'nonzero', frame: fr, note: 'fromCircle/fromRect → largest contour only' };
        }
        return { name, fill: 'nonzero', frame: flubber.interpolate(A.d, B.d, OPTS), note: 'string input; flubber keeps only the first subpath' };
      }
      case 'flubber.interpolateAll': {
        const f = flubber.interpolateAll(byOrder(A.contours), byOrder(B.contours), { ...OPTS, single: true });
        return { name, fill: 'evenodd', frame: f, note: 'contours paired by visual order; flubber forces one winding → evenodd' };
      }
      case 'flubber.separate/combine': {
        const ra = byOrder(A.contours);
        const rbs = byOrder(B.contours);
        const k = Math.min(ra.length, rbs.length) - 1;
        const parts: Frame[] = [];
        if (k > 0) parts.push(flubber.interpolateAll(ra.slice(0, k), rbs.slice(0, k), { ...OPTS, single: true }));
        if (ra.length - k === 1 && rbs.length - k === 1) parts.push(flubber.interpolate(ra[k]!, rbs[k]!, OPTS));
        else if (ra.length - k === 1) parts.push(flubber.separate(ra[k]!, rbs.slice(k), { ...OPTS, single: true }));
        else parts.push(flubber.combine(ra.slice(k), rbs[k]!, { ...OPTS, single: true }));
        return { name, fill: 'evenodd', frame: (t) => parts.map((p) => p(t)).join(' '), note: 'order pairing, surplus via separate()/combine()' };
      }
      case 'flubber.ownPairs': {
        // Fairness check: our contour pairing, flubber's per-ring interpolate; extras via toCircle/fromCircle(r≈0).
        const { pairs, extrasA, extrasB } = ownMorph(A.contours, B.contours).info;
        const parts: Frame[] = pairs.map(([a, b]) => flubber.interpolate(A.contours[a]!.ring, B.contours[b]!.ring, OPTS));
        for (const i of extrasA) parts.push(flubber.toCircle(A.contours[i]!.ring, A.contours[i]!.c[0], A.contours[i]!.c[1], 0.01, OPTS));
        for (const i of extrasB) parts.push(flubber.fromCircle(B.contours[i]!.c[0], B.contours[i]!.c[1], 0.01, B.contours[i]!.ring, OPTS));
        return { name, fill: 'evenodd', frame: (t) => parts.map((p) => p(t)).join(' '), note: 'own pairing + flubber.interpolate per ring' };
      }
      case 'own.collapse':
        return { name, fill: 'nonzero', frame: ownMorph(A.contours, B.contours).frame };
      case 'own.split':
        return { name, fill: 'nonzero', frame: ownMorph(A.contours, B.contours, { split: true }).frame };
      case 'own.union':
        return { name, fill: 'nonzero', frame: ownMorph(A.union, B.union).frame, note: 'collapse, after nonzero boolean union' };
    }
  } catch (e) {
    return { name, fill: 'nonzero', frame: null, error: String((e as Error).message ?? e).split('\n')[0]! };
  }
}

export function bb(r: Ring): [number, number, number, number] {
  const xs = r.map((p) => p[0]);
  const ys = r.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}
