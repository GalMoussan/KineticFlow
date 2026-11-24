import { defineMeta } from '../../../contract.ts';

/**
 * A tall scrolling column of the section's line (stacked-scroll): the content as a centred block (center-stack's
 * role rules) repeated above and below as outlined copies, one period (block height + `gap`) apart, enough to fill
 * the frame wherever the camera scrolls. After the last landing the copies step up the column on every beat while
 * the real block stays frozen at the centre; copies crossing it fade out, its own slot's copy is the ghost the words
 * stamp onto.
 */
export const meta = defineMeta({
  id: 'scroll-stack',
  axis: 'layout',
  layer: 'dom',
  label: 'Scroll stack (repeated copies)',
  roles: [
    'title', 'tagline', 'body', 'teaser', 'cta', 'heading', 'question', 'answer', 'quote',
    'datetime', 'location', 'list', 'stat', 'countdown', 'endcard', 'lyric',
  ],
  params: {
    cap: { min: 0.15, max: 0.6, default: 0.3, label: 'Largest emphasis size (× safe width)' },
    plain: { min: 0.3, max: 1, default: 0.64, label: 'Plain word size (× emphasis size)' },
    leading: { min: 0.05, max: 1.2, default: 0.22, label: 'Gap between rows (em of the rows)' },
    gap: { min: 0.1, max: 1.5, default: 0.42, label: 'Gap between copies (em of the base size)' },
    dim: { min: 0.1, max: 1, default: 0.72, label: 'Copy opacity' },
    stroke: { min: 0.005, max: 0.06, default: 0.02, label: 'Copy outline width (em)' },
    step: { min: 0, max: 1, default: 0.5, label: 'Copies step per beat after the landings (× period)' },
    reach: { min: 0.3, max: 2, default: 0.85, label: 'Scroll travel in and out (× frame height)' },
    share: { min: 0.2, max: 1, default: 0.42, label: 'Block height (× safe height)' },
  },
});
