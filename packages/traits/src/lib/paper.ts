/**
 * Paper helpers of the collage/print traits (`background/paper-print`, `material/cutout`). Page-side only (`hash`
 * uses `Math.sin`).
 */
import { hash } from '@reel/runtime';
import { rgbOf } from './neon.ts';

/**
 * A torn-paper polygon (CSS `clip-path`) around its box: every side broken into `teeth` points that bite inwards by
 * up to `depth` % of the box, hashed from `seed`.
 */
export function torn(seed: number, teeth: number, depth = 4): string {
  const pts: string[] = [];
  const sides: [number, number, number, number, number, number][] = [
    // from (x0, y0) to (x1, y1), inward direction (ix, iy)
    [0, 0, 100, 0, 0, 1],
    [100, 0, 100, 100, -1, 0],
    [100, 100, 0, 100, 0, -1],
    [0, 100, 0, 0, 1, 0],
  ];
  sides.forEach(([x0, y0, x1, y1, ix, iy], s) => {
    for (let i = 0; i < teeth; i++) {
      const k = i / teeth;
      const b = hash(seed * 31 + s * 50 + i * 7.3) * depth;
      pts.push(`${(x0 + (x1 - x0) * k + ix * b).toFixed(2)}% ${(y0 + (y1 - y0) * k + iy * b).toFixed(2)}%`);
    }
  });
  return `polygon(${pts.join(', ')})`;
}

/** Relative luminance (WCAG) of a `#RRGGBB` colour, 0..1. */
export function luminance(hex: string): number {
  const [r, g, b] = rgbOf(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
