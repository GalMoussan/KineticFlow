/**
 * P0 spike (S4/S5): deterministic worst-case test docs at the prompt's limits (6000 points each).
 * Seeded (mulberry32), integer points inside the box, no wall clock.
 *
 *   node packages/render/dev/sketch/SketchRender-docs.ts   → out/sketch/S4/{line-6000,sketch-400x15}.json
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { problems, type Point, type SketchDoc } from './doc.ts';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clampInt = (v: number, hi: number): number => Math.min(hi, Math.max(0, Math.round(v)));

/** Line mode: one 6000-point stroke, a wobbly spiral from the centre out (≈ 9 turns). */
export function lineDoc(seed = 7): SketchDoc {
  const rnd = mulberry32(seed);
  const N = 6000;
  const pts: Point[] = [];
  const ph = rnd() * Math.PI * 2;
  for (let i = 0; i < N; i++) {
    const k = i / (N - 1);
    const a = k * Math.PI * 2 * 9;
    const r = 30 + 440 * k + 14 * Math.sin(a * 5 + ph);
    pts.push([clampInt(500 + r * Math.cos(a), 1000), clampInt(500 + r * Math.sin(a) * 0.92, 1000)]);
  }
  return { v: 1, box: [1000, 1000], mode: 'line', strokes: [{ pts }], meta: { source: 'preset', detail: 5, seed, version: 'spike-s4' } };
}

/**
 * Sketch mode: 400 strokes × 15 points. A loosely sketched coffee cup: outline loops, then hatching and steam
 * curls, every stroke a short hand-like curve with seeded wobble. Drawing order = generation order.
 */
export function sketchDoc(seed = 11): SketchDoc {
  const rnd = mulberry32(seed);
  const strokes: { pts: Point[] }[] = [];
  const curve = (f: (u: number) => [number, number], wob: number): void => {
    const pts: Point[] = [];
    const w1 = (rnd() - 0.5) * wob;
    const w2 = rnd() * Math.PI * 2;
    for (let i = 0; i < 15; i++) {
      const u = i / 14;
      const [x, y] = f(u);
      pts.push([clampInt(x + w1 * Math.sin(u * Math.PI * 2 + w2), 1000), clampInt(y + w1 * Math.cos(u * Math.PI * 3 + w2), 1000)]);
    }
    strokes.push({ pts });
  };
  // cup body: 3 loose passes, 24 arcs each (72)
  for (let pass = 0; pass < 3; pass++) {
    for (let s = 0; s < 24; s++) {
      const a0 = (s / 24) * Math.PI * 2 + rnd() * 0.1;
      const a1 = a0 + (Math.PI * 2) / 24 + 0.08;
      curve((u) => {
        const a = a0 + (a1 - a0) * u;
        return [500 + 260 * Math.cos(a), 600 + 230 * Math.sin(a) + pass * 3];
      }, 10);
    }
  }
  // rim ellipse (24)
  for (let s = 0; s < 24; s++) {
    const a0 = (s / 24) * Math.PI * 2;
    curve((u) => {
      const a = a0 + ((Math.PI * 2) / 24 + 0.05) * u;
      return [500 + 250 * Math.cos(a), 420 + 50 * Math.sin(a)];
    }, 6);
  }
  // handle (16)
  for (let s = 0; s < 16; s++) {
    const a0 = -Math.PI / 2 + (s / 16) * Math.PI;
    curve((u) => {
      const a = a0 + (Math.PI / 16 + 0.05) * u;
      return [760 + 110 * Math.cos(a), 600 + 120 * Math.sin(a)];
    }, 6);
  }
  // saucer (32)
  for (let s = 0; s < 32; s++) {
    const a0 = (s / 32) * Math.PI * 2;
    curve((u) => {
      const a = a0 + ((Math.PI * 2) / 32 + 0.04) * u;
      return [500 + 400 * Math.cos(a), 860 + 70 * Math.sin(a)];
    }, 8);
  }
  // steam curls (3 × 20 = 60)
  for (let c = 0; c < 3; c++) {
    for (let s = 0; s < 20; s++) {
      const y0 = 360 - s * 15;
      curve((u) => {
        const y = y0 - u * 15;
        return [380 + c * 120 + 40 * Math.sin((y / 340) * Math.PI * 2 + c), y];
      }, 4);
    }
  }
  // hatching: short parallel strokes on a grid inside the cup, most shadowed (lower right, light from upper left)
  // first, until 400 strokes; then drawn row by row
  const cells: { x: number; y: number; shade: number }[] = [];
  for (let y = 400; y <= 820; y += 18) {
    for (let x = 270; x <= 730; x += 18) {
      const dx = x - 500;
      const dy = y - 600;
      if (dx * dx + dy * dy > 205 * 205) continue;
      cells.push({ x, y, shade: dx * 0.55 + dy * 0.85 + (rnd() - 0.5) * 30 });
    }
  }
  const picked = cells.sort((a, b) => b.shade - a.shade).slice(0, 400 - strokes.length);
  picked.sort((a, b) => a.y - b.y || a.x - b.x);
  for (const c of picked) curve((u) => [c.x - 14 + u * 28, c.y + 14 - u * 28 + Math.sin(u * Math.PI) * 3], 2);
  return { v: 1, box: [1000, 1000], mode: 'sketch', strokes, meta: { source: 'preset', detail: 5, seed, version: 'spike-s4' } };
}

if (import.meta.main) {
  await mkdir('out/sketch/S4', { recursive: true });
  for (const [name, d] of [['line-6000', lineDoc()], ['sketch-400x15', sketchDoc()]] as const) {
    const bad = problems(d);
    if (bad.length) throw new Error(`${name}: ${bad.join('; ')}`);
    await writeFile(`out/sketch/S4/${name}.json`, JSON.stringify(d));
    console.log(`${name}: ${d.strokes.length} strokes, ${d.strokes.reduce((n, s) => n + s.pts.length, 0)} points`);
  }
}
