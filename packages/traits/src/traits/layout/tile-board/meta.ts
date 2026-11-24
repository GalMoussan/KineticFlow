import { defineMeta } from '../../../contract.ts';

/**
 * Letter-board mosaic: the frame is a grid of square cells; every grapheme of every content unit sits on its own
 * cell (words one idle cell apart, rows snapped to the grid, centred), one pitch per section, the largest that fits
 * the safe area. Each content unit's `data.layout` holds its run of cells; the layer's `data.layout` the grid
 * (`lib/mosaic.ts`) that the reveal (`tile-flip`) and background (`tile-ripple`) draw on. The logos sit on one big
 * tile spanning whole cells.
 */
export const meta = defineMeta({
  id: 'tile-board',
  axis: 'layout',
  layer: 'dom',
  label: 'Letter-tile board',
  roles: [
    'title', 'tagline', 'body', 'teaser', 'cta', 'heading', 'question', 'answer', 'quote',
    'datetime', 'location', 'list', 'stat', 'countdown', 'endcard',
  ],
  params: {
    cap: { min: 0.08, max: 0.3, default: 0.18, label: 'Largest cell (× the safe area’s shorter side)' },
    lead: { min: 0, max: 0.5, default: 0.18, label: 'Pitch given up for an empty row between rows (share)' },
    font: { min: 0.4, max: 0.75, default: 0.58, label: 'Glyph size (× cell)' },
    grout: { min: 0.02, max: 0.2, default: 0.08, label: 'Grout (× cell)' },
    weight: { min: 100, max: 900, default: 800, label: 'Font weight' },
  },
});
