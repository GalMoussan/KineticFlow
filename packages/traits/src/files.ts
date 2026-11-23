/** Node-only: where a trait's implementation and stylesheet live, for the bundler. */
import { access } from 'node:fs/promises';
import { join } from 'node:path';

/** `packages/traits/src/` (the esbuild resolve dir of generated page entries). */
export const TRAITS_SRC = new URL('.', import.meta.url).pathname;
/** Stylesheet of the generic page host. */
export const HOST_CSS = join(TRAITS_SRC, 'host/host.css');

/** `impl.ts` (default export) and the optional `style.css` of a trait. */
export async function traitFiles(axis: string, id: string): Promise<{ impl: string; css: string | null }> {
  const dir = join(TRAITS_SRC, 'traits', axis, id);
  const impl = join(dir, 'impl.ts');
  await access(impl);
  const css = join(dir, 'style.css');
  return { impl, css: await access(css).then(() => css, () => null) };
}
