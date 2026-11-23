import type { ResolvedPalette } from './page.ts';

/**
 * Catalog palettes (PLAN.md §12.2 of the source spec). `accents` order is meaningful: styles address accents by
 * index (0 = primary emphasis, 1 = secondary, …) and wrap around when a palette has fewer.
 */
export const PALETTES: Record<string, ResolvedPalette> = {
  'flamingo-cafe': {
    bg: '#F5EBDD',
    text: '#1B2A4A',
    // pink, teal, peach, sage, deep peach
    accents: ['#F2849E', '#2A8C8C', '#F4A37C', '#A3B18A', '#E8794A'],
  },
  'neon-night': {
    bg: '#0B0620',
    text: '#FFFFFF',
    accents: ['#E5007E', '#43B9B3', '#FCC000', '#F07D00', '#B04FE0', '#9DC31A', '#67C5E4'],
  },
  'mono-print': { bg: '#FFFFFF', text: '#111111', accents: ['#111111', '#D9D9D9'] },
  'ink-paper': { bg: '#F4F0E8', text: '#1A1A1A', accents: ['#C8102E'] },
  'high-contrast-duo': { bg: '#0D0D0D', text: '#FFE600', accents: ['#FFE600'] },
  latte: { bg: '#F3E9DC', text: '#3B2A20', accents: ['#8C5A3C', '#C8A27C'] },
  chalkboard: { bg: '#2B2F2A', text: '#F2F2F2', accents: ['#F7D774', '#9BD1C8'] },
  outrun: { bg: '#12002B', text: '#FFFFFF', accents: ['#FF2E88', '#FFB000', '#00E5FF'] },
  'y2k-candy': { bg: '#FFFFFF', text: '#B9A7FF', accents: ['#FF8AD8', '#8AE8FF', '#FFF07A', '#B9A7FF'] },
  'bauhaus-primary': { bg: '#F5F1E6', text: '#1F1F1F', accents: ['#E53935', '#1E5EFF', '#FFC400'] },
};

export type PaletteRef = string | ResolvedPalette;

export function resolvePalette(ref: PaletteRef): ResolvedPalette {
  if (typeof ref !== 'string') return ref;
  const p = PALETTES[ref];
  if (!p) throw new Error(`unknown palette "${ref}" (known: ${Object.keys(PALETTES).join(', ')})`);
  return p;
}

/** WCAG 2 contrast ratio between two `#RRGGBB` colours. */
export function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}
