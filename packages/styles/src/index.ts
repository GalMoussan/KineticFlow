import { StyleRecipe } from '@reel/core';
import bassPulse from '../bass-pulse/recipe.json' with { type: 'json' };
import kineticQuote from '../kinetic-quote/recipe.json' with { type: 'json' };
import neonPsychedelic from '../neon-psychedelic/recipe.json' with { type: 'json' };
import swissTitleReveal from '../swiss-title-reveal/recipe.json' with { type: 'json' };

/**
 * Catalog of style recipes, validated at load. A style is only a recipe (`<id>/recipe.json`): one trait per axis
 * from `@reel/traits` plus param overrides; `resolveStyles` checks that the traits exist and fit together.
 */
export const RECIPES: Record<string, StyleRecipe> = {
  'kinetic-quote': StyleRecipe.parse(kineticQuote),
  'neon-psychedelic': StyleRecipe.parse(neonPsychedelic),
  'swiss-title-reveal': StyleRecipe.parse(swissTitleReveal),
  'bass-pulse': StyleRecipe.parse(bassPulse),
};

export function recipe(id: string): StyleRecipe {
  const r = RECIPES[id];
  if (!r) throw new Error(`unknown style "${id}" (known: ${Object.keys(RECIPES).join(', ')})`);
  return r;
}
