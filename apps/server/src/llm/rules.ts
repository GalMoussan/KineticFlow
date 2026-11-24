/**
 * Offline content helpers (always available, no keys): the rule-based splitter, emphasis picker and style ranker.
 * The LLM providers fall back to these, and their output is repaired with the same section rules.
 */
import type { RankStylesResult, SplitResult } from '@reel/api';
import { plainText, type Section } from '@reel/core';
import { RECIPES } from '@reel/styles';

type Lang = 'he' | 'en';
type ContentType = SplitResult['contentType'];
/** A section draft as the UI receives it (before `JobSpec` parsing). */
export type Draft = Record<string, unknown> & { role: Section['role'] };

export interface SplitDraft extends Omit<SplitResult, 'provider' | 'sections'> {
  sections: Draft[];
}

const TEXT_MAX = 200;
const LIST_MAX = 10;
/** Lines longer than this are split into sentences (styles show 5–6 words per section). */
const LONG_LINE_WORDS = 10;

export function detectLanguage(text: string): Lang {
  const he = text.match(/[\u05D0-\u05EA]/g)?.length ?? 0;
  const en = text.match(/[A-Za-z]/g)?.length ?? 0;
  return he >= en && he > 0 ? 'he' : 'en';
}

// ───────────────────────────── dates and times ─────────────────────────────

