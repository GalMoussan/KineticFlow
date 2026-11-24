/**
 * What every preset reads from the cue sheet: the grid, word landings (with emphasis), camera moves, sections and
 * their roles, the teaser breakdown, and where the music resolves. Times stay on the cue sheet's rounding, so a hit
 * scheduled "on a landing" starts on exactly that landing's sample.
 */
import type { CueSheet, SectionRole } from '@reel/core';
import type { Arrangement } from '../engine.ts';
import type { MusicEvent } from '../voices.ts';

/**
 * A kick: the sample plus a pitched sine "boom" (≈ 110 Hz dropping to 49 Hz within ~25 ms, ~130 ms long) on the
 * drums bus, so the kick owns the sub band (< 60 Hz) and the sub envelope peaks on every kick. The sample is gated
 * after `len` seconds so a long 808-style tail cannot swell after the hit (electronic kicks keep only their click and
 * body). Both events carry `tag: 'kick'`. Basslines leave the band to it (their fundamentals sit at ≥ 80 Hz).
 */
export function kick(ev: MusicEvent[], t: number, id: string, gain: number, boom: number, len: number): void {
  ev.push({ v: 'sample', bus: 'drums', id, t, gain, len, tag: 'kick' });
  // midi 31 ≈ 49 Hz; the drop starts 14 semitones higher (≈ 110 Hz).
  ev.push({ v: 'sub', bus: 'drums', t, midi: 31, drop: 14, dropTime: 0.025, dur: 0.09, decay: 0.22, release: 0.04, drive: 1.2, gain: boom, tag: 'kick' });
}

export interface PresetMusic {
  bpm: number;
  seed: number;
}

export interface Preset {
  /** Display name (music cards, catalog). */
  name: string;
  /** One short line on how it sounds. */
  description: string;
  /** Tempo range the arrangement is written for (it renders at any tempo). */
  bpm: [number, number];
  /** Tempo the studio starts at (inside `bpm`). */
  defaultBpm: number;
  arrange(sheet: CueSheet, music: PresetMusic): Arrangement;
}

export interface Land {
  t: number;
  emph: boolean;
  weight: number;
  section: string;
  role: SectionRole;
  /** Landing index over the whole reel. */
  index: number;
}

export interface Plan {
  dur: number;
  bpm: number;
  beat: number;
  bar: number;
  t0: number;
  /** Time of a beat position counted from t0 (fractional for swing/16ths), rounded like the cue sheet. */
  at(beats: number): number;
  lands: Land[];
  /** Opening/closing decoration landings (intro/outro cues). */
  accents: number[];
  moves: { t: number; until: number; section: string }[];
  sectionIns: { t: number; role: SectionRole; id: string }[];
  /** Teaser breakdown: first landing → section out. */
  teaser: [number, number] | null;
  /** Where the groove stops and the final chord sounds: after the outro/last landing, and no earlier than ≈ 2.5 s before the end. */
  end: number;
  /** Bars from t0 up to `end` (the last one may be partial). */
  bars: number;
  barAt(t: number): number;
  inTeaser(t: number): boolean;
  /** Role of the section on screen at `t`. */
  roleAt(t: number): SectionRole;
  /** Fade window for the ending: starts after the final chord has spoken, silent at the duration. */
  fade: { from: number; to: number };
}

const EPS = 1e-9;
/** Seconds the final chord rings and fades at the end of the video. */
const ENDING = 2.5;
export const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

export function plan(sheet: CueSheet, music: PresetMusic): Plan {
  const bpm = sheet.bpm ?? music.bpm;
  const beat = 60 / bpm;
  const bar = beat * 4;
  const t0 = sheet.t0;
  const dur = sheet.duration;
  const at = (beats: number) => r6(t0 + beats * beat);
  const roleOf = new Map(sheet.sections.map((s) => [s.id, s.role]));
  const emph = new Set(sheet.cues.filter((c) => c.type === 'emphasis').map((c) => `${c.section}#${c.unit}`));
  const lands: Land[] = sheet.cues
    .filter((c) => c.type === 'land')
    .map((c, index) => ({
      t: c.t,
      emph: emph.has(`${c.section}#${c.unit}`),
      weight: c.weight,
      section: c.section!,
      role: roleOf.get(c.section!)!,
      index,
    }));
  const accents = sheet.cues.filter((c) => c.type === 'intro' || c.type === 'outro').map((c) => c.t);
  const moves = sheet.cues
    .filter((c) => c.type === 'camera-move')
    .map((c) => ({ t: c.t, until: c.until ?? c.t, section: c.section! }));
  const sectionIns = sheet.cues
    .filter((c) => c.type === 'section-in')
    .map((c) => ({ t: c.t, role: roleOf.get(c.section!)!, id: c.section! }));
  const teaserSec = sheet.sections.find((s) => s.role === 'teaser');
  const teaser = teaserSec ? ([teaserSec.timing.firstLand, teaserSec.timing.out] as [number, number]) : null;
  const outro = sheet.cues.find((c) => c.type === 'outro');
  let end: number;
  if (outro) end = outro.t;
  else {
    const after = (lands.at(-1)?.t ?? t0) + beat;
    end = sheet.beats.find((b) => b >= after - EPS) ?? at(Math.ceil((after - t0) / beat - EPS));
  }
  // The groove carries the end card's hold: it stops on the last beat that still leaves ENDING seconds for the
  // final chord, so a long hold never becomes a long fade (which would also push the loudness range up).
  const latest = sheet.beats.findLast((b) => b <= dur - ENDING + EPS);
  if (latest !== undefined && latest > end) end = latest;
  end = Math.min(end, dur);
  const bars = Math.max(1, Math.ceil((end - t0) / bar - EPS));
  const fadeFrom = Math.min(dur - 0.05, end + Math.max(0.6, (dur - end) * 0.4));
  return {
    dur,
    bpm,
    beat,
    bar,
    t0,
    at,
    lands,
    accents,
    moves,
    sectionIns,
    teaser,
    end,
    bars,
    barAt: (t) => Math.floor((t - t0) / bar + EPS),
    inTeaser: (t) => teaser !== null && teaser[0] - EPS <= t && t < teaser[1] - EPS,
    roleAt: (t) => {
      let role: SectionRole = sheet.sections[0]!.role;
      for (const s of sheet.sections) if (s.timing.in <= t + EPS) role = s.role;
      return role;
    },
    fade: { from: Math.max(0, fadeFrom), to: dur },
  };
}
