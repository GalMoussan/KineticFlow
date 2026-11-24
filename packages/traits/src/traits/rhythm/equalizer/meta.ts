import { defineMeta } from '../../../contract.ts';

/**
 * Letters as EQ bars: every grapheme of the content is the foot of an EQ bar (its spectrum colour sunk into the
 * background) that grows up from its ink with the band energy at its place on the start → end axis (sub · bass · mid · high,
 * interpolated), each letter with its own fixed gain, settling to `hold` × the stretch while the section holds; a peak
 * cap in the text colour hangs over every letter and falls back slowly (a slower release of the same bands). The
 * stage kicks with the sub band; `section.pulse(t)` is the smoothed bass. Without envelopes it follows the beat grid.
 */
export const meta = defineMeta({
  id: 'equalizer',
  axis: 'rhythm',
  layer: 'dom',
  label: 'Equalizer (letters as EQ bars)',
  requires: { unit: ['grapheme'] },
  params: {
    amp: { min: 0, max: 1.5, default: 0.7, label: 'Bar height at full band energy (× letter height)' },
    decay: { min: 2, max: 30, default: 11, label: 'Bar release (1/s)' },
    peak: { min: 0.5, max: 10, default: 2.2, label: 'Peak cap release (1/s; 0.5 = slow hold)' },
    kick: { min: 0, max: 0.04, default: 0.008, label: 'Stage zoom at full sub' },
    caps: { min: 0, max: 1, default: 1, label: 'Peak caps (0 = none)' },
    hold: { min: 0, max: 1, default: 0.4, label: 'Stretch while the section holds (× amp; settles for reading)' },
  },
});
