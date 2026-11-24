import { defineMeta } from '../../../contract.ts';

/**
 * Bento grid: every section is a set of rounded tiles that fill the safe area completely (`pack.ts`: guillotine
 * packing of the tiles in reading order on a fine cell grid, maximising the text size each tile allows). Runs of
 * plain words share a tile, emphasis, the hero, numbers, the date, the place and the logos get tiles of their own,
 * and one or two accent tiles carry an icon. Between sections the tiles re-pack: each one moves, resizes and
 * recolours from the previous section's tile of the same index.
 */
export const meta = defineMeta({
  id: 'bento',
  axis: 'layout',
  layer: 'dom',
  label: 'Bento tiles (re-pack)',
  roles: [
    'title', 'tagline', 'body', 'teaser', 'cta', 'heading', 'question', 'answer', 'quote',
    'datetime', 'location', 'list', 'stat', 'countdown', 'endcard',
  ],
  params: {
    radius: { min: 0, max: 0.5, default: 0.26, label: 'Corner radius (× cell size)' },
    icons: { min: 0, max: 2, default: 2, label: 'Most icon tiles per section' },
    press: { min: 0, max: 1, default: 0.5, label: 'Tile press when its content lands' },
  },
});
