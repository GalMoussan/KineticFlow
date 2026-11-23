/**
 * `splitContent`, `suggestEmphasis`, `rankStyles` (PLAN.md §11): the first configured LLM provider (or the requested
 * one) with JSON-schema output, validated against core's `Section` and repaired; the offline rules otherwise, and
 * whenever a provider fails.
 */
import type { EmphasisResult, LlmProvider, RankStylesResult, SplitResult } from '@reel/api';
import { plainText, Section, TEXT_ROLES } from '@reel/core';
import { RECIPES } from '@reel/styles';
import { callJson, configuredProviders, type Schema } from './providers.ts';
import { detectLanguage, emphasizeLine, emphasizeText, findDateTime, rankRules, splitRules } from './rules.ts';

export { configuredProviders, loadDotEnv } from './providers.ts';
export { splitRules, rankRules, emphasizeText } from './rules.ts';

type Lang = 'he' | 'en';
const ROLES = ['title', ...TEXT_ROLES, 'datetime', 'location', 'list', 'stat', 'countdown', 'endcard'] as const;
const CONTENT_TYPES = ['event', 'list', 'story', 'lyric', 'stats'] as const;
const LANG_NAME = { he: 'Hebrew', en: 'English' } as const;

/** `requested` if configured, else the first configured provider; null → rules. */
function pick(requested: LlmProvider | 'rules' | undefined): LlmProvider | null {
  if (requested === 'rules') return null;
  const have = configuredProviders();
  if (requested) return have.includes(requested) ? requested : null;
  return have[0] ?? null;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const clip = (s: string) => (s.length > 200 ? `${s.slice(0, 199)}…` : s);

/** One LLM section → a valid core `Section` (fields per role, dates/times normalised, emphasis ensured), or null. */
export function repairSection(raw: unknown, today: Date): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const role = str(r.role);
  if (!role || !(ROLES as readonly string[]).includes(role) || role === 'endcard') return null;
  let out: Record<string, unknown>;
  const iso = (v: unknown) => {
    const s = str(v);
    if (!s) return undefined;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    return findDateTime(s, today).date;
  };
  const hhmm = (v: unknown) => {
    const s = str(v);
    if (!s) return undefined;
    const m = /^(\d{1,2})[:.](\d{2})$/.exec(s);
    return m ? `${m[1]!.padStart(2, '0')}:${m[2]}` : findDateTime(s, today).time;
  };
  switch (role) {
    case 'datetime': {
      const date = iso(r.date);
      const time = hhmm(r.time);
      out = { role, date, ...(time ? { time } : {}) };
      break;
    }
    case 'location':
      out = { role, place: str(r.place) ?? str(r.text), ...(str(r.city) ? { city: str(r.city) } : {}) };
      break;
    case 'list': {
      const items = Array.isArray(r.items) ? r.items.map(str).filter((x): x is string => !!x).map(clip).slice(0, 10) : [];
      out = { role, ...(str(r.title) ? { title: clip(str(r.title)!) } : {}), items };
      break;
    }
    case 'stat': {
      const value = typeof r.value === 'number' ? r.value : Number(String(r.value ?? '').replace(/[^\d.-]/g, ''));
      out = {
        role,
        value,
        ...(str(r.prefix) ? { prefix: str(r.prefix)!.slice(0, 4) } : {}),
        ...(str(r.suffix) ? { suffix: str(r.suffix)!.slice(0, 4) } : {}),
        label: str(r.label) ?? str(r.text),
      };
      break;
    }
    case 'countdown':
      out = { role, from: iso(r.from), to: iso(r.to), ...(str(r.label) ? { label: str(r.label) } : {}) };
      break;
    default: {
      const text = str(r.text);
      out = { role, text: text ? emphasizeLine(clip(text)) : undefined };
    }
  }
  return Section.safeParse(out).success ? out : null;
}

