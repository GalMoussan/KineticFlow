import { defineMeta } from '../../../contract.ts';

/** Static framing (identity view); every unit's declared `hit` shakes the stage, decaying fast (reel9). */
export const meta = defineMeta({
  id: 'shake',
  axis: 'camera',
  layer: 'dom',
  label: 'Static + hit shake',
  params: {
    shake: { min: 0, max: 3, default: 1, label: 'Shake amplitude (× each hit’s own)' },
    decay: { min: 2, max: 30, default: 11, label: 'Shake decay (1/s)' },
    length: { min: 0.1, max: 2, default: 0.6, label: 'Shake length (s)' },
  },
});
