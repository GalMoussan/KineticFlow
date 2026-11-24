import { defineMeta } from '../../../contract.ts';

/**
 * Calm UI entrances: words fade up out of a short blur, one after another inside a unit; stats and countdowns
 * count up from zero (digit glyphs, real digits at the end); the logo badge scales in. Soft pops, pitch rising
 * through a section, a tick per counting step.
 */
export const meta = defineMeta({
  id: 'soft-rise',
  axis: 'reveal',
  layer: 'dom',
  label: 'Soft rise + count-up',
  needs: { chars: true },
  params: {
    lead: { min: 0, max: 0.5, default: 0.12, label: 'Start before landing (s)' },
    duration: { min: 0.2, max: 1.5, default: 0.45, label: 'Entrance duration (s)' },
    rise: { min: 0, max: 1, default: 0.32, label: 'Rise distance (em)' },
    blur: { min: 0, max: 2, default: 1, label: 'Entrance blur (× default)' },
    count: { min: 0.3, max: 2, default: 0.9, label: 'Count-up duration (s)' },
  },
});