const HE_MONTHS = ['ינואר', 'פברואר', 'מרץ|מרס', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const EN_MONTHS = ['jan(?:uary)?', 'feb(?:ruary)?', 'mar(?:ch)?', 'apr(?:il)?', 'may', 'june?', 'july?', 'aug(?:ust)?', 'sep(?:t(?:ember)?)?', 'oct(?:ober)?', 'nov(?:ember)?', 'dec(?:ember)?'];
const monthIndex = (word: string, table: string[]) => table.findIndex((re) => new RegExp(`^(?:${re})$`, 'i').test(word)) + 1;
const HE_MONTH_RE = HE_MONTHS.join('|');
const EN_MONTH_RE = EN_MONTHS.join('|');

interface Found {
  date?: string;
  time?: string;
  /** The line with the date/time text removed. */
  rest: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO date; a missing year is the next occurrence on or after `today`. */
function isoDate(d: number, m: number, y: number | undefined, today: Date): string | undefined {
  if (m < 1 || m > 12 || d < 1 || d > 31) return undefined;
  let year = y === undefined ? today.getUTCFullYear() : y < 100 ? 2000 + y : y;
  const valid = (yy: number) => new Date(Date.UTC(yy, m - 1, d)).getUTCDate() === d;
  if (y === undefined) {
    const t0 = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    if (Date.UTC(year, m - 1, d) < t0) year++;
  }
  return valid(year) ? `${year}-${pad(m)}-${pad(d)}` : undefined;
}

/** Finds the first date and time in a line (dd.mm(.yyyy), dd/mm, ISO, Hebrew and English month names, HH:MM, 7pm). */
export function findDateTime(line: string, today: Date): Found {
  let rest = line;
  let date: string | undefined;
  const tryDate = (re: RegExp, parts: (m: RegExpExecArray) => [number, number, number | undefined] | null) => {
    if (date) return;
    const m = re.exec(rest);
    if (!m) return;
    const p = parts(m);
    const iso = p && isoDate(p[0], p[1], p[2], today);
    if (iso) {
      date = iso;
      rest = rest.slice(0, m.index) + ' ' + rest.slice(m.index + m[0].length);
    }
  };
  tryDate(/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/, (m) => [Number(m[3]), Number(m[2]), Number(m[1])]);
  tryDate(/(?<![\d:.\/])(\d{1,2})[./](\d{1,2})(?:[./](\d{4}|\d{2}))?(?![\d:]|\.\d)/, (m) => [Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : undefined]);
  tryDate(new RegExp(`(?<!\\d)(\\d{1,2})\\s*(?:ב|ל)?-?(${HE_MONTH_RE})(?:\\s+(\\d{4}))?`), (m) => [Number(m[1]), monthIndex(m[2]!, HE_MONTHS), m[3] ? Number(m[3]) : undefined]);
  tryDate(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${EN_MONTH_RE})\\.?(?:,?\\s+(\\d{4}))?\\b`, 'i'), (m) => [Number(m[1]), monthIndex(m[2]!, EN_MONTHS), m[3] ? Number(m[3]) : undefined]);
  tryDate(new RegExp(`\\b(${EN_MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'i'), (m) => [Number(m[2]), monthIndex(m[1]!, EN_MONTHS), m[3] ? Number(m[3]) : undefined]);

  let time: string | undefined;
  const hm = /(?<![\d:])([01]?\d|2[0-3]):([0-5]\d)(?:\s*(am|pm))?(?![\d:])/i.exec(rest);
  const ampm = hm ? null : /\b(1[0-2]|0?[1-9])(?:[:.]([0-5]\d))?\s*(am|pm)\b/i.exec(rest);
  const t = hm ?? ampm;
  if (t) {
    let h = Number(t[1]);
    const suffix = t[3]?.toLowerCase();
    if (suffix === 'pm' && h < 12) h += 12;
    if (suffix === 'am' && h === 12) h = 0;
    time = `${pad(h)}:${t[2] ?? '00'}`;
    rest = rest.slice(0, t.index) + ' ' + rest.slice(t.index + t[0].length);
  }
  return { ...(date ? { date } : {}), ...(time ? { time } : {}), rest };
}

/** Words that carry no content once the date/time is gone. */
const FILLER_RE =
  /(?:^|\s)(?:ב?יום|ה?שעה|בשעה|ב?תאריך|מתי|מ-?|עד|ב-|ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת|ה?ערב|ה?בוקר|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|on|from|to|time|date|when|starting|starts|doors|until|the)(?=\s|$|[,.:;!?])/giu;

function stripFillers(s: string): string {
  return s.replace(/[|•·–—:;,()]/g, ' ').replace(FILLER_RE, ' ').replace(/\s+/g, ' ').trim();
}

// ───────────────────────────── locations ─────────────────────────────

const HE_VENUES = 'בית|מועדון|פאב|קפה|מרכז|אולם|ספריית|ספרייה|גן|פארק|רחוב|בר|מתנ"ס|מתנ״ס|היכל|תיאטרון|סטודיו|גלריה|חוף|כיכר|מסעדת|מסעדה|קיבוץ|מושב|אודיטוריום|חאן';
const LOCATION_MARKER = /^(?:📍|@|at\s+|where\s*[:\-]|location\s*[:\-]|venue\s*[:\-]|address\s*[:\-]|מיקום\s*[:\-]|איפה\s*[:\-?]|מקום\s*[:\-]|כתובת\s*[:\-])\s*/iu;
const HE_VENUE_LINE = new RegExp(`^(?:ב(?:${HE_VENUES})|בית)\\s`, 'u');

/** `place, city` → both; a Hebrew `ב` prefix on a venue word is dropped (`בבית החאן` → `בית החאן`). */
function locationSection(text: string): Draft | null {
  let s = text.replace(LOCATION_MARKER, '').trim();
  if (/^ב/.test(s) && new RegExp(`^ב(?:${HE_VENUES})`, 'u').test(s)) s = s.slice(1);
  else if (/^ב[\u05D0-\u05EA]{2,}/.test(s) && !/^בית\s/.test(s) && s.split(/\s+/).length <= 4) s = s.slice(1);
  s = s.replace(/^at\s+/i, '').trim();
  if (!s) return null;
  const parts = s.split(/\s*[,،]\s*|\s+[-–]\s+/).filter(Boolean);
  const place = clip(parts.length > 1 ? parts.slice(0, -1).join(', ') : parts[0]!);
  const city = parts.length > 1 ? clip(parts.at(-1)!) : undefined;
  return { role: 'location', place, ...(city && city.split(/\s+/).length <= 3 ? { city } : {}) };
}

function isLocationLine(line: string): boolean {
  return LOCATION_MARKER.test(line) || (HE_VENUE_LINE.test(line) && line.split(/\s+/).length <= 6 && !/[!?]$/.test(line));
}

// ───────────────────────────── emphasis ─────────────────────────────

const STOP = new Set(
  (
    'את של על עם זה זו זאת הוא היא הם הן אני אנחנו אתם כל גם או אם לא כן יש אין הכי מה מי איך למה כי אבל רק עוד כמו בין אל לכם לנו ' +
    'שלנו שלכם הזה הזאת אצל עד מאוד יותר פה שם ' +
    'the a an and or of to in on at for with is are be we you our your it its this that from by as will can all more most very'
  ).split(' '),
);
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const graphemes = (s: string) => [...segmenter.segment(s)].length;
/** A token's word core: leading/trailing punctuation removed. */
const core = (token: string) => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

/**
 * Marks the most distinctive word(s) of one line with `*…*`: the longest non-stop word (later wins ties), plus the
 * second longest when the line has 6+ words. Lines that already carry emphasis are kept.
 */
export function emphasizeLine(line: string): string {
  if (/\*[^*\s][^*]*\*/.test(line)) return line;
  const tokens = line.split(/(\s+)/);
  const words = tokens.map((t, i) => ({ i, core: core(t) })).filter((w) => w.i % 2 === 0 && w.core);
  const scored = words
    .filter((w) => !STOP.has(w.core.toLowerCase()) && !/^\d/.test(w.core))
    .map((w) => ({ ...w, score: graphemes(w.core) + (w.core.length > 1 && w.core === w.core.toUpperCase() && /[A-Z]/.test(w.core) ? 2 : 0) }));
  if (!scored.length) return line;
  const picks = [...scored].sort((a, b) => b.score - a.score || b.i - a.i).slice(0, words.length >= 6 ? 2 : 1);
  for (const p of picks) {
    const t = tokens[p.i]!;
    const at = t.indexOf(p.core);
    tokens[p.i] = `${t.slice(0, at)}*${p.core}*${t.slice(at + p.core.length)}`;
  }
  return tokens.join('');
}

/** `emphasizeLine` per line. */
export function emphasizeText(text: string): string {
  return text
    .split('\n')
    .map((l) => emphasizeLine(l))
    .join('\n');
}

// ───────────────────────────── splitter ─────────────────────────────

function clip(s: string): string {
  const t = s.trim();
  if (t.length <= TEXT_MAX) return t;
  const cut = t.slice(0, TEXT_MAX - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 40)).trim()}…`;
}

const BULLET = /^\s*(?:[-–•▪●·]|\*(?=\s)|\d{1,2}[.)])\s+/;
const CTA = /(?:בואו|בואי|הצטרפו|הירשמו|הרשמה|לפרטים|מחכים\s+לכם|\bjoin\b|\bcome\b|\bregister\b|sign\s+up|\brsvp\b|\btickets?\b|\bbook\s+now\b|see\s+you)/iu;
const STAT = /^([^\d\s\p{L}]{1,3})?\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(%|\+|k\+?|K\+?|M\+?)?\s+(\D.{1,60})$/u;
const EMOJI = /[\p{Extended_Pictographic}\uFE0F\u200D\u20E3]/gu;

function sentences(line: string): string[] {
  if (line.split(/\s+/).length <= LONG_LINE_WORDS) return [line];
  const parts = line.split(/(?<=[.!?…])\s+/).filter(Boolean);
  return parts.flatMap((p) => {
    if (p.split(/\s+/).length <= LONG_LINE_WORDS + 4) return [p];
    return p.split(/(?<=[,;])\s+/).filter(Boolean);
  });
}

export interface SplitOptions {
  language?: Lang | undefined;
  contentType?: ContentType | undefined;
  /** End card logos (the brand kit's). */
  logos?: string[] | undefined;
  /** "Now" for years of dates without one (tests pin it). */
  today?: Date | undefined;
}

/** Rule-based `splitContent`: pasted text → sections ready for `spec.sections`. */
export function splitRules(input: string, o: SplitOptions = {}): SplitDraft {
  const today = o.today ?? new Date();
  const notes: string[] = [];
  const cleaned = input.replace(EMOJI, '');
  if (cleaned !== input) notes.push('emoji removed (the fonts cannot draw them)');
  const language = o.language ?? detectLanguage(cleaned);
  const lines = cleaned
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l && /[\p{L}\p{N}]/u.test(l));

  const out: Draft[] = [];
  let datetime: Draft | null = null;
  let list: { title?: string; items: string[] } | null = null;
  let textCount = 0;
  const flushList = () => {
    if (!list) return;
    for (let i = 0; i < list.items.length; i += LIST_MAX) {
      const items = list.items.slice(i, i + LIST_MAX).map(clip);
      out.push({ role: 'list', ...(i === 0 && list.title ? { title: clip(list.title) } : {}), items });
    }
    list = null;
  };
  const pushText = (text: string) => {
    const t = clip(text);
    if (!t) return;
    const role: Draft['role'] = !out.some((s) => s.role === 'title')
      ? 'title'
      : /[?？]$/.test(t)
        ? 'question'
        : CTA.test(t) || (/!$/.test(t) && textCount !== 1)
          ? 'cta'
          : textCount === 1
            ? 'tagline'
            : 'body';
    out.push({ role, text: emphasizeLine(t) });
    textCount++;
  };

  for (const [n, raw] of lines.entries()) {
    // bullets (or, for list content, plain lines) → one list section (a preceding "…:" line is its title)
    const when = o.contentType === 'list' ? findDateTime(raw, today) : null;
    const plainItem = !!when && !when.date && !when.time && !CTA.test(raw);
    if (n > 0 && (BULLET.test(raw) || plainItem)) {
      const item = raw.replace(BULLET, '').trim();
      if (!list) {
        const prev = out.at(-1);
        const title = prev && 'text' in prev && typeof prev.text === 'string' && /:$/.test(plainText(prev.text)) ? out.pop() : undefined;
        if (title) textCount--;
        list = { ...(title ? { title: plainText(String(title.text)).replace(/:$/, '') } : {}), items: [] };
      }
      list.items.push(item);
      continue;
    }
    flushList();
    const line = raw.replace(BULLET, '');
    if (n === 0) {
      pushText(line);
      continue;
    }

    // date / time (merged into one datetime section; leftovers become a location or text)
    const found = findDateTime(line, today);
    if (found.date || found.time) {
      if (found.date && datetime && !datetime.date) datetime.date = found.date;
      if (!datetime && found.date) {
        datetime = { role: 'datetime', date: found.date };
        out.push(datetime);
      }
      if (found.time) {
        if (datetime && !datetime.time) datetime.time = found.time;
        else if (!datetime) notes.push(`time ${found.time} has no date; add the date to show it`);
      }
      const rest = stripFillers(found.rest);
      if (rest && /[\p{L}]{2,}/u.test(rest)) {
        const atVenue = /^(?:@|at\s)/i.test(rest) || (language === 'he' && /^ב[\u05D0-\u05EA]{2,}/.test(rest) && rest.split(/\s+/).length <= 5);
        const loc = atVenue ? locationSection(rest) : null;
        if (loc && !out.some((s) => s.role === 'location')) out.push(loc);
        else if (rest.split(/\s+/).length >= 3) for (const s of sentences(rest)) pushText(s);
      }
      continue;
    }

    if (isLocationLine(line)) {
      const loc = locationSection(line);
      if (loc) {
        out.push(loc);
        continue;
      }
    }

    const stat = STAT.exec(line);
    if (stat && line.split(/\s+/).length <= 6 && (stat[1] ?? '').length <= 4 && (stat[3] ?? '').length <= 4) {
      out.push({
        role: 'stat',
        value: Number(stat[2]!.replace(/,/g, '')),
        ...(stat[1] ? { prefix: stat[1] } : {}),
        ...(stat[3] ? { suffix: stat[3] } : {}),
        label: clip(stat[4]!),
      });
      continue;
    }

    for (const s of sentences(line)) pushText(s);
  }
  flushList();

  if (!out.some((s) => s.role === 'title')) out.unshift({ role: 'title', text: language === 'he' ? 'כותרת' : 'Title' });
  out.push({ role: 'endcard', logos: (o.logos ?? []).slice(0, 4) });

  const roles = out.map((s) => s.role);
  const contentType: ContentType =
    o.contentType ??
    (roles.includes('datetime') || roles.includes('location')
      ? 'event'
      : roles.filter((r) => r === 'stat').length >= 2
        ? 'stats'
        : roles.includes('list')
          ? 'list'
          : 'story');
  const titleSection = out.find((s) => s.role === 'title');
  const title = plainText(String(titleSection?.text ?? '')).slice(0, 60);
  return { sections: out, language, contentType, title, notes };
}

// ───────────────────────────── style ranking ─────────────────────────────

/** Brief keywords per style (English + Hebrew stems) and the energy they suggest. */
const STYLE_WORDS: Record<string, string[]> = {
  'kinetic-quote': ['quote', 'story', 'warm', 'cozy', 'calm', 'cafe', 'coffee', 'playful', 'talk', 'debate', 'book', 'poetry', 'lofi', 'ציטוט', 'סיפור', 'חם', 'חמים', 'רגוע', 'קפה', 'שיח', 'דילמ', 'שיר', 'ספר', 'הרצא'],
  'swiss-title-reveal': ['clean', 'minimal', 'design', 'professional', 'conference', 'lecture', 'bold', 'modern', 'announcement', 'launch', 'workshop', 'נקי', 'מינימל', 'עיצוב', 'מקצועי', 'כנס', 'סדנ', 'השקה', 'הכרזה'],
  'neon-psychedelic': ['party', 'night', 'neon', 'rave', 'wild', 'festival', 'psychedelic', 'crazy', 'glow', 'celebration', 'מסיב', 'לילה', 'ניאון', 'פסטיבל', 'פרוע', 'חגיג', 'זוהר'],
  'bass-pulse': ['music', 'bass', 'dj', 'club', 'beat', 'dance', 'techno', 'house', 'energy', 'concert', 'jam', 'gig', 'מוזיק', 'בס', 'די ג', 'דיג', 'ריקוד', 'טכנו', 'אנרגי', 'הופע', 'ג׳אם', "ג'אם"],
  'word-per-beat': ['one word', 'punchy', 'hype', 'drop', 'trailer', 'promo', 'מילה אחת', 'טריילר', 'פרומו'],
  brutalist: ['brutal', 'loud', 'statement', 'manifesto', 'protest', 'gallery', 'ברוטאל', 'גולמי', 'מניפסט', 'מחאה', 'גלרי'],
  'sticker-pop': ['sticker', 'fun', 'kids', 'cute', 'birthday', 'sale', 'מדבק', 'כיף', 'ילדים', 'חמוד', 'יום הולדת', 'מבצע'],
  'equalizer-type': ['equalizer', 'audio', 'podcast', 'radio', 'sound', 'spectrum', 'פודקאסט', 'רדיו', 'סאונד', 'אקולייזר'],
  'lyric-karaoke': ['lyric', 'karaoke', 'song', 'singalong', 'choir', 'מילים לשיר', 'קריוקי', 'שירה', 'מקהל'],
  'typewriter-terminal': ['code', 'hack', 'developer', 'terminal', 'startup', 'קוד', 'האקתון', 'הייטק', 'מפתח', 'סטארט'],
  'mask-slide': ['simple', 'elegant', 'corporate', 'business', 'readable', 'פשוט', 'עסקי', 'קריא', 'תאגיד'],
  'split-flap': ['travel', 'departure', 'airport', 'train', 'schedule', 'board', 'טיסה', 'נסיע', 'רכבת', 'לוח זמנים', 'המראה'],
  'scramble-decode': ['decode', 'secret', 'mystery', 'reveal', 'cyber', 'glitch', 'סוד', 'מסתורי', 'חשיפה', 'סייבר'],
  'grid-reflow': ['grid', 'swiss', 'editorial', 'architecture', 'typography', 'גריד', 'אדריכל', 'טיפוגרפ'],
  bento: ['bento', 'features', 'product', 'overview', 'dashboard', 'מוצר', 'פיצ׳ר', 'אפליקצי', 'סקירה'],
  'versus-split': ['versus', 'vs', 'compare', 'battle', 'match', 'dilemma', 'מול', 'השוואה', 'קרב', 'משחק', 'דילמה'],
  'fluid-scale': ['big type', 'headline', 'magazine', 'fashion', 'כותר', 'מגזין', 'אופנה'],
  'elastic-stretch': ['bouncy', 'elastic', 'kids', 'toy', 'jelly', 'קופצני', 'גמיש', 'צעצוע', 'ג׳לי'],
  'liquid-morph': ['liquid', 'water', 'flow', 'organic', 'spa', 'wellness', 'נוזל', 'מים', 'זרימה', 'אורגני', 'ספא', 'בריאות'],
  'glyph-morph': ['morph', 'transform', 'change', 'evolve', 'letters', 'שינוי', 'מורף', 'אותיות', 'מתחלף'],
  'shape-to-type': ['shapes', 'geometric', 'circle', 'logo', 'brand', 'צורות', 'גאומטרי', 'עיגול', 'מותג'],
  'extrude-3d': ['3d', 'epic', 'cinematic', 'gaming', 'תלת', 'אפי', 'קולנוע', 'גיימינג'],
  'z-tunnel': ['tunnel', 'space', 'speed', 'fly', 'future', 'journey', 'מנהרה', 'חלל', 'מהירות', 'עתיד', 'מסע'],
  'isometric-blocks': ['isometric', 'blocks', 'build', 'construction', 'lego', 'איזומטר', 'קוביות', 'בנייה', 'לגו'],
  'card-deck-3d': ['cards', 'questions', 'quiz', 'trivia', 'tips', 'list', 'קלפים', 'שאלות', 'חידון', 'טריוויה', 'טיפים'],
  'weight-wave': ['weight wave', 'variable weight', 'type specimen', 'letterpress', 'bold wave', 'משקל', 'גל אותיות', 'פונט משתנה', 'דוגמת אות'],
  'width-breath': ['breathe', 'breathing', 'condensed', 'width axis', 'calm type', 'sea mist', 'נשימה', 'רוחב אות', 'נושם', 'מרווח'],
  'particle-assemble': ['particles', 'assemble', 'dust swarm', 'sparks', 'form the words', 'חלקיקים', 'מתאספים', 'אבק זוהר', 'ניצוצות'],
  'flow-field': ['flow field', 'streamline', 'ocean current', 'drift', 'organic type', 'שדה זרימה', 'קווי זרם', 'נסחף', 'זרם'],
  'glitch-digital': ['datamosh', 'rgb split', 'stutter', 'digital glitch', 'corruption', 'slice displacement', 'גליץ', 'שיבוש דיגיטלי', 'פיקסלים', 'תקלה'],
  'minimal-luxe': ['luxe', 'luxury', 'hairline', 'refined', 'negative space', 'serif', 'יוקרה', 'מעודן', 'קו דק', 'זהב'],
  'functional-clean': ['functional', 'accessible', 'clarity', 'legible', 'straightforward', 'נגיש', 'בהירות', 'פונקציונלי', 'קריאות', 'ברור'],
  'stat-counter': ['statistic', 'metrics', 'percentage', 'infographic', 'growth', 'counter', 'סטטיסטיקה', 'אחוזים', 'נתונים', 'צמיחה', 'מונה'],
  countdown: ['countdown', 'timer', 'ticking', 'deadline', 'ספירה', 'טיימר', 'לאחור', 'דדליין'],
  'dilemma-reveal': ['dilemma', 'choice', 'options', 'tension', 'decision', 'בחירה', 'אפשרויות', 'החלטה', 'מתח'],
  'chrome-liquid': ['chrome', 'metallic', 'sheen', 'mercury', 'reflective', 'כרום', 'מתכתי', 'ברק', 'נוזל מתכת'],
  'retro-80s': ['retro', 'synthwave', 'outrun', 'eighties', 'vhs', 'sunset grid', 'רטרו', 'סינת', 'אייטיז', 'שקיעה'],
  risograph: ['risograph', 'halftone', 'misregistration', 'newsprint', 'spot color', 'ריזוגרף', 'הדפס', 'רשת הדפס', 'חצי טון'],
  'chat-bubbles': ['messenger', 'whatsapp', 'texting', 'chat', 'argument', 'reply', 'unread', 'conversation', 'הודעות', 'וואטסאפ', 'ויכוח', 'בועות', 'צאט'],
  'list-stack': ['numbered', 'ranking', 'leaderboard', 'top ten', 'stack', 'podium', 'דירוג', 'רשימה', 'מדורג', 'מקום ראשון'],
  'chalkboard-cafe': ['chalkboard', 'chalk', 'menu board', 'slate', 'dusty', 'גיר', 'לוח גיר', 'תפריט', 'מחיקה', 'אבק גיר'],
  'cutout-collage': ['ransom', 'collage', 'cutout', 'scrapbook', 'tape', 'magazine letters', 'כופר', 'גזירים', 'קולאז', 'סלוטייפ'],
  'coffee-steam': ['coffee', 'steam', 'latte', 'espresso', 'foam', 'cappuccino', 'wisps', 'קפה', 'אדים', 'לאטה', 'קצף', 'אספרסו'],
  'y2k-bubble': ['y2k', 'sparkle', 'candy', 'iridescent', 'bubblegum', 'fredoka', 'gradient letters', 'נצנצים', 'ממתק', 'בועת', 'הולוגרפי'],
  'stacked-scroll': ['stacked scroll', 'repeat the line', 'speed ramp', 'lyrics', 'chorus', 'הדהוד', 'גלילה', 'חוזר על עצמו', 'סטאק'],
  'credits-roll': ['credits', 'end credits', 'film', 'cinema', 'closing titles', 'כתוביות', 'סיום', 'קרדיט', 'סרט'],
  'ticker-bands': ['ticker', 'marquee', 'breaking', 'headline', 'newsroom', 'מבזק', 'כותרות', 'רצועת חדשות'],
  'infinite-zoom': ['infinite zoom', 'droste', 'nested frames', 'fractal zoom', 'זום אינסופי', 'מקונן', 'מסגרות'],
  'paper-fold': ['paper fold', 'origami', 'unfold', 'greeting card', 'נייר', 'קיפול', 'אוריגמי', 'גלויה'],
  'editorial-magazine': ['magazine', 'editorial', 'drop cap', 'folio', 'newsprint', 'pull quote', 'columns', 'מגזין', 'כתבה', 'שער', 'טור'],
  'tile-mosaic': ['mosaic', 'letterboard', 'tiles flip', 'ripple tiles', 'פסיפס', 'אריחים', 'לוח אותיות'],
  'ribbon-path': ['ribbon', 'flowing ribbon', 'swoosh', 'סרט זורם', 'אותיות על סרט'],
  'orbit-ring': ['orbital rings', 'circling type', 'rings of type', 'מסלול', 'טבעות', 'סובב'],
  'map-route': ['map route', 'venue pin', 'directions', 'streets', 'ניווט', 'מפה', 'מסלול נסיעה'],
};
const HIGH = ['party', 'energy', 'energetic', 'wild', 'loud', 'hype', 'dance', 'festival', 'crazy', 'אנרגי', 'מסיב', 'פרוע', 'סוער', 'קצב'];
const LOW = ['calm', 'warm', 'cozy', 'quiet', 'relaxed', 'soft', 'gentle', 'elegant', 'רגוע', 'שקט', 'חמים', 'נעים', 'עדין', 'אלגנט'];

/** Keyword + energy matching of the brief against every catalog style; scores in 0..1, best first. */
export function rankRules(brief: string): RankStylesResult['ranked'] {
  const text = brief.toLowerCase();
  const hits = (words: string[]) => words.filter((w) => text.includes(w.toLowerCase()));
  const high = hits(HIGH).length;
  const low = hits(LOW).length;
  const target = high > low ? 5 : low > high ? 2 : 3;
  const ranked = Object.values(RECIPES).map((r) => {
    const kw = hits(STYLE_WORDS[r.id] ?? []);
    const family = r.families.filter((f) => text.includes(f.replace('-', ' ')));
    const energyFit = 1 - Math.abs(r.energy - target) / 4;
    const score = Math.min(1, 0.6 * Math.min(1, kw.length / 2) + 0.3 * energyFit + 0.1 * Math.min(1, family.length));
    const why = [
      kw.length ? `matches “${kw.slice(0, 3).join('”, “')}”` : '',
      `energy ${r.energy}/5 ${energyFit >= 0.75 ? 'fits' : 'vs'} a ${target >= 4 ? 'lively' : target <= 2 ? 'calm' : 'medium'} brief`,
    ].filter(Boolean);
    return { style: r.id, score: Math.round(score * 100) / 100, reason: why.join('; ') };
  });
  return ranked.sort((a, b) => b.score - a.score || a.style.localeCompare(b.style));
}
