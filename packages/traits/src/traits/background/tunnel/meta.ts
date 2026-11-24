import { defineMeta } from '../../../contract.ts';

/**
 * A tunnel of neon frames at regular depths along the fly-through camera's path: each frame is drawn at its exact
 * perspective size about the vanishing point (rolling with the camera), coloured by the palette's accents, fading
 * into the fog far away and out as it passes the camera; a glow marks the vanishing point. Every layer draws the same
 * tunnel from the reel-wide camera path, so it continues seamlessly across sections.
 */
export const meta = defineMeta({
  id: 'tunnel',
  axis: 'background',
  layer: 'dom',
  label: 'Depth tunnel',
  params: {
    spacing: { min: 0.2, max: 3, default: 0.8, label: 'Depth between frames (focal lengths)' },
    size: { min: 0.8, max: 2, default: 1.12, label: 'Frame size at one focal length (× frame)' },
    width: { min: 0.002, max: 0.03, default: 0.009, label: 'Frame stroke at one focal length (× short side)' },
    glow: { min: 0, max: 1, default: 0.6, label: 'Frame glow' },
    far: { min: 3, max: 16, default: 9, label: 'Fog distance (focal lengths)' },
  },
});
