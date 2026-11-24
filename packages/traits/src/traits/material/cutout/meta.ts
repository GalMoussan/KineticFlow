import { defineMeta } from '../../../contract.ts';

/**
 * Ransom-note cut-outs: every grapheme of a text unit sits on its own torn paper scrap (trait-owned elements behind
 * the measured parts, coloured from the palette's accents, some ruled like newsprint), tilted by a hashed angle, its
 * letter inked in black or paper white for contrast. Scraps copy their part's channels every frame, so they slap,
 * spin and fly with whatever the reveal does. Each word gets a strip of translucent tape slapped across a corner
 * after it lands; whole words take the layout's `data.layout.tilt`.
 */
export const meta = defineMeta({
  id: 'cutout',
  axis: 'material',
  layer: 'dom',
  label: 'Cut-out letters + tape',
  params: {
    tilt: { min: 0, max: 15, default: 7, label: 'Largest letter tilt (deg)' },
    pad: { min: 0, max: 0.2, default: 0.07, label: 'Scrap margin around each letter (em)' },
    tape: { min: 0, max: 1, default: 1, label: 'Tape strips (0 = none)' },
  },
});
