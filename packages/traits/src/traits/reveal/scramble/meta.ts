import { defineMeta } from '../../../contract.ts';

/**
 * Decode: every grapheme cell first shows stand-in glyphs that change many times a second (Hebrew letters for
 * Hebrew graphemes, Latin of the same case for Latin, digits for digits, symbols otherwise; deterministic `hash`),
 * then a resolve front runs through the unit in reading (logical) order and each cell locks onto its real grapheme
 * with a brief flare. Niqqud stays with its letter: cells are whole graphemes.
 */
export const meta = defineMeta({
  id: 'scramble',
  axis: 'reveal',
  layer: 'dom',
  label: 'Scramble decode',
  needs: { chars: true },
  params: {
    lead: { min: 0, max: 0.6, default: 0.3, label: 'Start before landing (s)' },
    resolve: { min: 0.2, max: 1.5, default: 0.7, label: 'Start to fully decoded (s, shortened to fit the hold)' },
    rate: { min: 6, max: 40, default: 18, label: 'Glyph changes per second' },
    spill: { min: 0, max: 0.05, default: 0.014, label: 'Cells appearing one after another (s)' },
  },
});
