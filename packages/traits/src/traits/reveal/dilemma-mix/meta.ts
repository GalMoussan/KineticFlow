import { defineMeta } from '../../../contract.ts';

/**
 * Dilemma staging (with `layout/dilemma-cards`): cards settle in from the section's start, option B slides out from
 * behind option A as the connector disc pops, '?' seals and the face-down answer card beat with the section's pulse
 * (a heartbeat with `rhythm/heartbeat`) until their reveal; seals split open on their word's landing, the answer card
 * flips to its accent face with an accent flash. Plain words rise calmly. Heartbeat thumps while something waits,
 * risers into reveals, impacts and shimmers on them.
 */
export const meta = defineMeta({
  id: 'dilemma-mix',
  axis: 'reveal',
  layer: 'dom',
  label: 'Dilemma mix',
  params: {
    beat: { min: 0, max: 0.2, default: 0.07, label: 'Heartbeat scale of seals and the disc' },
    rise: { min: 0, max: 1, default: 0.28, label: 'Plain word rise (em)' },
    duration: { min: 0.2, max: 1.2, default: 0.45, label: 'Entrance duration (s)' },
    flash: { min: 0, max: 1, default: 0.35, label: 'Accent flash on the answer flip' },
    thump: { min: 0, max: 0.6, default: 0.22, label: 'Heartbeat thump loudness (0 = none)' },
  },
});
