import { defineMeta } from '../../../contract.ts';

/**
 * Tracking in: letters arrive spread wide about their row's centre and close in to the row's final tracking while
 * they fade up out of a light blur, slowly (part `tx` from measured grapheme parts; the text never re-flows).
 * Hairline rules draw out from their centre; the logo badge fades in. Quiet shimmers and soft pops.
 */
export const meta = defineMeta({
  id: 'track-in',
  axis: 'reveal',
  layer: 'dom',
  label: 'Track in',
  needs: { chars: true },
  params: {
    lead: { min: 0, max: 0.6, default: 0.15, label: 'Start before landing (s)' },
    duration: { min: 0.4, max: 3, default: 1.5, label: 'Tracking duration (s)' },
    spread: { min: 0, max: 2, default: 0.8, label: 'Extra tracking at the start (× distance to the row centre)' },
    fade: { min: 0.1, max: 2, default: 0.7, label: 'Fade-in duration (s)' },
    blur: { min: 0, max: 12, default: 5, label: 'Start blur (px)' },
    rule: { min: 0.3, max: 3, default: 1.4, label: 'Hairline draw duration (s)' },
  },
});
