import { defineMeta } from '../../../contract.ts';

/**
 * Calm layer change: the outgoing layer fades out while the incoming one fades in, either overlapping (`dip` 0, a
 * crossfade) or one after the other through the background (`dip` 1); the content may drift up as it goes (`push`,
 * outgoing leaves upwards, incoming arrives from below). No flashes, no blur.
 */
export const meta = defineMeta({
  id: 'fade-push',
  axis: 'transition',
  layer: 'dom',
  label: 'Fade + push',
  scope: 'layer',
  params: {
    dip: { min: 0, max: 1, default: 0.5, label: 'Dip through the background: 0 crossfade, 1 out then in' },
    push: { min: 0, max: 0.4, default: 0, label: 'Content drift up (× safe height)' },
    sound: { min: 0, max: 0.6, default: 0.2, label: 'Swipe weight across the window (0 = silent)' },
  },
});
