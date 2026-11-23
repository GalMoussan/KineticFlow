import { defineMeta } from '../../../contract.ts';

/** Locked-off camera: every layer is seen as laid out (poster layouts, panel wipes). */
export const meta = defineMeta({ id: 'static', axis: 'camera', layer: 'dom', label: 'Static', params: {} });
