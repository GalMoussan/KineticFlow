import { defineMeta } from '../../../contract.ts';

/**
 * Particles form the words: every text unit's ink is sampled once (Canvas2D mask of its own text at its font) into
 * a frozen particle set; the particles swirl in from all around and land on the ink, the real DOM text fades in as
 * they land and is the only text at the hold; exits blow the word apart into drifting dust. Drawn into one
 * full-frame canvas per section in `layer.over`, from t alone. Logos fade up.
 */
export const meta = defineMeta({
  id: 'particle-assemble',
  axis: 'reveal',
  layer: 'canvas',
  label: 'Particle assemble',
  params: {
    fly: { min: 0.3, max: 2, default: 0.9, label: 'Flight time of a particle (s)' },
    spread: { min: 0, max: 0.6, default: 0.3, label: 'Spread of the particles’ start times (s)' },
    fade: { min: 0.1, max: 0.8, default: 0.3, label: 'Text fade-in as the particles land (s)' },
    density: { min: 0.3, max: 2, default: 1, label: 'Particle density' },
    swirl: { min: 0, max: 3, default: 1.3, label: 'Swirl on the way in (rad)' },
    reach: { min: 0.2, max: 1.2, default: 0.7, label: 'Start distance (× short frame side)' },
    dust: { min: 0, max: 1, default: 0.5, label: 'Ambient dust strength (0 = none)' },
    exit: { min: 0.1, max: 1.5, default: 0.6, label: 'Exit duration (s, clipped to the window)' },
  },
});
