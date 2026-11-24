import { defineMeta } from '../../../contract.ts';

/**
 * Terminal typing: every content unit is typed grapheme by grapheme in logical order (so RTL and mixed lines type
 * in reading order while the text keeps its bidi layout), item after item, behind a block cursor that is solid
 * while typing and blinks (from t) at rest. Emphasised words glitch briefly once typed (glyph substitution, RGB
 * split, slice offsets) and are clean again before the hold. A layout `prompt` decoration appears with the section.
 */
export const meta = defineMeta({
  id: 'typewriter',
  axis: 'reveal',
  layer: 'dom',
  label: 'Typewriter + cursor',
  needs: { chars: true },
  params: {
    lead: { min: 0, max: 0.3, default: 0.04, label: 'Start before landing (s)' },
    rate: { min: 0.02, max: 0.12, default: 0.055, label: 'Seconds per keystroke (shortened to fit)' },
    glitch: { min: 0, max: 0.5, default: 0.3, label: 'Glitch on emphasis (s, 0 = none)' },
    blink: { min: 0.25, max: 1.2, default: 0.5, label: 'Cursor blink half-period (s)' },
  },
});
