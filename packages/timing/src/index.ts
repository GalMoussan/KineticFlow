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

/** Beats detected in a track (Beat This!), already in video time (t = 0 is the first video frame). */
export interface BeatGrid {
  beats: number[];
  downbeats: number[];
  /** Share of bars that agree with the detected meter; downbeats are used only when ≥ `MIN_METER_CONFIDENCE`. */
  meterConfidence?: number;
}

export interface TimingInput {
  spec: JobSpec;
  choreography: Choreography;
  /** Tempo of a generated (uniform) grid. Ignored with `grid`: the sheet's bpm is then the median detected tempo. */
  bpm?: number;
  fps: number;
  /** First downbeat of a uniform grid in seconds. */
  t0?: number;
  /**
   * A detected grid instead of the uniform one. Landings go to detected beats; half-beats interpolate between
   * consecutive beats, so every choreography beat length takes the local beat length.
   */
  grid?: BeatGrid;
}

/** Below this meter confidence the detected downbeats are ignored and bars count 4 beats from the first landing beat. */
export const MIN_METER_CONFIDENCE = 0.8;
/** Earliest first downbeat of a detected grid: the title's entry needs a moment before its landing. */
export const MIN_GRID_T0 = 0.4;

/** The content does not fit the duration at this tempo. `needed` is the shortest duration that would fit. */
export class TimingError extends Error {
  readonly needed: number;
  readonly available: number;
  constructor(needed: number, available: number, tempo?: string) {
    super(
      `content needs ${needed.toFixed(1)} s but the video is ${available.toFixed(1)} s` +
        `${tempo ? ` at ${tempo}` : ''}: shorten the text, remove a section, or raise the duration`,
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
 * the off-beat slot; the next regular word still lands on the following beat. The small line under a section (`sub`
 * items) lands a full slot after the big words, then word by word on the short (off-beat) cadence: a ripple.
 */
function offsets(items: Item[], unit: number, short: number): number[] {
  const out: number[] = [];
  let beat = 0; // last regular (on-grid) landing
  items.forEach((it, i) => {
    const prev = items[i - 1];
    if (i === 0) out.push(0);
    else if (it.kind === 'sub' && prev?.kind === 'sub' && short < unit) out.push((beat += short));
    else if (isShort(it) && !isShort(prev!) && short < unit) out.push(beat + short);
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

/** What the content needs, in half-beats, independent of where the beats are. */
interface Plan {
  secs: { section: JobSpec['sections'][number]; items: Item[] }[];
  last: number;
  /** Landing offsets per section, in half-beats from its first landing. */
  offs: number[][];
  span: number[];
  intro: number;
  outro: number;
  move: number;
  /** Apportionment weights of the extra half-beats: one per non-last section (reading load), then the end hold. */
  weights: number[];
}

function plan(spec: JobSpec, c: Choreography): Plan {
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
  // Extra half-beats go to the holds, weighted by how much there is to read; the end hold weighs like an average section.
  const load = secs.slice(0, last).map(({ items }) => Math.max(1, items.reduce((a, it) => a + it.graphemes, 0)));
  const avg = load.length ? load.reduce((a, b) => a + b, 0) / load.length : 1;
  return {
    secs,
    last,
    offs,
    span: offs.map((o) => o.at(-1)!),
    intro: halves(c.introBeats),
    outro: lastIsEnd ? halves(c.outroBeats) : 0,
    move: halves(c.moveBeats),
    weights: [...load, avg],
  };
}

/** Uniform grid `t0 + h·H`: tails are `tailMin` plus the apportioned extra half-beats. */
function uniformTails(p: Plan, c: Choreography, duration: number, t0: number, H: number): number[] {
  const tailMin = Math.ceil(r6(c.minTail / H));
  const endMin = Math.ceil(r6(c.endHold / H));
  const available = Math.floor(r6((duration - t0) / H));
  const required =
    p.intro + p.span.reduce((a, b) => a + b, 0) + p.last * (tailMin + p.move) + p.outro + endMin;
  if (required > available) throw new TimingError(r6(t0 + required * H), duration, `${r6(60 / (2 * H))} bpm`);
  const extra = apportion(available - required, p.weights);
  return extra.slice(0, p.last).map((e) => tailMin + e);
}

/** Detected grid: half-beat `h` → seconds, the median tempo and the beats/downbeats the sheet reports. */
function detectedGrid(grid: BeatGrid, duration: number) {
  const b = [...new Set(grid.beats.filter((t) => Number.isFinite(t)))].sort((x, y) => x - y);
  const n = b.length;
  if (n < 2) throw new Error(`the track has ${n} detected beat(s) in the video window; landings need at least 2`);
  const trusted = (grid.meterConfidence ?? 1) >= MIN_METER_CONFIDENCE && grid.downbeats.length > 0;
  const firstDown = trusted ? grid.downbeats.find((t) => t >= MIN_GRID_T0 - 1e-9 && t < duration) : undefined;
  // downbeats sit on beats (Beat This! snaps them); the nearest beat also absorbs rounding
  const s =
    firstDown !== undefined
      ? b.reduce((best, x, i) => (Math.abs(x - firstDown) < Math.abs(b[best]! - firstDown) ? i : best), 0)
      : b.findIndex((t) => t >= MIN_GRID_T0 - 1e-9);
  if (s < 0 || b[s]! >= duration) throw new Error(`the track has no detected beat between ${MIN_GRID_T0} s and the end of the video`);
  const lastIbi = b[n - 1]! - b[n - 2]!;
  const lastH = 2 * (n - 1 - s);
  // past the last detected beat the grid continues at the last local beat length
  const at = (h: number): number => {
    if (h > lastH) return r6(b[n - 1]! + ((h - lastH) * lastIbi) / 2);
    const k = s + Math.floor(h / 2);
    return r6(h % 2 === 0 ? b[k]! : (b[k]! + b[k + 1]!) / 2);
  };
  const ibis = b.slice(1).map((t, i) => t - b[i]!).sort((x, y) => x - y);
  const m = ibis.length;
  const median = m % 2 ? ibis[(m - 1) / 2]! : (ibis[m / 2 - 1]! + ibis[m / 2]!) / 2;
  const inVideo = (t: number) => t >= 0 && t < duration;
  const beats = b.filter(inVideo).map(r6);
  const downbeats = trusted
    ? grid.downbeats.filter(inVideo).map(r6)
    : b.filter((t, i) => i >= s && (i - s) % 4 === 0 && inVideo(t)).map(r6);
  return { at, bpm: r6(60 / median), beats, downbeats };
}

/**
 * Tails on a detected grid. Seconds (`minTail`, `endHold`) are measured on the grid itself, so they follow the local
 * tempo; the extra half-beats are apportioned like the uniform grid's, then taken back from the largest holds if the
 * local tempo made the layout overrun.
 */
function gridTails(p: Plan, c: Choreography, duration: number, at: (h: number) => number, bpm: number): number[] {
  const tailHalves = (h: number) => {
    let k = 0;
    while (at(h + k) - at(h) < c.minTail - 1e-9) k++;
    return k;
  };
  const walk = (extra: number[]) => {
    const tails: number[] = [];
    let cursor = p.intro;
    for (let i = 0; i < p.last; i++) {
      const lastH = cursor + p.span[i]!;
      tails.push(tailHalves(lastH) + extra[i]!);
      cursor = lastH + tails[i]! + p.move;
    }
    return { tails, end: cursor + p.span[p.last]! + p.outro };
  };
  // last half-beat that still leaves `endHold` before the end of the video
  const limit = duration - c.endHold + 1e-9;
  let available = -1;
  while (at(available + 1) <= limit) available++;
  const base = walk(p.weights.map(() => 0));
  if (base.end > available) throw new TimingError(r6(at(base.end) + c.endHold), duration, `the track's ${r6(bpm)} bpm`);
  const extra = apportion(available - base.end, p.weights);
  let res = walk(extra);
  while (res.end > available) {
    let i = -1;
    for (let k = 0; k < p.last; k++) if (extra[k]! > 0 && (i < 0 || extra[k]! >= extra[i]!)) i = k;
    if (i < 0) break;
    extra[i]! -= 1;
    res = walk(extra);
  }
  return res.tails;
}

/**
 * Drops phantom beats at the edges of a detected grid (M0f: the model keeps beating ~1 s into a held final chord and
 * can mark a whoosh before the music starts). `strength[i]` is the onset strength at `beats[i]`; leading and trailing
 * beats weaker than `ratio` × the median beat strength go. Inner beats are never touched.
 */
export function trimEdgeBeats(grid: BeatGrid, strength: number[], ratio = 0.2): { grid: BeatGrid; head: number; tail: number } {
  const { beats } = grid;
  const sorted = [...strength].sort((x, y) => x - y);
  const median = sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)]! : 0;
  const weak = (i: number) => strength[i]! < ratio * median;
  let lo = 0;
  let hi = beats.length;
  if (median > 0) {
    while (lo < hi && weak(lo)) lo++;
    while (hi > lo && weak(hi - 1)) hi--;
  }
  const kept = beats.slice(lo, hi);
  const keep = new Set(kept);
  return {
    grid: { ...grid, beats: kept, downbeats: grid.downbeats.filter((d) => keep.has(d)) },
    head: lo,
    tail: beats.length - hi,
  };
}

export function buildCueSheet(input: TimingInput): CueSheet {
  const { spec, choreography: c, fps } = input;
  const duration = spec.duration;
  const frames = Math.round(duration * fps);
  const p = plan(spec, c);

  let at: (h: number) => number;
  let tails: number[];
  let bpm: number;
  let beats: number[];
  let downbeats: number[];
  if (input.grid) {
    const g = detectedGrid(input.grid, duration);
    ({ at, bpm, beats, downbeats } = g);
    tails = gridTails(p, c, duration, at, bpm);
  } else {
    if (input.bpm === undefined) throw new Error('buildCueSheet needs a bpm or a detected grid');
    bpm = input.bpm;
    const t0 = input.t0 ?? 0.5;
    const beat = 60 / bpm;
    const H = beat / 2;
    at = (h: number) => r6(t0 + h * H);
    tails = uniformTails(p, c, duration, t0, H);
    beats = [];
    downbeats = [];
    for (let k = 0; t0 + k * beat < duration; k++) {
      beats.push(r6(t0 + k * beat));
      if (k % 4 === 0) downbeats.push(r6(t0 + k * beat));
    }
  }

  const { secs, last, offs, intro, outro, move } = p;
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
    const outH = lands.at(-1)! + (isLast ? 0 : tails[i]!);
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
  return { duration, fps, frames, bpm, t0: at(0), beats, downbeats, sections, cues };
}
