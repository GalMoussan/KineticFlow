import { defineMeta } from '../../../contract.ts';

/**
 * Isometric blocks: every section is a stack of solid blocks, one per row of text, the text printed on each block's
 * front face. Blocks are true boxes in a parallel projection (front/back/top/left/right faces mapped affinely,
 * shaded from the palette, back-face culled), dropped onto the stack bottom-up as the section arrives. Each section
 * stands on its own side of the world: the turntable camera turns the world 90° between sections, and at holds the
 * text face rests at a mild angle (`yaw`, `pitch`) so it stays legible.
 */
export const meta = defineMeta({
  id: 'iso-blocks',
  axis: 'layout',
  layer: 'dom',
  label: 'Isometric blocks',
  requires: { camera: ['turntable'] },
  roles: [
    'title', 'tagline', 'body', 'teaser', 'cta', 'heading', 'question', 'answer', 'quote',
    'datetime', 'location', 'list', 'stat', 'countdown', 'endcard',
  ],
  params: {
    yaw: { min: 0, max: 45, default: 26, label: 'Rest yaw of the text faces (deg)' },
    pitch: { min: 5, max: 40, default: 24, label: 'Elevation: looking down (deg)' },
    depth: { min: 0.1, max: 1.5, default: 0.6, label: 'Block depth (em of the base size)' },
    radius: { min: 0.5, max: 1.2, default: 0.66, label: 'Turn radius (× safe width)' },
    cap: { min: 0.15, max: 0.6, default: 0.3, label: 'Largest font size (× safe width)' },
    drop: { min: 0.2, max: 1.5, default: 0.55, label: 'Drop height (× safe height)' },
  },
});
