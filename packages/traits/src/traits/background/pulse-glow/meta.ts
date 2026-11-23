import { defineMeta } from '../../../contract.ts';

/**
 * Club-dark backdrop that breathes with the music: a floor glow and a centre bloom in the palette's accents, and a
 * speaker-cone ring that contracts on every hit, all following `section.pulse(t)` (the smoothed bass under
 * `rhythm: audio-reactive`, the beat pulse otherwise). Plain DOM gradients, rewritten every frame (no canvas).
 */
export const meta = defineMeta({
  id: 'pulse-glow',
  axis: 'background',
  layer: 'dom',
  label: 'Pulse glow',
  params: {
    glow: { min: 0, max: 1, default: 0.8, label: 'Glow strength' },
    ring: { min: 0, max: 1, default: 0.6, label: 'Cone ring strength (0 = none)' },
  },
});
