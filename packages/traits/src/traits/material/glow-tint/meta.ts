import { defineMeta } from '../../../contract.ts';

/**
 * Palette fills by tag (hero and even emphasis: accent 0, odd emphasis: accent 2, numbers: accent 1, the rest: the
 * text colour) with an optional soft glow in each glyph's own colour (phosphor screens, lit board letters). The
 * glow goes to the parts of split units, so it follows per-part colours a reveal sets (scramble, glitch).
 */
export const meta = defineMeta({
  id: 'glow-tint',
  axis: 'material',
  layer: 'dom',
  label: 'Tint + soft glow',
  params: {
    glow: { min: 0, max: 2, default: 0, label: 'Glow radius (× 0.06 em, 0 = flat)' },
  },
});
