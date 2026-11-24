/**
 * Stand-in glyphs for reveals that flip, scramble or glitch graphemes (`reveal: flap`, `scramble`, `typewriter`):
 * a Hebrew grapheme is replaced by Hebrew letters, Latin by Latin of the same case, digits by digits, anything else
 * by symbols. Parts are whole graphemes, so a letter's niqqud never separates from it; the stand-in is a bare letter
 * and the real grapheme (with its marks) returns when the part settles. Pure lookups: the caller supplies the noise
 * (`hash` from `@reel/runtime`, page-only).
 */

export type Script = 'hebrew' | 'upper' | 'lower' | 'digit' | 'symbol';

const POOLS: Record<Script, readonly string[]> = {
  hebrew: [...'אבגדהוזחטיכלמנסעפצקרשת'],
  upper: [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'],
  lower: [...'abcdefghijklmnopqrstuvwxyz'],
  digit: [...'0123456789'],
  symbol: [...'#%&*+=<>/?!'],
};

/** Which pool stands in for grapheme `g` (its first code point decides). */
export function scriptOf(g: string): Script {
  if (/^[\u05D0-\u05EA\u05F0-\u05F2\uFB1D-\uFB4F]/u.test(g)) return 'hebrew';
  if (/^\p{Nd}/u.test(g)) return 'digit';
  if (/^\p{Lu}/u.test(g)) return 'upper';
  if (/^\p{L}/u.test(g)) return 'lower';
  return 'symbol';
}

/** The pool member at noise `r` ∈ [0, 1), skipping `avoid` (the real grapheme) so a stand-in never looks settled. */
export function standIn(script: Script, r: number, avoid = ''): string {
  const pool = POOLS[script];
  const i = Math.min(pool.length - 1, Math.floor(r * pool.length));
  const g = pool[i]!;
  return g === avoid ? pool[(i + 1) % pool.length]! : g;
}
