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
import { meta as snap } from './traits/motion/snap/meta.ts';
import { meta as plainBg } from './traits/background/plain/meta.ts';
import { meta as beatStack } from './traits/layout/beat-stack/meta.ts';
import { meta as beatCut } from './traits/reveal/beat-cut/meta.ts';
import { meta as beatSwap } from './traits/material/beat-swap/meta.ts';
import { meta as gridReflow } from './traits/layout/grid-reflow/meta.ts';
import { meta as moduleGrid } from './traits/background/module-grid/meta.ts';
import { meta as tileInk } from './traits/material/tile-ink/meta.ts';
import { meta as reflow } from './traits/transition/reflow/meta.ts';
import { meta as flushStack } from './traits/layout/flush-stack/meta.ts';
import { meta as typewriter } from './traits/reveal/typewriter/meta.ts';
import { meta as maskSlide } from './traits/reveal/mask-slide/meta.ts';
import { meta as flap } from './traits/reveal/flap/meta.ts';
import { meta as scramble } from './traits/reveal/scramble/meta.ts';
import { meta as functional } from './traits/motion/functional/meta.ts';
import { meta as glowTint } from './traits/material/glow-tint/meta.ts';
import { meta as screen } from './traits/background/screen/meta.ts';
import { meta as spatialHandoff } from './traits/transition/handoff/meta.ts';
import { meta as spatialBackdrop } from './traits/background/backdrop/meta.ts';
import { meta as spatialOrbit } from './traits/camera/orbit/meta.ts';
import { meta as spatialExtrude } from './traits/material/extrude/meta.ts';
import { meta as spatialTiltUp } from './traits/reveal/tilt-up/meta.ts';
import { meta as spatialFlyThrough } from './traits/camera/fly-through/meta.ts';
import { meta as spatialZArrive } from './traits/reveal/z-arrive/meta.ts';
import { meta as spatialTunnel } from './traits/background/tunnel/meta.ts';
import { meta as spatialTurntable } from './traits/camera/turntable/meta.ts';
import { meta as spatialIsoBlocks } from './traits/layout/iso-blocks/meta.ts';
import { meta as spatialFaceInk } from './traits/material/face-ink/meta.ts';
import { meta as spatialCardDeck } from './traits/layout/card-deck/meta.ts';
import { meta as brutalGrid } from './traits/layout/brutal-grid/meta.ts';
import { meta as brutalSnap } from './traits/reveal/brutal-snap/meta.ts';
import { meta as brutalInk } from './traits/material/brutal-ink/meta.ts';
import { meta as glyphMorph } from './traits/reveal/glyph-morph/meta.ts';
import { meta as liquidBlobs } from './traits/background/liquid-blobs/meta.ts';
import { meta as fitStack } from './traits/layout/fit-stack/meta.ts';
import { meta as sticker } from './traits/material/sticker/meta.ts';
import { meta as stickerSlap } from './traits/reveal/sticker-slap/meta.ts';
import { meta as bento } from './traits/layout/bento/meta.ts';
import { meta as softRise } from './traits/reveal/soft-rise/meta.ts';
import { meta as shapeMorph } from './traits/reveal/shape-morph/meta.ts';
import { meta as shapeField } from './traits/background/shape-field/meta.ts';
import { meta as liquidMorph } from './traits/reveal/liquid-morph/meta.ts';
import { meta as versusSplit } from './traits/layout/versus-split/meta.ts';
import { meta as fluidFill } from './traits/layout/fluid-fill/meta.ts';
import { meta as elastic } from './traits/reveal/elastic/meta.ts';
import { meta as jellyBlobs } from './traits/background/jelly-blobs/meta.ts';
import { meta as equalizer } from './traits/rhythm/equalizer/meta.ts';
import { meta as barRise } from './traits/reveal/bar-rise/meta.ts';
import { meta as spectrum } from './traits/material/spectrum/meta.ts';
import { meta as karaokeSweep } from './traits/reveal/karaoke-sweep/meta.ts';
import { meta as karaokeInk } from './traits/material/karaoke-ink/meta.ts';
import { meta as fadePush } from './traits/transition/fade-push/meta.ts';
import { meta as luxeFrame } from './traits/layout/luxe-frame/meta.ts';
import { meta as trackIn } from './traits/reveal/track-in/meta.ts';
import { meta as infoCard } from './traits/layout/info-card/meta.ts';
import { meta as statBoard } from './traits/layout/stat-board/meta.ts';
import { meta as tally } from './traits/reveal/tally/meta.ts';
import { meta as chrome } from './traits/material/chrome/meta.ts';
import { meta as liquidChrome } from './traits/background/liquid-chrome/meta.ts';
import { meta as synthGrid } from './traits/background/synth-grid/meta.ts';
import { meta as paperPrint } from './traits/background/paper-print/meta.ts';
import { meta as riso } from './traits/material/riso/meta.ts';
import { meta as countBoard } from './traits/layout/count-board/meta.ts';
import { meta as countSlam } from './traits/reveal/count-slam/meta.ts';
import { meta as timerRing } from './traits/background/timer-ring/meta.ts';
import { meta as dilemmaCards } from './traits/layout/dilemma-cards/meta.ts';
import { meta as dilemmaMix } from './traits/reveal/dilemma-mix/meta.ts';
import { meta as slowPush } from './traits/camera/slow-push/meta.ts';
import { meta as heartbeat } from './traits/rhythm/heartbeat/meta.ts';

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
  snap,
  plainBg,
  beatStack,
  beatCut,
  beatSwap,
  gridReflow,
  moduleGrid,
  tileInk,
  reflow,
  flushStack,
  typewriter,
  maskSlide,
  flap,
  scramble,
  functional,
  glowTint,
  screen,
  spatialHandoff,
  spatialBackdrop,
  spatialOrbit,
  spatialExtrude,
  spatialTiltUp,
  spatialFlyThrough,
  spatialZArrive,
  spatialTunnel,
  spatialTurntable,
  spatialIsoBlocks,
  spatialFaceInk,
  spatialCardDeck,
  brutalGrid,
  brutalSnap,
  brutalInk,
  glyphMorph,
  liquidBlobs,
  fitStack,
  sticker,
  stickerSlap,
  bento,
  softRise,
  shapeMorph,
  shapeField,
  liquidMorph,
  versusSplit,
  fluidFill,
  elastic,
  jellyBlobs,
  equalizer,
  barRise,
  spectrum,
  karaokeSweep,
  karaokeInk,
  fadePush,
  luxeFrame,
  trackIn,
  infoCard,
  statBoard,
  tally,
  chrome,
  liquidChrome,
  synthGrid,
  paperPrint,
  riso,
  countBoard,
  countSlam,
  timerRing,
  dilemmaCards,
  dilemmaMix,
  slowPush,
  heartbeat,
];
