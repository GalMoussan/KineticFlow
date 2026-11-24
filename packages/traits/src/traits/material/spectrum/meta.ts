import { defineMeta } from '../../../contract.ts';

/**
 * Spectrum fill: each letter takes the palette accent of its place on the start → end axis (low bands first, as the
 * equalizer maps them), with a glow that breathes with `section.pulse(t)`.
 */
export const meta = defineMeta({
  id: 'spectrum',
  axis: 'material',
  layer: 'dom',
  label: 'Spectrum letters',
  needs: { chars: true },
  params: {
    glow: { min: 0, max: 2, default: 0.6, label: 'Pulse glow (× default)' },
  },
});
