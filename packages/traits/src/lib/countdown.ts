/**
 * Countdown steps shared by `layout/count-board` (sizes the number plates for the widest step) and
 * `reveal/count-slam` (shows the steps on the beat grid before the real number slams in). Page-side only.
 *
 * - stat / countdown values count DOWN to their value: v + 4d, v + 3d, v + 2d, v + d with d = max(1, round(v / 8))
 *   (one decimal step for decimals), keeping the prefix and suffix (`120+` → `180+ … 135+`);
 * - the date gets a launch count `3 · 2 · 1` on whole beats;
 * - everything else (time, words) has no steps.
 */
import type { Host, Section, Unit } from '../contract.ts';

/** How many steps a count runs at most (the launch count is always 3 · 2 · 1). */
export const MAX_STEPS = 4;
const NUMBER = /^(\D*?)(\d+(?:\.\d+)?)(\D*)$/u;

export interface CountSteps {
  /** `count` steps on half-beats, `launch` digits on whole beats. */
  mode: 'count' | 'launch';
  /** Step texts, first shown first (all of them; the reveal keeps the last ones that fit its window). */
  texts: string[];
}

/** The steps of a unit, or null when it does not count. */
export function countSteps(u: Unit): CountSteps | null {
  if (u.item < 0) return null;
  if (u.kind === 'date') return { mode: 'launch', texts: ['3', '2', '1'] };
  if (u.kind !== 'stat' && u.kind !== 'countdown') return null;
  const m = NUMBER.exec(u.text);
  if (!m) return null;
  const [, pre, num, post] = m as unknown as [string, string, string, string];
  const dec = num.includes('.') ? num.length - num.indexOf('.') - 1 : 0;
  const v = Number(num);
  const q = 10 ** dec;
  const d = Math.max(1, Math.round((v * q) / 8)) / q;
  const texts: string[] = [];
  for (let k = MAX_STEPS; k >= 1; k--) texts.push(`${pre}${(v + k * d).toFixed(dec)}${post}`);
  return { mode: 'count', texts };
}

/**
 * Step times before `u.at` on the cue sheet's grid (half-beats for counts, beats for the launch), no earlier than
 * the section's incoming window (its layer is drawn from there) and at least one grid step apart; the texts are the
 * last ones of `steps.texts` that fit.
 */
export function stepTimes(host: Host, s: Section, u: Unit, steps: CountSteps): { texts: string[]; times: number[] } {
  const beats = host.reel.cues.beats;
  const grid: number[] = [];
  for (let i = 0; i < beats.length; i++) {
    grid.push(beats[i]!);
    if (steps.mode === 'count' && i + 1 < beats.length) grid.push((beats[i]! + beats[i + 1]!) / 2);
  }
  const start = Math.max(0.55, s.window ? s.window.t0 : s.timing.in);
  const fit = grid.filter((t) => t >= start - 1e-6 && t < u.at - 0.05);
  const n = Math.min(steps.texts.length, fit.length);
  return { texts: steps.texts.slice(steps.texts.length - n), times: fit.slice(fit.length - n) };
}
