import type { FontRef, ReelInput } from '@reel/core';

/**
 * Registers every font of `REEL.fonts` with `FontFace` (bundle-local URLs only) and waits until they are usable,
 * including by Canvas2D `measureText`. Identical refs are loaded once.
 */
export async function loadFonts(fonts: ReelInput['fonts']): Promise<void> {
  const unique = new Map<string, FontRef>();
  for (const f of Object.values(fonts)) unique.set(`${f.family}\0${f.url}`, f);
  await Promise.all(
    [...unique.values()].map(async (f) => {
      const face = new FontFace(f.family, `url("${f.url}")`, { weight: `${f.weights[0]} ${f.weights[1]}` });
      try {
        document.fonts.add(await face.load());
      } catch (e) {
        throw new Error(`font "${f.family}" failed to load from ${f.url}: ${(e as Error).message ?? e}`);
      }
    }),
  );
  await document.fonts.ready;
}

/** Loads and decodes images up front so no frame waits on (or skips) a decode. */
export async function decodeImages(urls: string[]): Promise<HTMLImageElement[]> {
  return Promise.all(
    urls.map(async (url) => {
      const img = new Image();
      img.decoding = 'sync';
      img.src = url;
      try {
        await img.decode();
      } catch {
        throw new Error(`image failed to decode: ${url}`);
      }
      return img;
    }),
  );
}
