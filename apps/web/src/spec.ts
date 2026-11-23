/** Helpers over the spec draft (`JobSpecInput`): section templates, style objects, emphasis editing. */
import { parseEmphasis, TEXT_ROLES, type FormatId, type JobSpecInput, type ResolvedPalette, type SectionRole, type TraitAxis } from '@reel/core';

export type Draft = JobSpecInput;
export type SectionInput = Draft['sections'][number];
export type StyleInput = Draft['style'];
export interface StyleObj {
  base: string;
  blendWith?: { style: string; mix: number };
  traits?: Partial<Record<TraitAxis, string>>;
  params?: Record<string, number>;
}
export type PaletteInput = Draft['palette'];
export type MusicInput = Draft['music'];

export const ALL_FORMATS: FormatId[] = ['9:16', '1:1', '4:5', '16:9'];
export const TEXT_ROLE_SET: ReadonlySet<string> = new Set(TEXT_ROLES);

export const ROLE_LABELS: Record<SectionRole, string> = {
  title: 'Title',
  tagline: 'Tagline',
  body: 'Body',
  teaser: 'Teaser',
  cta: 'Call to action',
  heading: 'Heading',
  question: 'Question',
  answer: 'Answer',
  quote: 'Quote',
  datetime: 'Date & time',
  location: 'Place',
  list: 'List',
  stat: 'Number',
  countdown: 'Countdown',
  lyric: 'Lyrics',
  endcard: 'End card',
};

export function isTextRole(role: string): boolean {
  return role === 'title' || TEXT_ROLE_SET.has(role);
}

