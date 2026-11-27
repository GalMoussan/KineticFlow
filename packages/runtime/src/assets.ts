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

/**
 * Loads images up front. Pages draw clones of them with `decoding = 'sync'` (the attribute is cloned), so raster
 * decodes each image at the scale it is drawn and never skips it on the frame it first appears. Not `img.decode()`:
 * that decodes at full size into the compositor's image cache, and whether the entry is still cached when the image is
 * first drawn depends on timing. If it is, a downscaled draw samples the full-size decode; if not, the draw decodes at
 * its own mip level, and the pixels differ (orbit-ring's hub logos, frames 0–2, two fresh browsers under load: up to
 * 60/255).
 */
export function loadImages(urls: string[]): Promise<HTMLImageElement[]> {
  return Promise.all(
    urls.map((url) => {
      const { promise, resolve, reject } = Promise.withResolvers<HTMLImageElement>();
      const img = new Image();
      img.decoding = 'sync';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`image failed to load: ${url}`));
      img.src = url;
      return promise;
    }),
  );
}
