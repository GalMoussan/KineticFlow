/**
 * Keeps word sketches on their word when a section's text or small line is edited (SKETCH-PLAN P5): a word sketch
 * holds an item index (`place.item`; the small line's words follow the big ones), and every insert or delete before
 * it shifts that index. Works on drafts (possibly invalid specs). Pure; the studio calls it inside the same
 * `s.update` as the text change, so one undo restores both.
 */
import { words } from './items.ts';
import type { JobSpecInput } from './spec.ts';

type DraftSection = JobSpecInput['sections'][number];

export interface Retargeted {
  section: DraftSection;
  /** Ids of the sketches dropped because their word was deleted or lost its emphasis. */
  dropped: string[];
  /** The words those sketches were on (for the toast). */
  words: string[];
}

/** Big-text words, then small-line words (`sectionItems` order for title/text roles); null for other roles. */
function tokens(s: DraftSection): { key: string; kind: string; text: string; emphasis: boolean }[] | null {
  if (s.role === 'endcard' || !('text' in s) || typeof s.text !== 'string') return null;
  const sub = 'sub' in s && typeof s.sub === 'string' ? s.sub : undefined;
  return [...words(s.text), ...(sub ? words(sub, 'sub') : [])].map((w) => ({ key: `${w.kind}\u0000${w.text}`, kind: w.kind, text: w.text, emphasis: w.emphasis }));
}

/**
 * `after` (the edited `before`) with its word sketches re-pointed at the same words: old and new words are aligned
 * by their longest common subsequence (word text and big/small line), and a lone word replaced by a lone word between
 * two aligned ones (on the same line) counts as the same word edited in place; a sketch moves with its word, and is dropped
 * when its word was deleted or, having been emphasised, lost its emphasis (the `✎` menu lives on emphasised words).
 * Sketches that are not on a word are kept as they are. Returns `after` itself when nothing changes.
 */
export function retargetWordSketches(before: DraftSection, after: DraftSection): Retargeted {
  const none: Retargeted = { section: after, dropped: [], words: [] };
  if (after.role === 'endcard' || !after.sketches?.some((k) => k.place?.mode === 'word')) return none;
  const a = tokens(before);
  const b = tokens(after);
  if (!a || !b) return none;
  // LCS table over the word keys (sections hold a handful of words)
  const L = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) L[i]![j] = a[i]!.key === b[j]!.key ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
  }
  const map = new Map<number, number>();
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (a[i]!.key === b[j]!.key) map.set(i++, j++);
    else if (L[i + 1]![j]! >= L[i]![j + 1]!) i++;
    else j++;
  }
  // a word edited in place (a typo fixed, "!" added, a letter removed, niqqud added): between two matched words,
  // exactly one old and one new word on the same line → the same word
  const pairs = [[-1, -1], ...[...map].sort((x, y) => x[0] - y[0]), [a.length, b.length]] as const;
  for (let k = 1; k < pairs.length; k++) {
    const [i0, j0] = pairs[k - 1]!;
    const [i1, j1] = pairs[k]!;
    if (i1 - i0 === 2 && j1 - j0 === 2 && a[i0 + 1]!.kind === b[j0 + 1]!.kind) map.set(i0 + 1, j0 + 1);
  }
  const dropped: string[] = [];
  const lost: string[] = [];
  let changed = false;
  const sketches = after.sketches.flatMap((k) => {
    if (k.place?.mode !== 'word') return [k];
    const item = k.place.item;
    const to = map.get(item);
    if (to === undefined || (a[item]?.emphasis && !b[to]!.emphasis)) {
      changed = true;
      dropped.push(k.id);
      if (a[item]) lost.push(a[item].text);
      return [];
    }
    if (to === item) return [k];
    changed = true;
    return [{ ...k, place: { ...k.place, item: to } }];
  });
  if (!changed) return none;
  const section = { ...after } as Record<string, unknown>;
  if (sketches.length) section.sketches = sketches;
  else delete section.sketches;
  return { section: section as DraftSection, dropped, words: [...new Set(lost)] };
}
