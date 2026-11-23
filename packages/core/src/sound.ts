/**
 * Sound effects driven by the visuals (PLAN.md §8.2, M3). The page reports what it animates (`ReelPage.soundCues`):
 * every impact, wipe, camera move, digit spin and flash becomes a timed sound cue; `@reel/audio` renders them into an
 * SFX stem mixed over any music source. Cues are a pure function of the job (computed at `ready()`), so the SFX stem
 * is deterministic and cacheable like the music.
 */
export const SOUND_KINDS = [
  /** Air movement: camera pans/turns, panel wipes, whip exits. Uses `until` for its length. */
  'whoosh',
  /** Heavy landing: slams, drops, kicks of large words. */
  'impact',
  /** Light landing: masks, slides, pops. */
  'pop',
  /** One mechanical click: each digit settling on an odometer/slot, typewriter keys. */
  'tick',
  /** Short rising tension before a reveal; uses `until`. */
  'riser',
  /** Bright accent: white flashes, sparkles, bursts. */
  'shimmer',
  /** Marker/highlighter stroke: swipes, rules drawing, outline→fill sweeps; uses `until`. */
  'swipe',
  /** Closing accent on the end card. */
  'stinger',
] as const;
export type SoundKind = (typeof SOUND_KINDS)[number];

export interface SoundCue {
  /** Seconds from video start; the sound's attack lands exactly here. */
  t: number;
  kind: SoundKind;
  /** 0..1 loudness intent; the mixer maps it to gain. */
  weight: number;
  /** End time for sounds with a length (`whoosh`, `riser`, `swipe`). */
  until?: number;
  /** −1 (left) … 1 (right): where on screen the thing happens. */
  pan?: number;
  /** Semitone offset for pitched variants (ticks of successive digits, rising pops). */
  pitch?: number;
  /** Section id it belongs to, for debugging and per-section mute. */
  section?: string;
}
