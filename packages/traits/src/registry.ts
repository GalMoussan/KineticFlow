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
import { meta as neonHits } from './traits/rhythm/hits/meta.ts';
import { meta as neonShake } from './traits/camera/shake/meta.ts';
import { meta as neonCenterStack } from './traits/layout/center-stack/meta.ts';
import { meta as neonMix } from './traits/reveal/neon-mix/meta.ts';
import { meta as neonPunchy } from './traits/motion/punchy/meta.ts';
import { meta as neonGlow } from './traits/material/neon-glow/meta.ts';
import { meta as neonStarfield } from './traits/background/starfield/meta.ts';
import { meta as neonFlashCut } from './traits/transition/flash-cut/meta.ts';
import { meta as swissBeatPulse } from './traits/rhythm/beat-pulse/meta.ts';
import { meta as swissStatic } from './traits/camera/static/meta.ts';
import { meta as swissPoster } from './traits/layout/bauhaus-poster/meta.ts';
import { meta as swissMix } from './traits/reveal/swiss-mix/meta.ts';
import { meta as swissSnappy } from './traits/motion/snappy/meta.ts';
import { meta as swissOutlineFill } from './traits/material/outline-fill/meta.ts';
import { meta as swissSolidBauhaus } from './traits/background/solid-bauhaus/meta.ts';
import { meta as swissPanelWipe } from './traits/transition/panel-wipe/meta.ts';
import { meta as audioReactive } from './traits/rhythm/audio-reactive/meta.ts';
import { meta as pulseGlow } from './traits/background/pulse-glow/meta.ts';

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
  neonHits,
  neonShake,
  neonCenterStack,
  neonMix,
  neonPunchy,
  neonGlow,
  neonStarfield,
  neonFlashCut,
  swissBeatPulse,
  swissStatic,
  swissPoster,
  swissMix,
  swissSnappy,
  swissOutlineFill,
  swissSolidBauhaus,
  swissPanelWipe,
  audioReactive,
  pulseGlow,
];
