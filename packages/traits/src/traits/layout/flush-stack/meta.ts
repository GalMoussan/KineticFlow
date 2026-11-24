import { defineMeta } from '../../../contract.ts';

/**
 * Rows flush to the start edge (terminal listings, editorial pages, departure boards): the same row building as
 * `center-stack` (emphasis rows, packed plain words, role rows), but tokens are placed on their pen advances with a
 * word gap in em, so a monospace face keeps one character grid across rows. Options: a prompt glyph before the first
 * row (terminal), an accent kicker rule above the stack (editorial), the date line on one row like a board line, and
 * one size for every row (board cells).
 */
export const meta = defineMeta({
  id: 'flush-stack',
  axis: 'layout',
  layer: 'dom',
  label: 'Flush stack',
  roles: [
    'title', 'tagline', 'body', 'teaser', 'cta', 'heading', 'question', 'answer', 'quote',
    'datetime', 'location', 'list', 'stat', 'countdown', 'endcard',
  ],
  params: {
    align: { min: 0, max: 2, default: 0, label: 'Align: 0 start margin, 1 block centred, 2 rows centred' },
    leading: { min: 0.05, max: 1, default: 0.3, label: 'Gap between rows (em of the rows)' },
    cap: { min: 0.15, max: 0.6, default: 0.3, label: 'Largest row size (× safe width)' },
    plain: { min: 0.3, max: 1, default: 0.62, label: 'Plain word size (× emphasis size)' },
    weight: { min: 100, max: 900, default: 700, label: 'Font weight (static fonts: their one weight)' },
    gap: { min: 0.1, max: 1, default: 0.28, label: 'Word gap (em)' },
    prompt: { min: 0, max: 1, default: 0, label: 'Prompt glyph before the first row (0 = none)' },
    tail: { min: 0, max: 1.5, default: 0, label: 'Room kept after each row’s end (em; a typing cursor)' },
    rule: { min: 0, max: 1, default: 0, label: 'Accent kicker rule above the stack (0 = none)' },
    dateRow: { min: 0, max: 1, default: 0, label: 'Date line on one row when it fits (0 = stacked)' },
    uniform: { min: 0, max: 1, default: 0, label: 'One size for every row (1 = board grid)' },
  },
});
