/**
 * Step 1 (Node): load harfbuzzjs, shape the test words with NotoSansHebrew at wght 400 and 900, and emit
 * positioned SVG path data per glyph cluster. Writes out/shape.json and out/shape.svg.
 *   node spikes/morph/shape.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { loadFont, shapeText, cmdsToD, type Shaped } from './hb.ts';
import { loadHb, fontBytes, OUT } from './node-hb.ts';

export const WORDS = ['שָׁלוֹם', 'קפה', 'דילמה', 'Talk'];
export const WGHTS = [400, 900];

mkdirSync(OUT, { recursive: true });
const t0 = performance.now();
const hb = await loadHb();
const tWasm = performance.now() - t0;
const t1 = performance.now();
const noto = loadFont(hb, fontBytes('NotoSansHebrew'));
const tFont = performance.now() - t1;
console.log(`harfbuzz ${hb.version_string()}: wasm init ${tWasm.toFixed(1)} ms, font load ${tFont.toFixed(2)} ms, axes ${JSON.stringify(noto.axes)}`);

type ClusterOut = { cl: number; chars: string; glyphs: { g: number; mark: boolean; x: number; y: number; ax: number }[]; d: string };
const result: Record<string, { width: number; clusters: ClusterOut[]; d: string }> = {};
const rows: string[] = [];
let y = 260;
for (const wght of WGHTS) {
  for (const word of WORDS) {
    const sh: Shaped = shapeText(noto, word, 200, wght, false);
    // Group glyphs by cluster; cluster text = input slice from cl to the next larger cluster start.
    const starts = [...new Set(sh.glyphs.map((g) => g.cl))].sort((a, b) => a - b);
    const clusters: ClusterOut[] = starts.map((cl, i) => {
      const gs = sh.glyphs.filter((g) => g.cl === cl);
      return {
        cl,
        chars: word.slice(cl, starts[i + 1] ?? word.length),
        glyphs: gs.map((g) => ({ g: g.g, mark: g.mark, x: +g.x.toFixed(2), y: +g.y.toFixed(2), ax: +g.ax.toFixed(2) })),
        d: gs.map((g) => cmdsToD(g.cmds)).join(''),
      };
    });
    result[`${word}@${wght}`] = { width: +sh.width.toFixed(2), clusters, d: sh.d };
    console.log(
      `${word} wght ${wght}: width ${sh.width.toFixed(1)} px, ${sh.glyphs.length} glyphs, ${clusters.length} clusters, marks ${sh.glyphs.filter((g) => g.mark).length}, ` +
        `path chars ${sh.d.length}; clusters ${clusters.map((c) => `[${[...c.chars].map((ch) => ch.codePointAt(0)!.toString(16)).join('+')}]x${c.glyphs.length}`).join(' ')}`,
    );
    const hue = (i: number) => `hsl(${(i * 67) % 360} 70% 40%)`;
    rows.push(`<g transform="translate(40 ${y})">${clusters.map((c, i) => `<path fill="${hue(i)}" d="${c.d}"/>`).join('')}</g>`);
    y += 280;
  }
}
writeFileSync(join(OUT, 'shape.json'), JSON.stringify(result, null, 1));
writeFileSync(join(OUT, 'shape.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="${y}" style="background:#fff">${rows.join('')}</svg>`);
console.log('wrote out/shape.json, out/shape.svg (one colour per cluster)');
