import { defineMeta } from '../../../contract.ts';

/**
 * The type stays up during the zoom (a punch that waits for `at` would hide the words while they grow into
 * the frame). A short fade from the moment the layer appears; opacity is 1 well before the hold, and the
 * layout fades the section again only once the camera has zoomed past it.
 */
export const meta = defineMeta({
  id: 'nest-show',
  axis: 'reveal',
  layer: 'dom',
  label: 'Nest show',
  requires: { layout: ['nest-frames'], camera: ['droste-zoom'] },
  params: {
    fade: { min: 0.05, max: 0.5, default: 0.22, label: 'Fade in from the moment the layer appears (s)' },
  },
});
