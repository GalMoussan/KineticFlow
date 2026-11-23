import { defineMeta } from '../../../contract.ts';

/** Every item is split into grapheme parts (niqqud stays on its letter). */
export const meta = defineMeta({ id: 'grapheme', axis: 'unit', layer: 'dom', label: 'Letters', params: {} });
