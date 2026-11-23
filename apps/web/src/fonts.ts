/** Registers catalog/uploaded fonts with `FontFace` so pickers and samples render in the real typeface. */
import type { CatalogFont } from '@reel/api';

const loaded = new Map<string, Promise<void>>();

/** CSS family name used by the UI for a font id (separate from the page's own registration). */
export function uiFamily(id: string): string {
  return `reel-ui-${id}`;
}

export function loadFont(font: CatalogFont): Promise<void> {
  let p = loaded.get(font.id);
  if (!p) {
    const face = new FontFace(uiFamily(font.id), `url(${JSON.stringify(font.url)})`, { weight: `${font.weights[0]} ${font.weights[1]}` });
    p = face.load().then(
      (f) => void document.fonts.add(f),
      () => undefined,
    );
    loaded.set(font.id, p);
  }
  return p;
}
