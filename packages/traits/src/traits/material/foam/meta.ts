import { defineMeta } from '../../../contract.ts';

/**
 * Latte art behind the key words: as the hero, an emphasised word or a number lands, milk foam pours into a wobbling
 * blob around it (accent 2 foam inside a crema rim of accent 3, SVG paths from `lib/morph/goo.ts`, no filters) that
 * settles into a slowly breathing cloud; text in espresso ink, emphasis in roast. Low soft pops per pour.
 */
export const meta = defineMeta({
  id: 'foam',
  axis: 'material',
  layer: 'dom',
  label: 'Latte foam',
  params: {
    pour: { min: 0.2, max: 1.5, default: 0.7, label: 'Pour duration (s)' },
    pad: { min: 0.1, max: 0.8, default: 0.38, label: 'Foam margin around the word (em)' },
    wobble: { min: 0, max: 0.2, default: 0.06, label: 'Settled wobble' },
  },
});
