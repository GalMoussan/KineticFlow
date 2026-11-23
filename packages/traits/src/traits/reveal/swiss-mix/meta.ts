import { defineMeta } from '../../../contract.ts';

/**
 * Swiss title reveals (dilemma-reel `reel12.js`), chosen per unit from its tags: letters rise from behind the
 * baseline mask (plain), fall in with a bounce (closing line of a start stack), aligned lines slide out of their mask
 * edge, emphasis rotates grow (mask wipes open, letters rise) / pop (letters pop with overshoot), numbers spin on an
 * odometer, rules grow from their origin, the pin drops and squashes. The call to action splits apart on its exit.
 */
export const meta = defineMeta({
  id: 'swiss-mix',
  axis: 'reveal',
  layer: 'dom',
  label: 'Swiss mix',
  needs: { chars: true },
  params: {
    lead: { min: 0, max: 0.5, default: 0.12, label: 'Start before landing (s)' },
    duration: { min: 0.2, max: 1.5, default: 0.5, label: 'Entrance duration (s)' },
    stagger: { min: 0, max: 0.15, default: 0.05, label: 'Letter stagger (s)' },
    blur: { min: 0, max: 2, default: 1, label: 'Motion blur (× default)' },
  },
});
