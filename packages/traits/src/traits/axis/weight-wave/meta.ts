import { defineMeta } from '../../../contract.ts';

/**
 * A `wght` wave runs across the letters on the beat: every grapheme part's weight (part `wght`) dips as a wave
 * front passes it in reading order, one wave per beat until the hold; letters swell from hairline to full weight as
 * they land and drain back to hairline on exits. A letter off the layout weight takes its own advance and the
 * word repacks around it (neighbours stay tight, the line stays centred); at the hold every letter is the layout
 * weight in the measured split, with that split's kerning.
 */
export const meta = defineMeta({
  id: 'weight-wave',
  axis: 'axis',
  layer: 'dom',
  label: 'Weight wave',
  needs: { chars: true },
  params: {
    depth: { min: 0, max: 800, default: 620, label: 'Weight dip at the wave front (wght units)' },
    travel: { min: 0.3, max: 4, default: 1.1, label: 'Beats a wave takes to cross the section' },
    width: { min: 0.04, max: 0.6, default: 0.16, label: 'Wave half-width (share of the reading span)' },
    every: { min: 1, max: 4, default: 1, label: 'A wave every n beats' },
    entry: { min: 0.15, max: 1.5, default: 0.5, label: 'Weight swell across a landing word (s)' },
    floor: { min: 100, max: 600, default: 100, label: 'Lightest weight (clamped to the font)' },
  },
});
