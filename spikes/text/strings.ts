/** M0c test strings. `*word*` marks emphasis; it is stripped before splitting (see units.ts `parseEmphasis`). */

export interface TestLine {
  id: string;
  /** What the line stresses. */
  what: string;
  /** Source text, possibly with `*emphasis*` markers. Escapes keep mark order explicit. */
  source: string;
}

export const LINES: TestLine[] = [
  {
    id: 'niqqud',
    what: 'niqqud; shin + shin dot + qamats on one letter (typed order: dot before vowel)',
    // שָׁלוֹם עוֹלָם
    source: '\u05E9\u05C1\u05B8\u05DC\u05D5\u05B9\u05DD \u05E2\u05D5\u05B9\u05DC\u05B8\u05DD',
  },
  {
    id: 'niqqud2',
    what: 'stacked marks: dagesh + sheva, shin dot + hiriq, sin dot + patah',
    // בְּרֵאשִׁית שַׂר
    source: '\u05D1\u05BC\u05B0\u05E8\u05B5\u05D0\u05E9\u05C1\u05B4\u05D9\u05EA \u05E9\u05C2\u05B7\u05E8',
  },
  { id: 'geresh', what: 'geresh U+05F3', source: 'קפה דילמה וג\u05F3אם' },
  { id: 'finals', what: 'final letters ם ן ך ף ץ ending words inside the line', source: 'סוף הקיץ בדרך לגן החלום' },
  { id: 'mixed', what: 'Hebrew + Latin + time + date (bidi)', source: 'בית החאן · Beit HaChan · 19:30 · 01.12.2026' },
  { id: 'mirror', what: 'bracket mirroring', source: '(שאלה?) [A/B]' },
  { id: 'english', what: 'English line with emphasis + apostrophe', source: "Let's *talk* tonight" },
  { id: 'nested', what: 'LTR paragraph containing Hebrew + number (levels 0/1/2)', source: 'Meet at בית החאן 19:30 tonight' },
  { id: 'numparen', what: 'RTL with number inside parentheses + currency', source: 'השעה (19:30) והמחיר 45₪' },
  { id: 'emphasis', what: 'Hebrew with emphasis marker', source: 'הערב *נדבר* על זה' },
];

export const FONTS = {
  rubik: { family: 'Rubik', file: 'Rubik.ttf' },
  noto: { family: 'Noto Sans Hebrew', file: 'NotoSansHebrew.ttf' },
  frank: { family: 'Frank Ruhl Libre', file: 'FrankRuhlLibre.ttf' },
} as const;
export type FontKey = keyof typeof FONTS;
export const FONT_KEYS = Object.keys(FONTS) as FontKey[];

export const FONT_SIZE = 96;
