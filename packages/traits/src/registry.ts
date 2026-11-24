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
import { meta as chatThread } from './traits/layout/chat-thread/meta.ts';
import { meta as chatScroll } from './traits/camera/chat-scroll/meta.ts';
import { meta as chatPop } from './traits/reveal/chat-pop/meta.ts';
import { meta as chatInk } from './traits/material/chat-ink/meta.ts';
import { meta as chatWallpaper } from './traits/background/chat-wallpaper/meta.ts';
import { meta as listStack } from './traits/layout/list-stack/meta.ts';
import { meta as stackPush } from './traits/reveal/stack-push/meta.ts';
import { meta as cutout } from './traits/material/cutout/meta.ts';
import { meta as ransom } from './traits/reveal/ransom/meta.ts';
import { meta as chalkboard } from './traits/background/chalkboard/meta.ts';
import { meta as chalk } from './traits/material/chalk/meta.ts';
import { meta as chalkWrite } from './traits/reveal/chalk-write/meta.ts';
import { meta as steam } from './traits/background/steam/meta.ts';
import { meta as foam } from './traits/material/foam/meta.ts';
import { meta as bubble } from './traits/material/bubble/meta.ts';
import { meta as weightWave } from './traits/axis/weight-wave/meta.ts';
import { meta as widthBreath } from './traits/axis/width-breath/meta.ts';
import { meta as particleAssemble } from './traits/reveal/particle-assemble/meta.ts';
import { meta as flowDrift } from './traits/reveal/flow-drift/meta.ts';
import { meta as flowField } from './traits/background/flow-field/meta.ts';
import { meta as glitch } from './traits/reveal/glitch/meta.ts';
import { meta as scrollStack } from './traits/layout/scroll-stack/meta.ts';
import { meta as rampScroll } from './traits/camera/ramp-scroll/meta.ts';
import { meta as punchIn } from './traits/reveal/punch-in/meta.ts';
import { meta as ribbonBand } from './traits/layout/ribbon-band/meta.ts';
import { meta as ribbonFlow } from './traits/reveal/ribbon-flow/meta.ts';
import { meta as creditsColumn } from './traits/layout/credits-column/meta.ts';
import { meta as creditsDolly } from './traits/camera/credits-dolly/meta.ts';
import { meta as creditHold } from './traits/reveal/credit-hold/meta.ts';
import { meta as tickerBoard } from './traits/layout/ticker-board/meta.ts';
import { meta as bandLock } from './traits/reveal/band-lock/meta.ts';
import { meta as nestFrames } from './traits/layout/nest-frames/meta.ts';
import { meta as drosteZoom } from './traits/camera/droste-zoom/meta.ts';
import { meta as nestShow } from './traits/reveal/nest-show/meta.ts';
import { meta as paperSheet } from './traits/layout/paper-sheet/meta.ts';
import { meta as unfold } from './traits/reveal/unfold/meta.ts';
import { meta as tileBoard } from './traits/layout/tile-board/meta.ts';
import { meta as tileRipple } from './traits/background/tile-ripple/meta.ts';
import { meta as tileFlip } from './traits/reveal/tile-flip/meta.ts';
import { meta as magazinePage } from './traits/layout/magazine-page/meta.ts';
import { meta as pageTurn } from './traits/transition/page-turn/meta.ts';
import { meta as orbitRing } from './traits/layout/orbit-ring/meta.ts';
import { meta as orbitSettle } from './traits/reveal/orbit-settle/meta.ts';
import { meta as mapRoute } from './traits/layout/map-route/meta.ts';
import { meta as mapDrop } from './traits/reveal/map-drop/meta.ts';
import { meta as cityMap } from './traits/background/city-map/meta.ts';

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
  chatThread,
  chatScroll,
  chatPop,
  chatInk,
  chatWallpaper,
  listStack,
  stackPush,
  cutout,
  ransom,
  chalkboard,
  chalk,
  chalkWrite,
  steam,
  foam,
  bubble,
  weightWave,
  widthBreath,
  particleAssemble,
  flowDrift,
  flowField,
  glitch,
  scrollStack,
  rampScroll,
  punchIn,
  ribbonBand,
  ribbonFlow,
  creditsColumn,
  creditsDolly,
  creditHold,
  tickerBoard,
  bandLock,
  nestFrames,
  drosteZoom,
  nestShow,
  paperSheet,
  unfold,
  tileBoard,
  tileRipple,
  tileFlip,
  magazinePage,
  pageTurn,
  orbitRing,
  orbitSettle,
  mapRoute,
  mapDrop,
  cityMap,
];
