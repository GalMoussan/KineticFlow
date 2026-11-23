/** Node loader for harfbuzzjs (wasm) + the spike fonts. */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFont, type Hb, type LoadedFont } from './hb.ts';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const SPIKES = join(HERE, '..');
export const OUT = join(HERE, 'out');
const require = createRequire(import.meta.url);

export async function loadHb(): Promise<Hb> {
  return (await require('harfbuzzjs')) as Hb;
}

export function fontBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(SPIKES, 'fonts', name + '.ttf')));
}

export async function loadFonts(): Promise<{ hb: Hb; noto: LoadedFont; rubik: LoadedFont }> {
  const hb = await loadHb();
  return { hb, noto: loadFont(hb, fontBytes('NotoSansHebrew')), rubik: loadFont(hb, fontBytes('Rubik')) };
}
