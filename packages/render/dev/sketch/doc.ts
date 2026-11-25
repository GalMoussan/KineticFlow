/**
 * P0 spike: the `SketchDoc` shape from the sketch build prompt (out/sketch/BRIEF.md, "Data model"). Spike-only;
 * P1 moves the zod schema into `@reel/core`.
 */
export type Point = [x: number, y: number, p?: number];
export interface Stroke {
  pts: Point[];
  w?: number;
  closed?: boolean;
}
export interface SketchDoc {
  v: 1;
  box: [w: number, h: number];
  mode: 'sketch' | 'line';
  strokes: Stroke[];
  meta: {
    source: 'llm' | 'image' | 'image+llm' | 'preset';
    prompt?: string;
    imageHash?: string;
    provider?: string;
    model?: string;
    detail: 1 | 2 | 3 | 4 | 5;
    seed: number;
    version: string;
  };
}

export const LIMITS = { box: 1000, strokes: 400, points: 6000 } as const;

export function pointCount(d: SketchDoc): number {
  let n = 0;
  for (const s of d.strokes) n += s.pts.length;
  return n;
}

/** Problems with a doc against the prompt's limits (empty = valid). Line mode must be exactly one stroke. */
export function problems(d: SketchDoc): string[] {
  const out: string[] = [];
  const [w, h] = d.box;
  if (!(w > 0 && h > 0 && w <= LIMITS.box && h <= LIMITS.box)) out.push(`box ${w}×${h} outside 1..${LIMITS.box}`);
  if (d.strokes.length === 0) out.push('no strokes');
  if (d.strokes.length > LIMITS.strokes) out.push(`${d.strokes.length} strokes > ${LIMITS.strokes}`);
  const n = pointCount(d);
  if (n > LIMITS.points) out.push(`${n} points > ${LIMITS.points}`);
  if (d.mode === 'line' && d.strokes.length !== 1) out.push(`line mode has ${d.strokes.length} strokes`);
  for (const [i, s] of d.strokes.entries()) {
    for (const p of s.pts) {
      if (!Number.isInteger(p[0]) || !Number.isInteger(p[1]) || p[0] < 0 || p[1] < 0 || p[0] > w || p[1] > h) {
        out.push(`stroke ${i}: point ${p[0]},${p[1]} not an integer inside the box`);
        break;
      }
    }
  }
  return out;
}

/** Plain polyline SVG of a doc (no pressure, no jitter): the neutral view used on spike contact sheets. */
export function plainSvg(d: SketchDoc, o: { stroke?: string; width?: number; upto?: number } = {}): string {
  const [w, h] = d.box;
  const sw = o.width ?? Math.max(w, h) / 220;
  const paths = d.strokes
    .map((s) => {
      const pts = s.pts.map((p) => `${p[0]},${p[1]}`).join(' ');
      const tag = s.closed ? 'polygon' : 'polyline';
      return `<${tag} points="${pts}" fill="none" stroke="${o.stroke ?? '#111'}" stroke-width="${(s.w ?? 1) * sw}" stroke-linecap="round" stroke-linejoin="round"/>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${paths}</svg>`;
}
