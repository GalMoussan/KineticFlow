/**
 * Curated font catalog (OFL, from the google/fonts repository). `reelgen setup fonts` downloads each file into
 * `assets/fonts/<file>` and verifies the SHA-256; pages load them as local files only.
 */
export interface FontEntry {
  family: string;
  file: string;
  url: string;
  sha256: string;
  /** Variable `wght` range (or [w, w] for static files). */
  weights: [number, number];
  scripts: ('hebrew' | 'latin')[];
}

const GF = 'https://github.com/google/fonts/raw/main/ofl';

export const FONTS: Record<string, FontEntry> = {
  rubik: {
    family: 'Rubik',
    file: 'Rubik[wght].ttf',
    url: `${GF}/rubik/Rubik%5Bwght%5D.ttf`,
    sha256: '1b3a7437ba2af80e465e773ed60c5036d1ba6ace492d89046dbcf18fb31e4e88',
    weights: [300, 900],
    scripts: ['hebrew', 'latin'],
  },
  'noto-sans-hebrew': {
    family: 'Noto Sans Hebrew',
    file: 'NotoSansHebrew[wdth,wght].ttf',
    url: `${GF}/notosanshebrew/NotoSansHebrew%5Bwdth%2Cwght%5D.ttf`,
    sha256: '7ef36a2c3593758cdb622e1bdef4f84523e92fbc3ccc667438dd80ff54c2de88',
    weights: [100, 900],
    scripts: ['hebrew', 'latin'],
  },
  'frank-ruhl-libre': {
    family: 'Frank Ruhl Libre',
    file: 'FrankRuhlLibre[wght].ttf',
    url: `${GF}/frankruhllibre/FrankRuhlLibre%5Bwght%5D.ttf`,
    sha256: 'f9bf26966681037aae894b031bd0dcf2c1bfdfa128dd0640cf276fe62a338a43',
    weights: [300, 900],
    scripts: ['hebrew', 'latin'],
  },
  // M6 display faces; all cover Hebrew + niqqud + Latin (checked with readFont/missingChars).
  heebo: {
    family: 'Heebo',
    file: 'Heebo[wght].ttf',
    url: `${GF}/heebo/Heebo%5Bwght%5D.ttf`,
    sha256: '18f930b583fa8fe6b40b2f8263b7ac6afbac07adc91a12467874e7467d3ace30',
    weights: [100, 900],
    scripts: ['hebrew', 'latin'],
  },
  fredoka: {
    family: 'Fredoka',
    file: 'Fredoka[wdth,wght].ttf',
    url: `${GF}/fredoka/Fredoka%5Bwdth%2Cwght%5D.ttf`,
    sha256: '2ba02e68b152868aef9ba28e24b3648c7d457fe6f25c761f2c2c53fb61a73fc8',
    weights: [300, 700],
    scripts: ['hebrew', 'latin'],
  },
  karantina: {
    family: 'Karantina',
    file: 'Karantina-Bold.ttf',
    url: `${GF}/karantina/Karantina-Bold.ttf`,
    sha256: 'fc099ee72a843fb5b4d574abd099e047eec4cf476a1a2c65fe520e1cdcc897be',
    weights: [700, 700],
    scripts: ['hebrew', 'latin'],
  },
  cousine: {
    family: 'Cousine',
    file: 'Cousine-Bold.ttf',
    url: `${GF}/cousine/Cousine-Bold.ttf`,
    sha256: '17c8a7245156d2253531c9e529474937b09d9f641c5ae7695c5e33f22822eef4',
    weights: [700, 700],
    scripts: ['hebrew', 'latin'],
  },
  'secular-one': {
    family: 'Secular One',
    file: 'SecularOne-Regular.ttf',
    url: `${GF}/secularone/SecularOne-Regular.ttf`,
    sha256: '2f45092a521db5042887941edfef73178ed7c5ba7fdfc5b6f581d44aab7b0234',
    weights: [400, 400],
    scripts: ['hebrew', 'latin'],
  },
  'suez-one': {
    family: 'Suez One',
    file: 'SuezOne-Regular.ttf',
    url: `${GF}/suezone/SuezOne-Regular.ttf`,
    sha256: '3ef86844aad0cf9db7dcbda326f3d2f54cc4ccfe56db949e9e0c60a17031bd41',
    weights: [400, 400],
    scripts: ['hebrew', 'latin'],
  },
  'amatic-sc': {
    family: 'Amatic SC',
    file: 'AmaticSC-Bold.ttf',
    url: `${GF}/amaticsc/AmaticSC-Bold.ttf`,
    sha256: 'd367beadee66efbb657d24d3d8f30f3b60633e9d5c8ded7385541cf775cabb4d',
    weights: [700, 700],
    scripts: ['hebrew', 'latin'],
  },
};

export function fontEntry(id: string): FontEntry {
  const f = FONTS[id];
  if (!f) throw new Error(`unknown font "${id}" (known: ${Object.keys(FONTS).join(', ')})`);
  return f;
}

/** Whether `id` names a catalog font; any other font id in a spec is an uploaded font asset. */
export function isCatalogFont(id: string): boolean {
  return Object.hasOwn(FONTS, id);
}

/** File types an uploaded font can have, in lookup order (`<specDir>/assets/<id>.<ext>`). */
export const FONT_EXTS = ['ttf', 'otf', 'woff2'] as const;
