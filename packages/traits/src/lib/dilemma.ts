/**
 * Shared state of the dilemma-reveal traits: `layout/dilemma-cards` writes it into `unit.data.layout` /
 * `section.data.layout`, `reveal/dilemma-mix` animates from it. Plain JSON (fingerprinted with the units).
 */
import type { Unit } from '../contract.ts';

/** Words that split a text section into two options (compared lower-cased, trailing punctuation dropped). */
const CONNECTORS: Partial<Record<string, true>> = { or: true, vs: true, 'vs.': true, versus: true, או: true, נגד: true, מול: true };

/** Index of the connector word among a section's content units (never first or last), or -1. */
export function connectorIndex(content: readonly Unit[]): number {
  return content.findIndex(
    (u, i) => i > 0 && i < content.length - 1 && u.kind === 'word' && !!CONNECTORS[u.text.toLowerCase().replace(/[!?.,:]+$/u, '')],
  );
}

/** `unit.data.layout` of what the dilemma layout draws. */
export type DilemmaUnit =
  /** Content: the surface it is printed on (the material picks a readable ink); the connector sits in the disc. */
  | { kind: 'text'; surface: string; connector?: boolean }
  /**
   * A card: `main` (the section's card), `a` / `b` (options; b slides out from behind a by `dx, dy`), `back` (the
   * answer's face-down '?' card), `answer` (its accent face). Shown from `at`.
   */
  | { kind: 'card'; card: 'main' | 'a' | 'b' | 'back' | 'answer'; at: number; dx: number; dy: number }
  /** Half of a '?' seal over content unit `of` (side −1 = left half); shown from `from`, opens at the unit's landing. */
  | { kind: 'seal'; side: -1 | 1; of: number; from: number }
  /** The connector disc (pops with the connector) or the question's '?' watermark. */
  | { kind: 'disc' | 'mark'; at: number };

/** `section.data.layout`: how the section is staged; `flip` = the answer card's flip time. */
export interface DilemmaSection {
  stage: 'card' | 'split' | 'question' | 'answer';
  size: number;
  flip: number;
}

export const dilemmaOf = (u: Unit): DilemmaUnit | undefined => u.data.layout as DilemmaUnit | undefined;
