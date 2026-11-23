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
};

export function fontEntry(id: string): FontEntry {
  const f = FONTS[id];
  if (!f) throw new Error(`unknown font "${id}" (known: ${Object.keys(FONTS).join(', ')})`);
  return f;
}
