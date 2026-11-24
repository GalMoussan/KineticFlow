/**
 * Shared choreography of the morph reveals (`reveal/glyph-morph`, `reveal/shape-morph`, `reveal/liquid-morph`).
 *
 * The incoming section's reveal draws everything that moves across its window: the previous section's text as
 * outlines (its layer is cut away at the window start, `transition: cut`) and its own units until each lands. Real
 * DOM text is hidden only while its outline stands in for it, and shows from the unit's landing on, so every hold
 * shows the real text. Page-only (DOM, `Math.sin`).
 */
import { clamp01, lerp } from '@reel/runtime';
import type { Section, Unit } from '../../contract.ts';
import { groupOffset } from './page.ts';

/** Revealed content units with text (no logos), in landing order. */
export function textUnits(s: Section): Unit[] {
  return s.units
    .filter((u) => u.revealed && u.item >= 0 && !!u.text && u.kind !== 'logos' && u.font.size > 0)
    .sort((a, b) => a.at - b.at || a.id - b.id);
}

/**
 * The previous section when this section's reveal can draw its text: it is in another layer that is cut away at the
 * window start, and both groups are related by a translation. `off` maps its group coordinates into ours.
 */
export function prevSource(s: Section): { prev: Section; off: [number, number] } | null {
  const prev = s.prev;
  if (!prev || !s.window || prev.layer === s.layer || s.layer.sections[0] !== s) return null;
  const off = groupOffset(prev, s);
  return off ? { prev, off } : null;
}

/** What of a unit an outline drawn in another section depends on (fingerprint stand-in). */
export function describe(u: Unit): unknown {
  return { item: u.item, text: u.text, ltr: u.ltr, font: u.font, box: u.box, textAt: u.textAt, color: u.color };
}

/**
 * Entrance of a unit drawn by the DOM itself (logos, pins, text that cannot be outlined): fade and settle from 0.9×
 * over [at − 0.25, at + 0.1].
 */
export function plainEntrance(s: Section, u: Unit, t: number): void {
  const k = clamp01((t - (u.at - 0.25)) / 0.35);
  u.ch.visible &&= k > 0;
  const e = s.motion.enter(k);
  u.ch.opacity *= k;
  u.ch.isx *= lerp(0.9, 1, e);
  u.ch.isy *= lerp(0.9, 1, e);
  u.ch.blur += (1 - e) * 6;
}

/**
 * Fits the phases of an entrance that should end at `end` into [floor, end]: returns the start and the time factor
 * (≤ 1) by which every phase is compressed when the full length does not fit.
 */
export function fit(end: number, length: number, floor: number): { start: number; f: number } {
  const start = Math.max(floor, end - length);
  return { start, f: length > 0 ? Math.min(1, (end - start) / length) : 1 };
}
