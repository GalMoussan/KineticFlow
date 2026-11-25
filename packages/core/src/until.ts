/**
 * Keeps sketches' `until` pointing at the right section when sections are inserted, moved or deleted (BRIEF "Data
 * model": "moving or deleting a section that another sketch's `until` points to clamps `until`"). Works on drafts
 * (possibly invalid specs), by section identity: the edit keeps the untouched section objects, so `before` and
 * `after` share them.
 */
import type { JobSpecInput } from './spec.ts';

type DraftSection = JobSpecInput['sections'][number];

/** A section's id as the spec parser assigns it: its own `id`, else `<role>-<index>`. */
const idAt = (s: DraftSection, i: number) => s.id ?? `${s.role}-${i}`;

/**
 * `after` with every sketch's `until` remapped to the same target section as in `before`:
 * - the target still exists and is later than the sketch's section → `until` names it, and the target gets an
 *   explicit `id` (its old one, made unique) so later edits cannot retarget it silently;
 * - the target was deleted or is no longer later → clamped to the nearest later section, the latest one that came
 *   before the old target (a shorter span), else the first later one;
 * - no later section is left → `until` is dropped (the sketch ends with its own section).
 * Sections and sketches that need no change are returned as the same objects.
 */
export function retargetSketchUntil(before: readonly DraftSection[], after: readonly DraftSection[]): DraftSection[] {
  const oldIndex = new Map(before.map((s, i) => [s, i] as const));
  const oldById = new Map(before.map((s, i) => [idAt(s, i), i] as const));
  const out = after.slice();
  /** Gives `out[i]` an explicit id (preferring `want`, unique among the other sections' ids) and returns it. */
  const pin = (i: number, want: string): string => {
    const s = out[i]!;
    if (s.id !== undefined) return s.id;
    const used = new Set(out.flatMap((x, n) => (n === i ? [] : [idAt(x, n)])));
    let id = want;
    for (let k = 2; used.has(id); k++) id = `${want}-${k}`;
    out[i] = { ...s, id };
    return id;
  };
  after.forEach((sec, i) => {
    if (sec.role === 'endcard' || !sec.sketches?.some((k) => k.until !== undefined)) return;
    let changed = false;
    const sketches = sec.sketches.map((k) => {
      if (k.until === undefined) return k;
      const from = oldIndex.get(sec);
      // a section new in `after` keeps its until as typed (it was never valid against `before`)
      const target = from === undefined ? undefined : oldById.get(k.until);
      if (target === undefined) return k;
      const tObj = before[target]!;
      let j = after.indexOf(tObj);
      if (j <= i) {
        // clamp: the latest later section that came before the old target, else the first later one
        j = -1;
        for (let n = i + 1; n < out.length; n++) {
          const o = oldIndex.get(after[n]!);
          if (o !== undefined && o < target) j = n;
        }
        if (j < 0 && i + 1 < out.length) j = i + 1;
      }
      if (j < 0) {
        changed = true;
        const { until: _drop, ...rest } = k;
        return rest;
      }
      const own = after[j]!;
      const id = pin(j, idAt(own, oldIndex.get(own) ?? j));
      if (id === k.until) return k;
      changed = true;
      return { ...k, until: id };
    });
    if (changed) out[i] = { ...out[i]!, sketches } as DraftSection;
  });
  // a section whose positional default now equals another section's explicit id (an `until` target that moved)
  // would make the spec invalid ("duplicate section id"): pin it to a unique id of its own
  const explicit = new Set(out.flatMap((s) => (s.id === undefined ? [] : [s.id])));
  out.forEach((s, n) => {
    if (s.id === undefined && explicit.has(idAt(s, n))) explicit.add(pin(n, idAt(s, n)));
  });
  return out;
}
