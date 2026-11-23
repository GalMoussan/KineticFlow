/**
 * Shared pieces of the neon traits (port of dilemma-reel `reel9.js`): colour helpers, the neon pin, and the exit
 * window that the reveal (exits), the transition (cut + flash) and their fingerprints agree on. Page-only helpers
 * (`rainbow`) may use transcendental Math; nothing here runs in the resolver.
 */
import type { Section } from '../contract.ts';

/** `#RRGGBB` → [r, g, b] 0..255. */
export function rgbOf(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

export const rgba = (hex: string, a: number): string => {
  const [r, g, b] = rgbOf(hex);
  return `rgba(${r},${g},${b},${a.toFixed(3)})`;
};

/** Linear mix of two `#RRGGBB` colours (k = 0 → a). */
export function mixHex(a: string, b: string, k: number): string {
  const x = rgbOf(a);
  const y = rgbOf(b);
  return `#${x.map((v, i) => Math.round(v + (y[i]! - v) * k).toString(16).padStart(2, '0')).join('')}`;
}

/** Hue in degrees of a `#RRGGBB` colour. */
export function hueOf(hex: string): number {
  const [r, g, b] = rgbOf(hex).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

/** reel9's cycling letter colour: hue walks with the letter index and with time. */
export const rainbow = (i: number, t: number, l = 62): string => `hsl(${((((i * 47 + t * 140) % 360) + 360) % 360).toFixed(1)}, 100%, ${l}%)`;

/**
 * The window in which a section's content exits and the cut to the next layer happens: [out, next.in], only when
 * the next section starts another scene layer and the window is not empty. Exits end at `t1`; the cut is at `t1`.
 */
export function exitWindow(s: Section): { t0: number; t1: number } | null {
  const n = s.next;
  if (!n || n.layer === s.layer || !n.window || n.window.t1 <= n.window.t0) return null;
  return { t0: n.window.t0, t1: n.window.t1 };
}

/** Exit kinds, rotated per section. */
export const EXITS = ['whip', 'zoom', 'fall'] as const;
export type Exit = (typeof EXITS)[number];

/** Gradient location pin with a white rim, `size` px tall-ish (width 0.72·size, height 0.9·size). */
export function neonPinSVG(size: number, id: string, from: string, to: string): string {
  return (
    `<svg width="${(size * 0.72).toFixed(2)}" height="${(size * 0.9).toFixed(2)}" viewBox="0 0 100 125" ` +
    `style="display:block;overflow:visible;filter:drop-shadow(0 0 ${(size * 0.12).toFixed(1)}px ${from})">` +
    `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/>` +
    `<stop offset="1" stop-color="${to}"/></linearGradient></defs>` +
    `<path d="M50 4 C25 4 8 22 8 46 C8 76 50 120 50 120 C50 120 92 76 92 46 C92 22 75 4 50 4 Z" fill="url(#${id})" ` +
    `stroke="#fff" stroke-width="4"/><circle cx="50" cy="45" r="15" fill="#fff"/></svg>`
  );
}

/** Ink metrics of the neon pin per 1 px of `size` (it sits on a baseline like a glyph). */
export const NEON_PIN_METRICS = { bl: 0, br: 0.72, ia: 0.86, id: 0.04, fa: 0, fd: 0 } as const;