const SECTION_SCHEMA: Schema = {
  type: 'object',
  properties: {
    role: { type: 'string', enum: ROLES.filter((r) => r !== 'endcard') },
    text: { type: 'string', description: 'text roles: the words shown, with *emphasis*' },
    date: { type: 'string', description: 'datetime: YYYY-MM-DD' },
    time: { type: 'string', description: 'datetime: HH:MM (24 h)' },
    place: { type: 'string' },
    city: { type: 'string' },
    title: { type: 'string', description: 'list: optional heading' },
    items: { type: 'array', items: { type: 'string' } },
    value: { type: 'number' },
    prefix: { type: 'string' },
    suffix: { type: 'string' },
    label: { type: 'string' },
    from: { type: 'string', description: 'countdown: posting date YYYY-MM-DD' },
    to: { type: 'string', description: 'countdown: target date YYYY-MM-DD' },
  },
  required: ['role'],
};

const SPLIT_SCHEMA: Schema = {
  type: 'object',
  properties: {
    language: { type: 'string', enum: ['he', 'en'] },
    contentType: { type: 'string', enum: CONTENT_TYPES },
    title: { type: 'string', description: 'short project title' },
    sections: { type: 'array', items: SECTION_SCHEMA },
  },
  required: ['language', 'contentType', 'title', 'sections'],
};

function splitPrompt(lang: Lang, today: Date): string {
  return [
    `You split pasted text into the sections of a 15–30 second kinetic-typography video (Instagram reel).`,
    `Write every section in ${LANG_NAME[lang]}, the language of the text. Never translate. Never invent facts.`,
    `Roles: title (always first, ≤ 6 words); text roles ${TEXT_ROLES.join(', ')}; datetime {date, time}; location {place, city};`,
    `list {title, items ≤ 10}; stat {value, prefix, suffix, label}; countdown {from, to, label}. Do not add an endcard (added for you).`,
    `Keep text sections short (≤ 6 words where possible): split longer sentences into several sections.`,
    `Mark the 1–2 most important words of every text section as *word* (asterisks).`,
    `Dates are ISO YYYY-MM-DD. Today is ${today.toISOString().slice(0, 10)}; a date without a year is its next occurrence. Times are HH:MM, 24 h.`,
    `The weekday is derived from the date: never write it. A line inviting people to act ("join", "come", "בואו") is a cta.`,
  ].join('\n');
}

export async function splitContent(
  req: { text: string; language?: Lang | undefined; contentType?: SplitResult['contentType'] | undefined; provider?: LlmProvider | 'rules' | undefined },
  o: { logos: string[]; today?: Date },
): Promise<SplitResult> {
  const today = o.today ?? new Date();
  const rules = (notes: string[] = []): SplitResult => {
    const r = splitRules(req.text, { language: req.language, contentType: req.contentType, logos: o.logos, today });
    return { ...r, provider: 'rules', notes: [...notes, ...r.notes] };
  };
  const provider = pick(req.provider);
  if (!provider) return rules(req.provider && req.provider !== 'rules' ? [`${req.provider} is not configured; used the offline splitter`] : []);
  const lang = req.language ?? detectLanguage(req.text);
  try {
    const raw = (await callJson(provider, {
      name: 'sections',
      system: splitPrompt(lang, today),
      prompt: `${req.contentType ? `Content type: ${req.contentType}.\n` : ''}Text:\n"""\n${req.text}\n"""`,
      schema: SPLIT_SCHEMA,
    })) as { language?: unknown; contentType?: unknown; title?: unknown; sections?: unknown };
    const notes: string[] = [];
    const sections: Record<string, unknown>[] = [];
    for (const [i, s] of (Array.isArray(raw.sections) ? raw.sections : []).entries()) {
      const fixed = repairSection(s, today);
      if (fixed) sections.push(fixed);
      else {
        const role = s && typeof s === 'object' && 'role' in s ? String(s.role) : 'role';
        if (role !== 'endcard') notes.push(`dropped section ${i + 1} (invalid ${role})`);
      }
    }
    const titleAt = sections.findIndex((s) => s.role === 'title');
    if (titleAt > 0) sections.unshift(...sections.splice(titleAt, 1));
    if (titleAt < 0) {
      const first = sections.findIndex((s) => typeof s.text === 'string');
      if (first >= 0) sections.unshift({ ...sections.splice(first, 1)[0]!, role: 'title' });
      else sections.unshift({ role: 'title', text: emphasizeLine(clip(str(raw.title) ?? req.text.split('\n')[0]!.trim())) });
    }
    if (sections.length < 2 && notes.length) throw new Error(notes.join('; '));
    sections.push({ role: 'endcard', logos: o.logos.slice(0, 4) });
    const language = raw.language === 'he' || raw.language === 'en' ? raw.language : lang;
    const contentType = req.contentType ?? ((CONTENT_TYPES as readonly unknown[]).includes(raw.contentType) ? (raw.contentType as SplitResult['contentType']) : 'event');
    const title = (str(raw.title) ?? plainText(String(sections[0]!.text ?? ''))).slice(0, 60);
    return { sections, language, contentType, title, provider, notes };
  } catch (e) {
    return rules([`${provider} failed (${(e as Error).message.slice(0, 160)}); used the offline splitter`]);
  }
}

