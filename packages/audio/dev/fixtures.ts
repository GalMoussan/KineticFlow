/**
 * Shared fixtures for the audio tests and dev scripts: the dilemma cue sheet at any tempo, and a sound-cue list
 * derived from it (the page's `soundCues()` needs a browser; this stands in for it with the same shape).
 */
import { readFileSync } from 'node:fs';
import { JobSpec, type CueSheet, type SoundCue } from '@reel/core';
import { recipe } from '@reel/styles';
import { TimingError, buildCueSheet } from '@reel/timing';

export const dilemma = JobSpec.parse(JSON.parse(readFileSync(new URL('../../../examples/dilemma.json', import.meta.url), 'utf8')));

/** The dilemma cue sheet at `bpm`; slow tempos that cannot fit 26 s get the shortest whole-second duration that fits. */
export function dilemmaSheet(bpm = 100, style = 'kinetic-quote'): CueSheet {
  const choreography = recipe(style).choreography;
  try {
    return buildCueSheet({ spec: dilemma, choreography, bpm, fps: 30 });
  } catch (e) {
    if (!(e instanceof TimingError)) throw e;
    return buildCueSheet({ spec: { ...dilemma, duration: Math.ceil(e.needed) }, choreography, bpm, fps: 30 });
  }
}

/** Landings pop (emphasis: impact), camera moves whoosh, the end card stings, decorations shimmer. */
export function sheetSoundCues(sheet: CueSheet): SoundCue[] {
  const out: SoundCue[] = [];
  const emph = new Set(sheet.cues.filter((c) => c.type === 'emphasis').map((c) => `${c.section}#${c.unit}`));
  for (const c of sheet.cues) {
    const section = c.section !== undefined ? { section: c.section } : {};
    if (c.type === 'land') {
      const e = emph.has(`${c.section}#${c.unit}`);
      out.push({ t: c.t, kind: e ? 'impact' : 'pop', weight: e ? 0.9 : 0.5, pan: ((c.unit ?? 0) % 3) * 0.4 - 0.4, pitch: c.unit ?? 0, ...section });
    } else if (c.type === 'camera-move') out.push({ t: c.t, kind: 'whoosh', weight: 0.7, until: c.until ?? c.t + 0.5, ...section });
    else if (c.type === 'endcard') out.push({ t: c.t, kind: 'stinger', weight: 1, ...section });
    else if (c.type === 'intro' || c.type === 'outro') out.push({ t: c.t, kind: 'shimmer', weight: 0.6 });
  }
  return out.sort((a, b) => a.t - b.t);
}
