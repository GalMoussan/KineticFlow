import { parseEmphasis } from './emphasis.ts';
import { daysBetween, numericDate, weekday } from './derive.ts';
import type { JobSpec, ResolvedSection } from './spec.ts';

/**
 * The landing units of a section: what the timing engine schedules, the music hits, the page animates and QA
 * reads back. Every consumer derives them through this one function so indices always agree.
 */
export type ItemKind =
  | 'word'
  | 'weekday'
  | 'date'
  | 'time'
  | 'place'
  | 'city'
  | 'logos'
  | 'list-title'
  | 'list-item'
  | 'stat'
  | 'countdown'
  | 'lyric'
  /** A word of a title/text section's small line under the big words (`section.sub`). */
  | 'sub';

export interface Item {
  /** NFC text as it must appear on screen (empty for `logos`). */
  text: string;
  emphasis: boolean;
  kind: ItemKind;
  /** Lay out left-to-right (numbers, Latin) even inside a right-to-left section. */
  ltr: boolean;
  /** User-perceived characters; niqqud does not count separately. */
  graphemes: number;
}

const HEBREW = /[\u0590-\u05FF]/;
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function item(text: string, kind: ItemKind, emphasis = false, forceLtr?: boolean): Item {
  const nfc = text.normalize('NFC');
  return {
    text: nfc,
    emphasis,
    kind,
    ltr: forceLtr ?? (!HEBREW.test(nfc) && /[\p{L}\p{N}]/u.test(nfc)),
    graphemes: [...segmenter.segment(nfc)].length,
  };
}

/** Whitespace-separated words; a word is emphasised if any part of it is inside `*…*`. */
export function words(source: string, kind: ItemKind = 'word'): Item[] {
  const out: { text: string; emphasis: boolean }[] = [];
  let open = false; // whether the current word is still being built (no whitespace seen since)
  for (const run of parseEmphasis(source)) {
    for (const [i, part] of run.text.split(/(\s+)/).entries()) {
      if (i % 2 === 1) {
        open = false;
        continue;
      }
      if (!part) continue;
      const last = out.at(-1);
      if (open && last) {
        last.text += part;
        last.emphasis ||= run.emphasis;
      } else out.push({ text: part, emphasis: run.emphasis });
      open = true;
    }
  }
  return out.map((w) => item(w.text, kind, w.emphasis));
}

export function sectionItems(section: ResolvedSection, spec: Pick<JobSpec, 'language' | 'sections'>): Item[] {
  switch (section.role) {
    case 'title':
    case 'tagline':
    case 'body':
    case 'teaser':
    case 'cta':
    case 'heading':
    case 'question':
    case 'answer':
    case 'quote':
      return [...words(section.text), ...(section.sub ? words(section.sub, 'sub') : [])];
    case 'datetime':
      return [
        item(weekday(section.date, spec.language), 'weekday'),
        item(numericDate(section.date), 'date', true, true),
        ...(section.time ? [item(section.time, 'time', false, true)] : []),
      ];
    case 'location': {
      const place = words(section.place, 'place');
      const last = place.at(-1);
      if (section.city && last) place[place.length - 1] = item(`${last.text},`, 'place', last.emphasis);
      return section.city ? [...place, item(section.city, 'city')] : place;
    }
    case 'list':
      return [
        ...(section.title ? [item(section.title, 'list-title')] : []),
        ...section.items.map((t) => item(t, 'list-item')),
      ];
    case 'stat':
      return [item(`${section.prefix ?? ''}${section.value}${section.suffix ?? ''}`, 'stat', true, true), ...words(section.label)];
    case 'countdown':
      return [
        item(String(daysBetween(section.from, section.to)), 'countdown', true, true),
        ...(section.label ? words(section.label) : []),
      ];
    case 'lyric':
      return section.lines.map((l) => item(l.text, 'lyric'));
    case 'endcard': {
      const title = spec.sections.find((s) => s.role === 'title');
      const text = section.text ?? (title && 'text' in title ? title.text : '');
      return [...words(text), ...(section.logos.length ? [item('', 'logos')] : [])];
    }
  }
}
