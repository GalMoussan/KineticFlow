import { defineMeta } from '../../../contract.ts';

/**
 * The music's band envelopes (`REEL.cues.envelopes`, per video frame) drive the page: the hero and emphasised units
 * scale and glow with the bass, every unsplit text unit's weight follows the mid band on variable fonts, the stage
 * kick follows the sub band and an RGB-split shimmer follows the highs. `section.pulse(t)` is the smoothed bass, so
 * materials and backgrounds that pulse follow it too. Without envelopes it falls back to the beat grid.
 */
export const meta = defineMeta({
  id: 'audio-reactive',
  axis: 'rhythm',
  layer: 'dom',
  label: 'Audio-reactive (band envelopes)',
  params: {
    kick: { min: 0, max: 0.06, default: 0.025, label: 'Stage zoom at full sub' },
    decay: { min: 2, max: 30, default: 9, label: 'Release after each peak (1/s; lower = smoother)' },
    bass: { min: 0, max: 0.25, default: 0.1, label: 'Hero/emphasis scale at full bass (glow follows)' },
    mid: { min: 0, max: 1, default: 0.6, label: 'Weight swing with the mids (variable fonts)' },
    high: { min: 0, max: 1, default: 0.5, label: 'RGB-split shimmer with the highs' },
  },
});
