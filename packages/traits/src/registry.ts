/**
 * Every trait's metadata (Node-safe). Add one import per new trait; `npm test` checks that each folder under
 * `traits/` is registered and that its `impl.ts` carries the same meta.
 */
import type { TraitMeta } from '@reel/core';
import { meta as landKick } from './traits/rhythm/land-kick/meta.ts';
import { meta as panTurn } from './traits/camera/pan-turn/meta.ts';
import { meta as worldBlocks } from './traits/layout/world-blocks/meta.ts';
import { meta as word } from './traits/unit/word/meta.ts';
import { meta as grapheme } from './traits/unit/grapheme/meta.ts';
import { meta as kineticMix } from './traits/reveal/kinetic-mix/meta.ts';
import { meta as smooth } from './traits/motion/smooth/meta.ts';
import { meta as overshoot } from './traits/motion/overshoot/meta.ts';
import { meta as axisNone } from './traits/axis/none/meta.ts';
import { meta as flat } from './traits/material/flat/meta.ts';
import { meta as paperGrid } from './traits/background/paper-grid/meta.ts';
import { meta as cameraMove } from './traits/transition/camera-move/meta.ts';
import { meta as cut } from './traits/transition/cut/meta.ts';

export const TRAIT_META: readonly TraitMeta[] = [
  landKick,
  panTurn,
  worldBlocks,
  word,
  grapheme,
  kineticMix,
  smooth,
  overshoot,
  axisNone,
  flat,
  paperGrid,
  cameraMove,
  cut,
];
