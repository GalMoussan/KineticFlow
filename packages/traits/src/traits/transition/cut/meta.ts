import { defineMeta } from '../../../contract.ts';

/** Hard cut: the incoming layer replaces the outgoing one when the transition window starts. Fallback transition. */
export const meta = defineMeta({ id: 'cut', axis: 'transition', layer: 'dom', label: 'Cut', scope: 'layer', params: {} });
