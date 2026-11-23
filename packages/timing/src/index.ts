/**
 * Timing engine (PLAN.md §7): beat grid → section budget → cue sheet. Runs unchanged in the browser and in Node,
 * so it uses only bit-exact arithmetic (+ − × ÷, Math.round/floor/ceil; no transcendental Math).
 */
import {
  CUE_TYPES,
  sectionItems,
  type Choreography,
  type Cue,
  type CueSheet,
  type Item,
  type JobSpec,
  type ReelSection,
} from '@reel/core';

export interface TimingInput {
  spec: JobSpec;
  choreography: Choreography;
  bpm: number;
  fps: number;
  /** First downbeat in seconds. */
  t0?: number;
}

/** The content does not fit the duration at this tempo. `needed` is the shortest duration that would fit. */
export class TimingError extends Error {
  readonly needed: number;
  readonly available: number;
  constructor(needed: number, available: number) {
    super(
      `content needs ${needed.toFixed(1)} s but the video is ${available.toFixed(1)} s: ` +
        `shorten the text, remove a section, or raise the duration`,
    );
    this.name = 'TimingError';
    this.needed = needed;
    this.available = available;
  }
}

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
const halves = (beats: number) => Math.max(0, Math.round(beats * 2));

/** Short words land on the off-beat between their neighbours instead of taking a full slot. */
const isShort = (it: Item) => !it.emphasis && it.graphemes <= 3 && (it.kind === 'word' || it.kind === 'place');

/**
 * Landing offsets in half-beats relative to the section's first landing. A short word after another item takes
 * the off-beat slot; the next regular word still lands on the following beat.
 */
function offsets(items: Item[], unit: number, short: number): number[] {
  const out: number[] = [];
  let beat = 0; // last regular (on-grid) landing
  items.forEach((it, i) => {
    if (i === 0) out.push(0);
    else if (isShort(it) && !isShort(items[i - 1]!) && short < unit) out.push(beat + short);
    else {
      beat += unit;
      out.push(beat);
    }
  });
  return out;
}

/** Largest-remainder apportionment of `total` integer units by `weights` (deterministic tie-break by index). */
function apportion(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const exact = weights.map((w) => (total * w) / sum);
  const base = exact.map(Math.floor);
  let rest = total - base.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) {
    if (rest-- <= 0) break;
    base[i]! += 1;
  }
  return base;
}

export function buildCueSheet({ spec, choreography: c, bpm, fps, t0 = 0.5 }: TimingInput): CueSheet {
  const beat = 60 / bpm;
  const H = beat / 2;
  const at = (h: number) => r6(t0 + h * H);
  const duration = spec.duration;
  const frames = Math.round(duration * fps);

  const secs = spec.sections.map((s) => ({ section: s, items: sectionItems(s, spec) }));
  for (const { section, items } of secs) {
    if (!items.length) throw new Error(`section "${section.id}" has nothing to show`);
  }
  const last = secs.length - 1;
  const lastIsEnd = secs[last]!.section.role === 'endcard';
  const offs = secs.map(({ items }, i) =>
    i === last && lastIsEnd
      ? items.map((_, k) => k * halves(c.endUnitBeats))
      : offsets(items, halves(c.unitBeats), halves(c.shortUnitBeats)),
  );
  const span = offs.map((o) => o.at(-1)!);

  const intro = halves(c.introBeats);
  const outro = lastIsEnd ? halves(c.outroBeats) : 0;
  const move = halves(c.moveBeats);
  const tailMin = Math.ceil(r6(c.minTail / H));
  const endMin = Math.ceil(r6(c.endHold / H));
  const available = Math.floor(r6((duration - t0) / H));
  const required =
    intro + span.reduce((a, b) => a + b, 0) + last * (tailMin + move) + outro + endMin;
  if (required > available) throw new TimingError(r6(t0 + required * H), duration);

  // Extra half-beats go to the holds, weighted by how much there is to read; the end hold weighs like an average section.
  const load = secs.slice(0, last).map(({ items }) => Math.max(1, items.reduce((a, it) => a + it.graphemes, 0)));
  const avg = load.length ? load.reduce((a, b) => a + b, 0) / load.length : 1;
  const extra = apportion(available - required, [...load, avg]);

  const sections: ReelSection[] = [];
  const cues: Cue[] = [];
  if (intro > 0) cues.push({ t: at(0), type: 'intro', weight: 1 });
  let cursor = intro;
  let prevOut = 0;
  secs.forEach(({ section, items }, i) => {
    const id = section.id!;
    const lands = offs[i]!.map((o) => cursor + o);
    const firstLand = at(lands[0]!);
    const lastLand = at(lands.at(-1)!);
    const isLast = i === last;
    const outH = lands.at(-1)! + (isLast ? 0 : tailMin + extra[i]!);
    const out = isLast ? duration : at(outH);
    const inT = i === 0 ? 0 : r6(Math.max(prevOut, firstLand - c.leadIn));
    if (i > 0) cues.push({ t: prevOut, type: 'camera-move', section: id, weight: 1, until: inT });
    cues.push({ t: inT, type: 'section-in', section: id, weight: 1 });
    if (isLast && section.role === 'endcard') cues.push({ t: firstLand, type: 'endcard', section: id, weight: 1 });
    items.forEach((it, k) => {
      const t = at(lands[k]!);
      cues.push({ t, type: 'land', section: id, unit: k, weight: it.emphasis ? 1 : 0.6 });
      if (it.emphasis) cues.push({ t, type: 'emphasis', section: id, unit: k, weight: 1 });
    });
    if (isLast && outro > 0) cues.push({ t: at(lands.at(-1)! + outro), type: 'outro', weight: 1 });
    sections.push({
      id,
      role: section.role,
      items: items.map((it, k) => ({ ...it, at: at(lands[k]!) })),
      timing: {
        in: inT,
        firstLand,
        lastLand,
        holdStart: r6(Math.min(lastLand + c.entry, out)),
        holdEnd: out,
        out,
      },
    });
    prevOut = out;
    cursor = outH + move;
  });

  const rank = (t: Cue['type']) => CUE_TYPES.indexOf(t);
  cues.sort((a, b) => a.t - b.t || rank(a.type) - rank(b.type));

  const beats: number[] = [];
  const downbeats: number[] = [];
  for (let k = 0; t0 + k * beat < duration; k++) {
    beats.push(r6(t0 + k * beat));
    if (k % 4 === 0) downbeats.push(r6(t0 + k * beat));
  }
  return { duration, fps, frames, bpm, t0, beats, downbeats, sections, cues };
}
