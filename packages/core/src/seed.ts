/**
 * Dependency-free (no zod) so page code can import it as `@reel/core/seed.ts` without pulling the schemas, and with
 * them zod's `new Function` probe that the page CSP blocks, into the bundle.
 */

/** 32-bit FNV-1a of a string (integer ops only, bit-exact everywhere): seeds per-sketch jitter, Node and page alike. */
export function seedOf(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}
