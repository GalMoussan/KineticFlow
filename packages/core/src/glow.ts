/**
 * Which materials glow their text, and how strongly (SKETCH-PLAN.md P2, material carry-over). Shared by the page's
 * sketch overlays (`@reel/traits` host, which may not import the core index: zod) and the studio's Mixer, so a sketch
 * glows exactly where and as much as the text of its section does. Zod-free on purpose.
 */

export type GlowKind = 'neon' | 'spectrum' | 'tint' | 'chalk' | 'chrome';

/** Materials whose text glows, and which of their text-glow formulas a sketch's strokes take. */
export const GLOW_MATERIALS: Readonly<Record<string, GlowKind>> = {
  'neon-glow': 'neon',
  spectrum: 'spectrum',
  'glow-tint': 'tint',
  chalk: 'chalk',
  chrome: 'chrome',
};

/**
 * The text glow of a resolved style: its material's glow kind and strength param (`material.glow`, chalk's
 * `material.halo`), or `null` when its text does not glow (another material, or the param at 0).
 */
export function materialGlow(material: string, params: Readonly<Record<string, number>>): { kind: GlowKind; p: number } | null {
  const kind = GLOW_MATERIALS[material];
  if (!kind) return null;
  const p = params[`material.${kind === 'chalk' ? 'halo' : 'glow'}`] ?? 0;
  return p > 0 ? { kind, p } : null;
}

/**
 * The strokes' glow strength: `look.glow` (the share of the text glow, 1 in every catalog style) × the text's own
 * strength. With `look.glow = 1` it equals the text glow in every blend, Fine-tune and material override.
 */
export function sketchGlow(material: string, params: Readonly<Record<string, number>>, share: number): { kind: GlowKind; p: number; k: number } | null {
  const g = materialGlow(material, params);
  return g && share > 0 ? { ...g, k: share } : null;
}