export function sectionId(s: SectionInput, i: number): string {
  return s.id ?? `${s.role}-${i}`;
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function newSection(role: SectionRole, carry = ''): SectionInput {
  switch (role) {
    case 'datetime':
      return { role, date: todayIso(), time: '19:30' };
    case 'location':
      return { role, place: carry };
    case 'list':
      return { role, items: carry ? [carry] : [''] };
    case 'stat':
      return { role, value: 100, label: carry };
    case 'countdown':
      return { role, from: todayIso(), to: todayIso() };
    case 'lyric':
      return { role, lines: [{ text: carry }] };
    case 'endcard':
      return { role, logos: [] };
    default:
      return { role, text: carry } as SectionInput;
  }
}

/** Text worth carrying over when a section changes role. */
export function sectionText(s: SectionInput): string {
  switch (s.role) {
    case 'datetime':
      return [s.date, s.time].filter(Boolean).join(' ');
    case 'location':
      return [s.place, s.city].filter(Boolean).join(', ');
    case 'list':
      return [s.title, ...s.items].filter(Boolean).join(' · ');
    case 'stat':
      return `${s.prefix ?? ''}${s.value}${s.suffix ?? ''} ${s.label}`.trim();
    case 'countdown':
      return s.label ?? `${s.from} → ${s.to}`;
    case 'lyric':
      return s.lines.map((l) => l.text).join(' / ');
    case 'endcard':
      return s.text ?? '';
    default:
      return s.text;
  }
}

export function convertSection(s: SectionInput, role: SectionRole): SectionInput {
  if (isTextRole(s.role) && isTextRole(role)) return { ...s, role } as SectionInput;
  const next = newSection(role, isTextRole(s.role) ? sectionText(s) : '');
  return { ...next, ...(s.id ? { id: s.id } : {}), ...(s.style ? { style: s.style } : {}), ...(s.palette ? { palette: s.palette } : {}) } as SectionInput;
}

export function styleObj(style: StyleInput): StyleObj {
  return typeof style === 'string' ? { base: style } : (style as StyleObj);
}

/** Collapses to the plain id when nothing is mixed in. */
export function styleInput(o: StyleObj): StyleInput {
  const out: StyleObj = { base: o.base };
  if (o.blendWith) out.blendWith = o.blendWith;
  if (o.traits && Object.keys(o.traits).length) out.traits = o.traits;
  if (o.params && Object.keys(o.params).length) out.params = o.params;
  return Object.keys(out).length === 1 ? o.base : (out as StyleInput);
}

export function styleBase(style: StyleInput | undefined): string | undefined {
  return style === undefined ? undefined : styleObj(style).base;
}

export const HEBREW = /[\u0590-\u05FF]/;
export function detectLanguage(text: string): 'he' | 'en' {
  return HEBREW.test(text) ? 'he' : 'en';
}

export function newSpecId(): string {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `reel-${stamp}-${Math.random().toString(36).slice(2, 6)}`;
}

export function blankSpec(): Draft {
  return {
    id: newSpecId(),
    language: 'he',
    contentType: 'event',
    brief: '',
    sections: [
      { role: 'title', text: '' },
      { role: 'endcard', logos: [] },
    ],
    style: 'kinetic-quote',
    palette: 'flamingo-cafe',
    fonts: { display: 'rubik' },
    music: { source: 'preset', preset: 'lofi-jazz', bpm: 100, seed: 1101 },
    sfx: true,
    duration: 20,
    formats: ['9:16'],
    quality: 'standard',
  };
}

export function specTitle(spec: Draft | undefined): string {
  const t = spec?.sections.find((s) => s.role === 'title');
  return t && 'text' in t ? plain(t.text) : '';
}

export function plain(text: string): string {
  return parseEmphasis(text)
    .map((r) => r.text)
    .join('');
}

export function resolvePaletteInput(p: PaletteInput, catalog: Record<string, ResolvedPalette>): ResolvedPalette | undefined {
  return typeof p === 'string' ? catalog[p] : p;
}

// ---------- emphasis chips ----------

export interface EmphasisWord {
  word: string;
  emphasis: boolean;
}

function masked(text: string): { chars: string[]; mask: boolean[] } {
  const chars: string[] = [];
  const mask: boolean[] = [];
  for (const run of parseEmphasis(text)) {
    for (const c of run.text) {
      chars.push(c);
      mask.push(run.emphasis);
    }
  }
  return { chars, mask };
}

function wordSpans(chars: string[]): [number, number][] {
  const spans: [number, number][] = [];
  let start = -1;
  chars.forEach((c, i) => {
    const space = /\s/.test(c);
    if (!space && start < 0) start = i;
    if (space && start >= 0) {
      spans.push([start, i]);
      start = -1;
    }
  });
  if (start >= 0) spans.push([start, chars.length]);
  return spans;
}

export function emphasisWords(text: string): EmphasisWord[] {
  const { chars, mask } = masked(text);
  return wordSpans(chars).map(([a, b]) => ({ word: chars.slice(a, b).join(''), emphasis: mask.slice(a, b).some(Boolean) }));
}

const EDGE_PUNCT = /[.,!?:;"'()[\]…\-–—״]/;

/** Toggles `*emphasis*` on the i-th whitespace-separated word, keeping every other marker as typed. */
export function toggleEmphasis(text: string, index: number): string {
  const { chars, mask } = masked(text);
  const span = wordSpans(chars)[index];
  if (!span) return text;
  let [a, b] = span;
  const on = !mask.slice(a, b).some(Boolean);
  if (on) {
    while (a < b - 1 && EDGE_PUNCT.test(chars[a]!)) a++;
    while (b > a + 1 && EDGE_PUNCT.test(chars[b - 1]!)) b--;
  }
  for (let i = span[0]; i < span[1]; i++) mask[i] = on && i >= a && i < b;
  let out = '';
  let open = false;
  chars.forEach((c, i) => {
    const m = mask[i] === true && !/\s/.test(c);
    if (m !== open) {
      out += '*';
      open = m;
    }
    out += c === '*' ? '\\*' : c;
  });
  if (open) out += '*';
  return out;
}

// ---------- issues ----------

const MESSAGES: [RegExp, string][] = [
  [/^Too small: expected string to have >=1 characters?$/, 'needs text'],
  [/^Too small: expected array to have >=1 items?$/, 'needs at least one'],
  [/^Too big: expected string to have <=(\d+) characters$/, 'is too long (max $1 characters)'],
  [/^Invalid ISO date$/, 'needs a valid date'],
  [/^Invalid input: expected number, received NaN$/, 'needs a number'],
];

/** Plain-language version of a zod message. */
export function humanMessage(message: string): string {
  for (const [re, out] of MESSAGES) if (re.test(message)) return message.replace(re, out);
  return message;
}

/** `Section 2 (Tagline) › text: needs text` for an issue path into the draft. */
export function describeIssue(path: (string | number)[], message: string, spec: Draft): string {
  const parts: string[] = [];
  let rest = path;
  if (path[0] === 'sections' && typeof path[1] === 'number') {
    const sec = spec.sections[path[1]];
    parts.push(`Section ${path[1] + 1}${sec ? ` (${ROLE_LABELS[sec.role] ?? sec.role})` : ''}`);
    rest = path.slice(2);
  }
  parts.push(...rest.map((p) => (typeof p === 'number' ? `#${p + 1}` : p)));
  return `${parts.length ? parts.join(' › ') + ': ' : ''}${humanMessage(message)}`;
}

/** Section index an issue path points into, if any. */
export function issueSection(path: (string | number)[]): number | undefined {
  return path[0] === 'sections' && typeof path[1] === 'number' ? path[1] : undefined;
}

export function pathKey(path: (string | number)[]): string {
  return path.join('.');
}
