/** Seeded randomness for every audio code path: mulberry32 only, so Node and the browser draw the same numbers. */
import { cosTurns, log } from './dmath.ts';

/** Seeded uniform [0, 1) generator (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mixes a seed with a stream index into a new 32-bit seed (splitmix-style), for independent per-voice streams. */
export function subSeed(seed: number, index: number): number {
  let z = (seed ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
  return (z ^ (z >>> 16)) >>> 0;
}

/** Seeded standard-normal generator (Box–Muller over mulberry32 with deterministic math, both outputs used). */
export function gaussian(seed: number): () => number {
  const uniform = mulberry32(seed);
  let spare = 0;
  let hasSpare = false;
  return () => {
    if (hasSpare) {
      hasSpare = false;
      return spare;
    }
    const u = 1 - uniform(); // (0, 1]
    const v = uniform();
    const r = Math.sqrt(-2 * log(u));
    spare = r * cosTurns(v - 0.25); // sin(2πv)
    hasSpare = true;
    return r * cosTurns(v);
  };
}
