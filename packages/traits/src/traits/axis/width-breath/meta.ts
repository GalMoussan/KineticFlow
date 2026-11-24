import { defineMeta } from '../../../contract.ts';

/**
 * Slow `wdth`/`wght` breathing (variable fonts with a width axis, e.g. Noto Sans Hebrew 62.5–100): words inhale
 * from condensed and light to full width and weight as they land, then breathe on a slow beat-locked cycle (rows a
 * little out of phase), only ever narrower and lighter than the layout so nothing can touch; exits exhale. Widths
 * per breath step are measured in the DOM, so every word (and every word part) stays centred.
 */
export const meta = defineMeta({
  id: 'width-breath',
  axis: 'axis',
  layer: 'dom',
  label: 'Width breath',
  params: {
    narrow: { min: 50, max: 100, default: 62.5, label: 'Narrowest width (wdth %, clamped by the font)' },
    lighten: { min: 0, max: 500, default: 220, label: 'Weight lost at the narrowest (wght units)' },
    depth: { min: 0, max: 1, default: 0.45, label: 'Breath depth while holding (share of the full exhale)' },
    period: { min: 2, max: 16, default: 4, label: 'Breath period (beats)' },
    entry: { min: 0.3, max: 2.5, default: 1.1, label: 'Inhale on landing (s)' },
    lag: { min: 0, max: 0.4, default: 0.12, label: 'Phase lag between rows (share of a period)' },
  },
});
