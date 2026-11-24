import { defineMeta } from '../../../contract.ts';

/**
 * Playing cards on a table: each section is one card (a list is a title card plus one card per item, in a column or
 * a 2-column grid), typeset ink-tight on the card face. Cards are dealt in face down (sliding and turning in from
 * the bottom start corner), flip over just before their first word lands (an orthographic flip about the card's
 * vertical axis seen from slightly above: exact parallel projection, the back shown while cos θ < 0), and fly off
 * towards the top end corner when the next section is dealt.
 */
export const meta = defineMeta({
  id: 'card-deck',
  axis: 'layout',
  layer: 'dom',
  label: 'Card deck',
  roles: [
    'title', 'tagline', 'body', 'teaser', 'cta', 'heading', 'question', 'answer', 'quote',
    'datetime', 'location', 'list', 'stat', 'countdown', 'endcard',
  ],
  params: {
    cap: { min: 0.1, max: 0.5, default: 0.22, label: 'Largest font size (× safe width)' },
    pad: { min: 0.2, max: 1.2, default: 0.55, label: 'Card padding (em of the base size)' },
    tilt: { min: 0, max: 20, default: 9, label: 'Camera elevation for the flip (deg)' },
    deal: { min: 0.2, max: 1, default: 0.5, label: 'Deal duration (s)' },
    flip: { min: 0.15, max: 0.8, default: 0.38, label: 'Flip duration (s)' },
    off: { min: 0.2, max: 1, default: 0.45, label: 'Fly-off duration (s)' },
  },
});
