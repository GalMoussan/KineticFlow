import { defineMeta } from '../../../contract.ts';

/**
 * Countdown slams: numbers count DOWN on the beat grid before they land (stats and countdowns step down to their
 * value on half-beats, the date gets a giant 3 · 2 · 1 on beats in its slot), each step a uniform scale punch, then
 * the real number slams in (the date with a stage flash). Emphasis, hero and time words slam in from a big scale,
 * plain words drop in, plates, pins and the logo badge pop. Ticks rising in pitch per step, impacts on slams.
 */
export const meta = defineMeta({
  id: 'count-slam',
  axis: 'reveal',
  layer: 'dom',
  label: 'Count-down slam',
  needs: { chars: true },
  params: {
    slam: { min: 1.1, max: 3, default: 1.8, label: 'Slam start scale' },
    step: { min: 1, max: 2, default: 1.45, label: 'Countdown step punch scale' },
    giant: { min: 1, max: 2, default: 1.5, label: 'Launch digit size (× the date)' },
    flash: { min: 0, max: 1, default: 0.55, label: 'Stage flash on the date slam' },
    shake: { min: 0, max: 0.2, default: 0.07, label: 'Hit shake of a number slam (× its size)' },
  },
});
