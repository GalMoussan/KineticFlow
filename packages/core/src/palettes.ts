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
  // word-per-beat: one saturated accent per beat on near-black, inked black or white
  'beat-pop': { bg: '#0E0E10', text: '#FFFFFF', accents: ['#FF2D55', '#FFD60A', '#0A84FF', '#30D158', '#FF9F0A', '#BF5AF2'] },
  // brutalist: newsprint grey-white, black, one signal red, a graphite grey
  concrete: { bg: '#ECEAE4', text: '#0B0B0B', accents: ['#E62E00', '#0B0B0B', '#77736B'] },
  // sticker-pop: candy stickers with white die-cut rims on electric violet
  'sticker-candy': { bg: '#3B1FD1', text: '#FFFFFF', accents: ['#FFE14D', '#FF5FA2', '#3DF5C8', '#FF8A3D'] },
  // equalizer-type: a low → high spectrum on black
  spectrum: { bg: '#07090F', text: '#F2F5FF', accents: ['#FF3B6B', '#FF9F1C', '#C6F432', '#22D3EE', '#8B7BFF'] },
  // lyric-karaoke: calm dusk indigo, cream lyrics, a warm gold sweep
  'karaoke-dusk': { bg: '#1D1B3A', text: '#F4EFE6', accents: ['#FFC857', '#7FD1C7', '#F28482', '#B8B0F5'] },
  // grid-reflow: Swiss modernist paper white, black, signal red, ultramarine
  'swiss-modern': { bg: '#F3F1EC', text: '#111111', accents: ['#E3001B', '#1D4ED8', '#111111'] },
  // bento: warm light-grey tray, tiles in tomato, cobalt, green, violet (white or black ink on top)
  'bento-pop': { bg: '#EDEAE4', text: '#161616', accents: ['#E0452B', '#2D55D6', '#1E7A57', '#7446D0'] },
  // versus-split: red corner vs blue corner on black, a yellow badge
  'versus-duel': { bg: '#121016', text: '#FFFFFF', accents: ['#E5262C', '#2563EB', '#FFD000'] },
  // fluid-scale: warm white type on ink, orange / sky / sun highlights
  'fluid-ink': { bg: '#14161C', text: '#F4F1EA', accents: ['#FF6A3D', '#8FD3FF', '#F7D046'] },
  // elastic-stretch: soft peach with plum ink, jelly pink / teal / violet / caramel
  'soft-jelly': { bg: '#FFEDE4', text: '#3A2459', accents: ['#E2457A', '#22857E', '#6D4CE0', '#C9661B'] },
  // typewriter-terminal: phosphor green on a black-green CRT, amber numbers, cyan secondary
  'terminal-green': { bg: '#07100B', text: '#C9F7D3', accents: ['#3DFF7A', '#FFB22E', '#5CE1E6'] },
  // mask-slide: editorial off-white page, ink black, one vermilion accent, deep blue figures
  'editorial-light': { bg: '#F6F3EE', text: '#141414', accents: ['#D7381E', '#1F3A93', '#9E2A1A'] },
  // split-flap: departure board, warm white flaps, yellow / amber / sky letters
  'departure-board': { bg: '#0F1114', text: '#F3F0E6', accents: ['#FFD23F', '#FF9F1C', '#5BC0EB'] },
  // scramble-decode: deep navy screen, ice-white text, mint decode head, electric-blue scramble, pink
  'decode-cyan': { bg: '#060E16', text: '#E8FBFF', accents: ['#21F0B6', '#2C9BFF', '#FF4F8B'] },
  // extrude-3d: cream type extruded in hot pink on deep violet, sun yellow / cyan / lilac accents
  'bold-pop': { bg: '#1B1035', text: '#FFF3E2', accents: ['#FF3D7F', '#FFC53D', '#3DDCFF', '#9D7BFF'] },
  // isometric-blocks: pale sky floor, slate ink, blocks in brick / teal / cobalt / violet / ochre
  'iso-pastel': { bg: '#E4ECF2', text: '#1E2A3A', accents: ['#D9480F', '#0F766E', '#3B5BA9', '#6D28D9', '#A16207'] },
  // card-deck-3d: card stock with navy ink (the table is the ink mixed into it), red / teal / plum / rust pips
  'card-table': { bg: '#FBF6EC', text: '#1D2541', accents: ['#C8102E', '#1B7F79', '#2E294E', '#C2410C'] },
  // z-tunnel: near-black blue-violet depth, ice-white words, cyan / magenta / amber / lilac neon frames
  'tunnel-night': { bg: '#06061A', text: '#F4F7FF', accents: ['#2EE6FF', '#FF3DA5', '#FFB020', '#9D8CFF'] },
  // glyph-morph: midnight ink, warm paper-white letters, gold / coral / teal / lilac / rose echoes
  'midnight-ink': { bg: '#0F1020', text: '#F3ECDD', accents: ['#F2B84B', '#FF7A6B', '#5DCBC4', '#A99BFF', '#F497B8'] },
  // liquid-morph: lavender milk, plum ink, raspberry / lagoon / violet / apricot / orchid liquids
  'liquid-pastel': { bg: '#F7F0FB', text: '#2A1A47', accents: ['#D9407A', '#1C8FA3', '#7650E8', '#D86A2E', '#A63D8C'] },
  // minimal-luxe: ink on bone, antique gold hairlines and emphasis, warm taupe figures
  'luxe-bone': { bg: '#F2EDE4', text: '#1D1B18', accents: ['#8C6B2E', '#5E554A', '#A27C38'] },
  // functional-clean: near-black ink on cool paper (16:1), deep blue / teal / rust accents all ≥ 7:1
  'clear-contrast': { bg: '#EDF1F6', text: '#0A1222', accents: ['#0A3FA8', '#005A4E', '#8A2600'] },
  // stat-counter: dashboard night, mint / amber / sky / coral data inks
  'data-night': { bg: '#0D1220', text: '#EEF3FF', accents: ['#3DDC97', '#FFB547', '#5AA9FF', '#FF6F7D'] },
  // list-stack: warm black, paper-white items, vermilion / sun / teal / violet numerals
  'stack-ink': { bg: '#111014', text: '#F7F3EA', accents: ['#FF5A36', '#FFC23D', '#2EC4B6', '#8E7CFF'] },
  // chrome-liquid: studio night, steel-white chrome, icy cyan / lavender / pink tints, silver
  'chrome-night': { bg: '#0A0F1C', text: '#E8EEF7', accents: ['#6FD3FF', '#B79CFF', '#FF7EC8', '#C9D3E0'] },
  // risograph: off-white stock, riso blue ink, fluorescent pink / blue / yellow / green spot inks
  'riso-fluoro': { bg: '#F3EEE3', text: '#1D3BA8', accents: ['#FF3E9A', '#0078BF', '#FFC800', '#00A35C'] },
  // chalkboard-cafe: green slate, white chalk, yellow / teal / pink chalk, wood frame (accent 3)
  'chalk-cafe': { bg: '#24302A', text: '#F2F0E6', accents: ['#F6D776', '#9FD8CB', '#F2A7B8', '#8B5A34'] },
  // cutout-collage: kraft board, black ink; red / yellow / blue / newsprint / black / pink paper scraps
  'kraft-collage': { bg: '#CDB48C', text: '#141414', accents: ['#E2402B', '#F3C33C', '#2E5BA6', '#F4EFE4', '#151515', '#EE8FAE'] },
  // coffee-steam: latte, espresso ink, roast / caramel accents, milk foam (accent 2), crema, cocoa
  'latte-foam': { bg: '#E8D6C1', text: '#3A261B', accents: ['#8A4B2D', '#9C6239', '#FFF6EA', '#C99466', '#5B3A28'] },
  // retro-80s: outrun night, hot pink / sun amber / laser cyan / violet grid
  'synth-sunset': { bg: '#14002E', text: '#FFFFFF', accents: ['#FF2E88', '#FFB000', '#00E5FF', '#8F3BFF'] },
  // y2k-bubble: lilac haze, grape ink, bubblegum / aqua / violet / mint / tangerine candy
  'y2k-lilac': { bg: '#E9DDFF', text: '#2B1B5C', accents: ['#FF4FB8', '#1FB8E8', '#9B5CFF', '#2FD39A', '#FFB53D'] },
  // countdown: launch-control black, bone-white type, amber hero / ring head, launch-orange numbers and ring, ice / yellow emphasis
  'launch-control': { bg: '#0A0B10', text: '#F3F0E8', accents: ['#FFB21E', '#FF5A1F', '#7FD8FF', '#FFE066'] },
  // dilemma-reveal: plum ink under a spotlight, cream type, one hot coral accent (seals, answer card), lilac numbers
  'dilemma-plum': { bg: '#170B1F', text: '#F6EEE6', accents: ['#FF3D6E', '#C9B6F2', '#FF3D6E'] },
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
