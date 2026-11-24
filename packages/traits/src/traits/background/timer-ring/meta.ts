import { defineMeta } from '../../../contract.ts';

/**
 * Launch-control dial: a dark field with a soft centre glow, a dial of tick marks and a thick timer ring in the
 * accent that drains clockwise through each section (full when it enters, empty when it leaves), its head a bright
 * dot; the ring breathes a little on the beat. SVG in `layer.under`, rewritten every frame from t.
 */
export const meta = defineMeta({
  id: 'timer-ring',
  axis: 'background',
  layer: 'dom',
  label: 'Timer ring',
  params: {
    radius: { min: 0.2, max: 0.7, default: 0.47, label: 'Ring radius (× the shorter safe side)' },
    width: { min: 0.005, max: 0.08, default: 0.03, label: 'Ring width (× the shorter safe side)' },
    ticks: { min: 0, max: 1, default: 0.35, label: 'Dial tick opacity (0 = none)' },
    glow: { min: 0, max: 1, default: 0.5, label: 'Centre glow strength' },
    beat: { min: 0, max: 1, default: 0.4, label: 'Ring breathing on the beat' },
  },
});
