/**
 * Equalizer geometry shared by `rhythm/equalizer`, `reveal/bar-rise` and `material/spectrum`: where each letter
 * sits on the low → high axis, its colour there, growth from the baseline. Page-side only.
 */
import type { Host, Part, Section, Unit } from '../contract.ts';

/** Baseline y of a unit in its inner element's coordinates (where parts are measured). */
export const innerBaseline = (u: Unit): number => u.baseline - (u.box.y + u.textAt.y);

/**
 * Scales a part uniformly by `k` keeping its baseline point `yb` (inner coordinates) fixed, composing with scales
 * already applied the same way (parts scale around their centre): ty grows by (yb − c) · s · (1 − k). Uniform only:
 * text under a non-similarity transform (non-uniform scale, skew) rasters differently with the seek history and
 * across launches (measured with `dev/stills.ts`), so letters never stretch through `sy`.
 */
export function growFromBaseline(p: Part, k: number, yb: number): void {
  p.ch.ty += (yb - (p.y + p.h / 2)) * p.ch.sy * (1 - k);
  p.ch.sx *= k;
  p.ch.sy *= k;
}

/** Palette accent of spectrum position f (low bands → first accent). */
export function spectrumColor(host: Host, s: Section, f: number): string {
  const n = s.palette.accents.length;
  return host.accent(Math.min(n - 1, Math.floor(f * n)), s);
}

/**
 * Each text part's position 0..1 on the section's spectrum axis: its ink centre across all the section's split text,
 * from the start edge (low bands) to the end edge (high bands), in reading direction.
 */
export function spectrumPos(s: Section): Map<Part, number> {
  const xs: { p: Part; x: number }[] = [];
  for (const u of s.units) {
    if (u.item < 0) continue;
    for (const p of u.parts) xs.push({ p, x: u.box.x + u.textAt.x + p.x + p.w / 2 });
  }
  const out = new Map<Part, number>();
  if (!xs.length) return out;
  const x0 = Math.min(...xs.map((v) => v.x));
  const x1 = Math.max(...xs.map((v) => v.x));
  const span = Math.max(1, x1 - x0);
  for (const { p, x } of xs) {
    const f = (x - x0) / span;
    out.set(p, s.dir === 'rtl' ? 1 - f : f);
  }
  return out;
}
