import { StyleRecipe } from '@reel/core';
import kineticQuote from '../kinetic-quote/recipe.json' with { type: 'json' };

/** Catalog of style recipes, validated at load. */
export const RECIPES: Record<string, StyleRecipe> = {
  'kinetic-quote': StyleRecipe.parse(kineticQuote),
};

export function recipe(id: string): StyleRecipe {
  const r = RECIPES[id];
  if (!r) throw new Error(`unknown style "${id}" (known: ${Object.keys(RECIPES).join(', ')})`);
  return r;
}

/** Folder of a style: `engine.ts` (page entry, bundled with esbuild) and `engine.css`. Node only. */
export function styleDir(id: string): string {
  recipe(id);
  return new URL(`../${id}/`, import.meta.url).pathname;
}
