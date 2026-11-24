import { defineMeta } from '../../../contract.ts';

/**
 * Departure-board flaps: every grapheme sits in a dark board cell (trait-owned elements behind the measured parts,
 * blank cells padding each row to the board width, a housing behind them and a hinge line across each row). A cell
 * flips through stand-in glyphs of its script (`lib/glyphs.ts`) and settles on its real grapheme, cells settling
 * one after another in reading order. Each flip is a planar map (D16): a leaf element folds on the hinge over the
 * top half, then unfolds over the bottom half, and the glyph swaps at the fold.
 */
export const meta = defineMeta({
  id: 'flap',
  axis: 'reveal',
  layer: 'dom',
  label: 'Split-flap board',
  needs: { chars: true },
  params: {
    lead: { min: 0, max: 0.8, default: 0.4, label: 'Start flipping before landing (s)' },
    flips: { min: 2, max: 20, default: 7, label: 'Flips before the first cell settles' },
    period: { min: 0.04, max: 0.2, default: 0.07, label: 'Seconds per flip' },
    wave: { min: 0, max: 0.12, default: 0.045, label: 'Settle stagger per cell (s)' },
  },
});
