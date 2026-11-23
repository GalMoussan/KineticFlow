import { defineMeta } from '../../../contract.ts';

/**
 * Impacts from the cue sheet: every landing kicks the camera zoom, every emphasis cue also flashes the frame white,
 * and the beat gives a small punch-in (reel9).
 */
export const meta = defineMeta({
  id: 'hits',
  axis: 'rhythm',
  layer: 'dom',
  label: 'Hits: kick + flash',
  params: {
    kick: { min: 0, max: 0.05, default: 0.014, label: 'Kick zoom per landing' },
    decay: { min: 1, max: 30, default: 9, label: 'Kick decay (1/s)' },
    length: { min: 0.1, max: 2, default: 0.6, label: 'Kick length (s)' },
    punch: { min: 0, max: 0.05, default: 0.012, label: 'Beat punch-in zoom' },
    flash: { min: 0, max: 1, default: 0.4, label: 'Flash on emphasis' },
  },
});
