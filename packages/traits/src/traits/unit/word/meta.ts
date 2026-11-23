import { defineMeta } from '../../../contract.ts';

/** Items animate whole; multi-word items (list lines) are split into word parts. */
export const meta = defineMeta({ id: 'word', axis: 'unit', layer: 'dom', label: 'Words', params: {} });
