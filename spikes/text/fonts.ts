/**
 * Static wght=400 instances of the variable fonts, for troika (which ignores fvar/gvar and renders
 * the default instance: NotoSansHebrew wght 100, Rubik wght 300).
 * Run: node spikes/text/fonts.ts   (troika.ts calls ensureStaticFonts() itself)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const HERE = import.meta.dirname;
const SRC = join(HERE, '..', 'fonts');
export const STATIC_DIR = join(HERE, 'fonts');

export const STATIC_FONTS = [
  { file: 'NotoSansHebrew-400.ttf', from: 'NotoSansHebrew.ttf', axes: ['wght=400', 'wdth=100'] },
  { file: 'Rubik-400.ttf', from: 'Rubik.ttf', axes: ['wght=400'] },
];

export function ensureStaticFonts(): void {
  mkdirSync(STATIC_DIR, { recursive: true });
  for (const f of STATIC_FONTS) {
    const out = join(STATIC_DIR, f.file);
    if (existsSync(out)) continue;
    execFileSync('uvx', ['--from', 'fonttools', 'fonttools', 'varLib.instancer', join(SRC, f.from), ...f.axes, '--static', '-q', '-o', out], { stdio: 'inherit' });
  }
}

if (import.meta.main) {
  ensureStaticFonts();
  console.log(`static instances in ${STATIC_DIR}: ${STATIC_FONTS.map((f) => f.file).join(', ')}`);
}
