import { defineMeta } from '../../../contract.ts';

/**
 * Data reveal: stats and countdowns count up in fixed digit slots (part `glyph`, real digits from the end of the
 * count), date and time digits roll up one slot after another, labels and words drop onto their baseline with a
 * small bounce, bars grow from their start edge in step with their number's count, cards and marks fade in.
 * Ticks while counting, a pop when a number settles, a riser along each growing bar.
 */
export const meta = defineMeta({
  id: 'tally',
  axis: 'reveal',
  layer: 'dom',
  label: 'Tally (count up + bars)',
  needs: { chars: true },
  params: {
    lead: { min: 0, max: 0.5, default: 0.12, label: 'Start before landing (s)' },
    duration: { min: 0.2, max: 1.2, default: 0.45, label: 'Word / label entrance (s)' },
    count: { min: 0.3, max: 2, default: 0.9, label: 'Count-up and bar growth (s)' },
    drop: { min: 0, max: 1, default: 0.42, label: 'Label drop distance (em)' },
  },
});
