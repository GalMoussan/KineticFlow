import { defineMeta } from '../../../contract.ts';

/**
 * Word per beat: every content unit gets a solo copy (`deco: 'solo'`) sized to fill the safe area on its own, over a
 * full-frame colour panel; at the section's recap (`section.data.layout.stackT`, the last landing or the grid point
 * after it) the real units show stacked, one per row, each fitted to the safe width (row sizes capped together so
 * the stack fits the safe height), every row on its own full-width colour band.
 */
export const meta = defineMeta({
  id: 'beat-stack',
  axis: 'layout',
  layer: 'dom',
  label: 'Beat stack (solo words → banded recap)',
  roles: [
    'title', 'tagline', 'body', 'teaser', 'cta', 'heading', 'question', 'answer', 'quote',
    'datetime', 'location', 'list', 'stat', 'countdown', 'endcard',
  ],
  params: {
    leading: { min: 0.05, max: 0.8, default: 0.2, label: 'Gap between recap rows (em)' },
    cap: { min: 0.1, max: 0.6, default: 0.42, label: 'Largest recap row size (× safe height)' },
    solo: { min: 0.3, max: 1, default: 0.78, label: 'Solo word height limit (× safe height)' },
    recap: { min: 0.2, max: 1.5, default: 0.45, label: 'Shortest recap before the hold ends (s)' },
  },
});
