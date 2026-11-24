import { defineMeta } from '../../../contract.ts';

/**
 * Outrun sunset: a sky gradient over a striped sun whose bands scroll down, a perspective laser grid floor racing
 * towards the viewer (lines spaced by 1/z, speed locked to the beat), and a VHS overlay in front: scanlines, a
 * drifting tracking band with noise streaks, a vignette and a PLAY / timecode OSD in the top corner. Around each scene
 * change the picture jitters sideways by whole pixels (tracking slip) while the band tears across it. Plain DOM and
 * SVG, rewritten every frame from t.
 */
export const meta = defineMeta({
  id: 'synth-grid',
  axis: 'background',
  layer: 'dom',
  label: 'Synthwave grid + VHS',
  params: {
    horizon: { min: 0.45, max: 0.85, default: 0.64, label: 'Horizon height (× frame height from the top)' },
    speed: { min: 0, max: 2, default: 1, label: 'Grid rows passing per beat' },
    sun: { min: 0, max: 0.5, default: 0.3, label: 'Sun radius (× short frame side, 0 = none)' },
    vhs: { min: 0, max: 1, default: 0.6, label: 'VHS overlay strength (0 = off)' },
    jitter: { min: 0, max: 12, default: 6, label: 'Tracking jitter at scene changes (px)' },
  },
});