export async function suggestEmphasis(req: { text: string; language?: Lang | undefined; provider?: LlmProvider | undefined }): Promise<EmphasisResult> {
  const provider = pick(req.provider);
  const base = req.text.replace(/\*/g, '');
  if (provider) {
    try {
      const raw = (await callJson(provider, {
        name: 'emphasis',
        system:
          `Mark the 1–2 most important words of each line of the user's ${LANG_NAME[req.language ?? detectLanguage(base)]} text ` +
          `with asterisks (*word*). Return the text otherwise unchanged: same words, same order, same line breaks.`,
        prompt: base,
        schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      })) as { text?: unknown };
      const text = typeof raw.text === 'string' ? raw.text : '';
      const norm = (s: string) => plainText(s).replace(/\s+/g, ' ').trim();
      if (text.includes('*') && norm(text) === norm(base)) return { text, provider };
    } catch {
      // fall through to the rules
    }
  }
  return { text: emphasizeText(base), provider: 'rules' };
}

export async function rankStyles(req: { brief: string; provider?: LlmProvider | undefined }): Promise<RankStylesResult> {
  const fallback = rankRules(req.brief);
  const provider = pick(req.provider);
  if (!provider || !req.brief.trim()) return { ranked: fallback, provider: 'rules' };
  const ids = Object.keys(RECIPES);
  try {
    const raw = (await callJson(provider, {
      name: 'ranking',
      system:
        'Rank video styles for a short event/announcement reel by how well they fit the brief. Scores 0..1, best first, ' +
        'one short reason each (in the brief’s language). Styles:\n' +
        Object.values(RECIPES)
          .map((r) => `- ${r.id}: ${r.name}; families ${r.families.join(', ')}; energy ${r.energy}/5; ${r.background} background`)
          .join('\n'),
      prompt: `Brief: ${req.brief}`,
      schema: {
        type: 'object',
        properties: {
          ranked: {
            type: 'array',
            items: {
              type: 'object',
              properties: { style: { type: 'string', enum: ids }, score: { type: 'number' }, reason: { type: 'string' } },
              required: ['style', 'score', 'reason'],
            },
          },
        },
        required: ['ranked'],
      },
    })) as { ranked?: unknown };
    const seen = new Set<string>();
    const ranked: RankStylesResult['ranked'] = [];
    for (const x of Array.isArray(raw.ranked) ? raw.ranked : []) {
      const r = x as { style?: unknown; score?: unknown; reason?: unknown };
      if (typeof r.style !== 'string' || !ids.includes(r.style) || seen.has(r.style)) continue;
      seen.add(r.style);
      const score = typeof r.score === 'number' && Number.isFinite(r.score) ? Math.min(1, Math.max(0, r.score)) : 0;
      ranked.push({ style: r.style, score, reason: typeof r.reason === 'string' ? r.reason.slice(0, 200) : '' });
    }
    if (!ranked.length) throw new Error('no valid styles');
    ranked.sort((a, b) => b.score - a.score);
    for (const f of fallback) if (!seen.has(f.style)) ranked.push({ ...f, score: Math.min(f.score, ranked.at(-1)!.score) });
    return { ranked, provider };
  } catch {
    return { ranked: fallback, provider: 'rules' };
  }
}
