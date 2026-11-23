/**
 * esbuild plugin: patches troika-three-text 0.52.5's Typesetter (dist ESM) at bundle time so zero-advance
 * glyphs (Hebrew niqqud marks) survive RTL layout.
 *
 * Stock troika has three mark bugs, all visible with Hebrew niqqud:
 * 1. Bidi run flip: every glyph is mirrored as `x' = right − (x + hmtxAdvance − left)`. A zero-advance
 *    mark placed at `base + d` (d = GPOS mark-to-base anchor offset) lands at `base' + baseAdvance − d`
 *    instead of `base' + d`: marks are mirrored about the base's centre (shin dot ↔ sin dot).
 * 2. The flip extent (`left`/`right`) includes marks, whose ink can stick out past their base.
 * 3. `line.width` is taken from the last glyph in logical order; when that is a mark it is
 *    `base + d` instead of `base + advance`, which shifts `anchorX: 'right'|'center'` layouts.
 * The patch keeps the stock formula for advancing glyphs, ignores zero-advance glyphs for extents/width,
 * and re-attaches zero-advance glyphs at their pre-flip offset from the preceding advancing glyph.
 * (A variant that also flipped by the GPOS-adjusted pen advance made kerning worse: measured, dropped.)
 */
import type { Plugin } from 'esbuild';
import { readFile } from 'node:fs/promises';

const REPLACEMENTS: [stock: string, patched: string][] = [
  [
    `          if (isTrailingWhitespace && !glyphInfo.glyphObj.isWhitespace) {`,
    `          if (isTrailingWhitespace && !glyphInfo.glyphObj.isWhitespace && (glyphInfo.width !== 0 || i === 0)) { // [M0c patch] skip marks`,
  ],
  [
    `                    if (endInLine < lineGlyphCount - trailingWhitespaceCount) { //don't include trailing ws in flip width`,
    `                    if (endInLine < lineGlyphCount - trailingWhitespaceCount && (info.width !== 0 || left === Infinity)) { // [M0c patch] skip marks`,
  ],
  [
    `                  for (let j = startInLine; j < endInLine; j++) {
                    const glyphInfo = line.glyphAt(j);
                    glyphInfo.x = right - (glyphInfo.x + glyphInfo.width - left);
                  }`,
    `                  { // [M0c patch] zero-advance marks keep their offset from the base instead of being mirrored
                    let baseOld = 0, baseNew = 0;
                    for (let j = startInLine; j < endInLine; j++) {
                      const glyphInfo = line.glyphAt(j);
                      const x = glyphInfo.x, w = glyphInfo.width;
                      if (w === 0 && j > startInLine) { glyphInfo.x = baseNew + (x - baseOld); continue }
                      baseOld = x;
                      baseNew = glyphInfo.x = right - (x + w - left);
                    }
                  }`,
  ],
];

export const troikaFlipPatch: Plugin = {
  name: 'troika-rtl-mark-patch',
  setup(build) {
    build.onLoad({ filter: /troika-three-text[\\/]dist[\\/]troika-three-text\.esm\.js$/ }, async (args) => {
      let src = await readFile(args.path, 'utf8');
      for (const [stock, patched] of REPLACEMENTS) {
        if (!src.includes(stock)) throw new Error(`troika patch target not found (version changed?): ${stock.trim().slice(0, 60)}`);
        src = src.replace(stock, patched);
      }
      return { contents: src, loader: 'js' };
    });
  },
};
