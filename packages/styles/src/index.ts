import { StyleRecipe } from '@reel/core';
import bassPulse from '../bass-pulse/recipe.json' with { type: 'json' };
import kineticQuote from '../kinetic-quote/recipe.json' with { type: 'json' };
import neonPsychedelic from '../neon-psychedelic/recipe.json' with { type: 'json' };
import swissTitleReveal from '../swiss-title-reveal/recipe.json' with { type: 'json' };
import wordPerBeat from '../word-per-beat/recipe.json' with { type: 'json' };
import gridReflow from '../grid-reflow/recipe.json' with { type: 'json' };
import brutalist from '../brutalist/recipe.json' with { type: 'json' };
import extrude3d from '../extrude-3d/recipe.json' with { type: 'json' };
import zTunnel from '../z-tunnel/recipe.json' with { type: 'json' };
import isometricBlocks from '../isometric-blocks/recipe.json' with { type: 'json' };
import cardDeck3d from '../card-deck-3d/recipe.json' with { type: 'json' };
import typewriterTerminal from '../typewriter-terminal/recipe.json' with { type: 'json' };
import maskSlide from '../mask-slide/recipe.json' with { type: 'json' };
import splitFlap from '../split-flap/recipe.json' with { type: 'json' };
import scrambleDecode from '../scramble-decode/recipe.json' with { type: 'json' };
import glyphMorph from '../glyph-morph/recipe.json' with { type: 'json' };
import stickerPop from '../sticker-pop/recipe.json' with { type: 'json' };
import bento from '../bento/recipe.json' with { type: 'json' };
import shapeToType from '../shape-to-type/recipe.json' with { type: 'json' };
import liquidMorph from '../liquid-morph/recipe.json' with { type: 'json' };
import versusSplit from '../versus-split/recipe.json' with { type: 'json' };
import fluidScale from '../fluid-scale/recipe.json' with { type: 'json' };
import elasticStretch from '../elastic-stretch/recipe.json' with { type: 'json' };
import equalizerType from '../equalizer-type/recipe.json' with { type: 'json' };
import lyricKaraoke from '../lyric-karaoke/recipe.json' with { type: 'json' };

/**
 * Catalog of style recipes, validated at load. A style is only a recipe (`<id>/recipe.json`): one trait per axis
 * from `@reel/traits` plus param overrides; `resolveStyles` checks that the traits exist and fit together.
 */
export const RECIPES: Record<string, StyleRecipe> = {
  'kinetic-quote': StyleRecipe.parse(kineticQuote),
  'neon-psychedelic': StyleRecipe.parse(neonPsychedelic),
  'swiss-title-reveal': StyleRecipe.parse(swissTitleReveal),
  'bass-pulse': StyleRecipe.parse(bassPulse),
  'word-per-beat': StyleRecipe.parse(wordPerBeat),
  'grid-reflow': StyleRecipe.parse(gridReflow),
  brutalist: StyleRecipe.parse(brutalist),
  'extrude-3d': StyleRecipe.parse(extrude3d),
  'z-tunnel': StyleRecipe.parse(zTunnel),
  'isometric-blocks': StyleRecipe.parse(isometricBlocks),
  'card-deck-3d': StyleRecipe.parse(cardDeck3d),
  'typewriter-terminal': StyleRecipe.parse(typewriterTerminal),
  'mask-slide': StyleRecipe.parse(maskSlide),
  'split-flap': StyleRecipe.parse(splitFlap),
  'scramble-decode': StyleRecipe.parse(scrambleDecode),
  'glyph-morph': StyleRecipe.parse(glyphMorph),
  'sticker-pop': StyleRecipe.parse(stickerPop),
  bento: StyleRecipe.parse(bento),
  'shape-to-type': StyleRecipe.parse(shapeToType),
  'liquid-morph': StyleRecipe.parse(liquidMorph),
  'versus-split': StyleRecipe.parse(versusSplit),
  'fluid-scale': StyleRecipe.parse(fluidScale),
  'elastic-stretch': StyleRecipe.parse(elasticStretch),
  'equalizer-type': StyleRecipe.parse(equalizerType),
  'lyric-karaoke': StyleRecipe.parse(lyricKaraoke),
};

export function recipe(id: string): StyleRecipe {
  const r = RECIPES[id];
  if (!r) throw new Error(`unknown style "${id}" (known: ${Object.keys(RECIPES).join(', ')})`);
  return r;
}
