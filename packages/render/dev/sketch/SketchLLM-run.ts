/**
 * P0 spike S1 harness: description → LLM strokes → parse → normalize → (line) joinToSingleLine → docs, table, sheets.
 *
 *   # live columns (skips a provider whose key is missing)
 *   node packages/render/dev/sketch/SketchLLM-run.ts --providers gemini,claude [--encoding strings|nested] [--variants 3]
 *   # the same pipeline over saved raw responses (one JSON per request, named <slug>-<mode>-d<detail>[-v<k>].json)
 *   node packages/render/dev/sketch/SketchLLM-run.ts --replay out/sketch/S1/stand-in-claude-agent/raw \
 *        --label "stand-in (agent-authored, not an API call)" --sheet stand-in
 *   # write the exact requests (system, prompt, schema) of the matrix, e.g. for a replay author
 *   node packages/render/dev/sketch/SketchLLM-run.ts --prompts out/sketch/S1/prompts
 *
 * Outputs: out/sketch/S1/<name>/<slug>-<mode>-d<detail>.sketch.json (line docs after the join), raw/ responses,
 * results.json + results.md; sheets out/dev/sketch-spikes/s1-<sheet>.png and s1-<sheet>-detail.png (+ -variants).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pointCount, problems, type SketchDoc } from './doc.ts';
import { type Cell, sheet } from './sheet.ts';
import { joinNearest, joinToSingleLine, normalize } from './SketchLLM-normalize.ts';
import {
  DETAIL_SUBJECTS,
  type Detail,
  type Encoding,
  encodeStrokes,
  type Mode,
  parseResponse,
  request,
  SUBJECTS,
  type Subject,
  tokenProxy,
} from './SketchLLM-prompt.ts';
import { callJson, hasKey, KEY, loadDotEnv, type Provider } from './SketchLLM-providers.ts';
import { drawOrderSvg, failedSvg, inkSvg } from './SketchLLM-view.ts';

const REPO = resolve(import.meta.dirname, '../../../..');
const VERSION = 's1-spike-1';
const TEMPERATURE = [0.7, 0.9, 1.0];

const { values: arg } = parseArgs({
  options: {
    providers: { type: 'string', default: 'gemini,claude' },
    replay: { type: 'string' },
    name: { type: 'string' },
    label: { type: 'string' },
    sheet: { type: 'string' },
    encoding: { type: 'string', default: 'strings' },
    variants: { type: 'string', default: '1' },
    subjects: { type: 'string' },
    prompts: { type: 'string' },
    out: { type: 'string', default: 'out/sketch/S1' },
    'max-tokens': { type: 'string', default: '16384' },
    concurrency: { type: 'string', default: '4' },
  },
});

const encoding = arg.encoding as Encoding;
if (encoding !== 'strings' && encoding !== 'nested') throw new Error(`--encoding strings|nested, got ${encoding}`);
const variants = Math.max(1, Math.min(3, Number(arg.variants)));
const outRoot = resolve(REPO, arg.out!);

interface Entry {
  subject: Subject;
  mode: Mode;
  detail: Detail;
  variant: number;
}

function matrix(): Entry[] {
  const only = arg.subjects?.split(',').map((s) => s.trim());
  const out: Entry[] = [];
  for (const subject of SUBJECTS) {
    if (only && !only.includes(subject.slug)) continue;
    const details: Detail[] = DETAIL_SUBJECTS.includes(subject.slug) ? [1, 3, 5] : [3];
    for (const mode of ['sketch', 'line'] as const)
      for (const detail of details) for (let variant = 0; variant < variants; variant++) out.push({ subject, mode, detail, variant });
  }
  return out;
}

const keyOf = (e: Entry): string => `${e.subject.slug}-${e.mode}-d${e.detail}${variants > 1 ? `-v${e.variant + 1}` : ''}`;
const reqOf = (e: Entry) => request(e.subject.description, e.mode, e.detail, encoding, e.variant, variants);

interface Row {
  key: string;
  subject: string;
  description: string;
  mode: Mode;
  detail: Detail;
  variant: number;
  latencyMs: number | null;
  outputTokens: number | null;
  responseChars: number | null;
  plan: string;
  rawStrokes: number;
  rawPoints: number;
  rawValid: boolean;
  rawIssues: string[];
  countInRange: boolean;
  finalValid: boolean;
  finalProblems: string[];
  finalStrokes: number;
  finalPoints: number;
  /** The same raw geometry written in each encoding (the `strokes` value only). */
  charsStrings: number | null;
  charsNested: number | null;
  tokProxyStrings: number | null;
  tokProxyNested: number | null;
  /** Sketch rows: share of the `joinToSingleLine(sketch)` length that is pen-down connector travel. */
  joinConnectorShare: number | null;
  /** Sketch rows: the same for `joinNearest(sketch)` (nearest-next order instead of drawing order). */
  nearestConnectorShare: number | null;
  error: string | null;
}

/** One model response, live or replayed. */
interface Got {
  raw: unknown;
  latencyMs: number | null;
  outputTokens: number | null;
  model: string;
}

interface Result {
  e: Entry;
  row: Row;
  doc: SketchDoc | null;
  /** Sketch rows: the same strokes joined into one line (the "line from sketch strokes" alternative). */
  joined: SketchDoc | null;
  /** Sketch rows: joined nearest-next instead of in drawing order. */
  nearest: SketchDoc | null;
}

interface Column {
  name: string;
  label: string;
  get: (e: Entry) => Promise<Got>;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 1)}\n`);
}

function inkLength(d: SketchDoc): number {
  let n = 0;
  for (const s of d.strokes) for (let i = 1; i < s.pts.length; i++) n += Math.hypot(s.pts[i]![0] - s.pts[i - 1]![0], s.pts[i]![1] - s.pts[i - 1]![1]);
  return n;
}

async function runOne(col: Column, e: Entry): Promise<Omit<Result, 'e'>> {
  const key = keyOf(e);
  const base = {
    key,
    subject: e.subject.slug,
    description: e.subject.description,
    mode: e.mode,
    detail: e.detail,
    variant: e.variant,
  };
  const empty: Row = {
    ...base,
    latencyMs: null,
    outputTokens: null,
    responseChars: null,
    plan: '',
    rawStrokes: 0,
    rawPoints: 0,
    rawValid: false,
    rawIssues: [],
    countInRange: false,
    finalValid: false,
    finalProblems: [],
    finalStrokes: 0,
    finalPoints: 0,
    charsStrings: null,
    charsNested: null,
    tokProxyStrings: null,
    tokProxyNested: null,
    joinConnectorShare: null,
    nearestConnectorShare: null,
    error: null,
  };
  let got: Got;
  try {
    got = await col.get(e);
  } catch (err) {
    return { row: { ...empty, error: (err as Error).message }, doc: null, joined: null, nearest: null };
  }
  const meta: SketchDoc['meta'] = {
    source: 'llm',
    prompt: e.subject.description,
    provider: col.name,
    model: got.model,
    detail: e.detail,
    seed: e.variant + 1,
    version: VERSION,
  };
  const parsed = parseResponse(got.raw, { encoding, mode: e.mode, detail: e.detail, meta });
  const row: Row = {
    ...empty,
    latencyMs: got.latencyMs,
    outputTokens: got.outputTokens,
    responseChars: JSON.stringify(got.raw).length,
    plan: parsed.plan,
    rawIssues: parsed.issues,
    rawValid: parsed.issues.length === 0,
    countInRange: parsed.countInRange,
  };
  if (!parsed.doc) return { row: { ...row, error: parsed.issues.join('; ') }, doc: null, joined: null, nearest: null };
  row.rawStrokes = parsed.doc.strokes.length;
  row.rawPoints = pointCount(parsed.doc);
  const strings = encodeStrokes(parsed.doc, 'strings');
  const nested = encodeStrokes(parsed.doc, 'nested');
  row.charsStrings = strings.length;
  row.charsNested = nested.length;
  row.tokProxyStrings = tokenProxy(strings);
  row.tokProxyNested = tokenProxy(nested);
  const norm = normalize(parsed.doc);
  const doc = e.mode === 'line' ? joinToSingleLine(norm) : norm;
  row.finalProblems = problems(doc);
  row.finalValid = row.finalProblems.length === 0;
  row.finalStrokes = doc.strokes.length;
  row.finalPoints = pointCount(doc);
  await writeJson(join(outRoot, col.name, `${key}.sketch.json`), doc);
  if (e.mode === 'line') return { row, doc, joined: null, nearest: null };
  const ink = inkLength(norm);
  const share = (line: SketchDoc): number | null => {
    const total = inkLength(line);
    return total > 0 ? Math.max(0, total - ink) / total : null;
  };
  const joined = joinToSingleLine(norm);
  const nearest = joinNearest(norm);
  row.joinConnectorShare = share(joined);
  row.nearestConnectorShare = share(nearest);
  await writeJson(join(outRoot, col.name, `${key}.joined.sketch.json`), joined);
  await writeJson(join(outRoot, col.name, `${key}.nearest.sketch.json`), nearest);
  return { row, doc, joined, nearest };
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

const yes = (b: boolean): string => (b ? 'yes' : '**no**');
const num = (n: number | null, d = 0): string => (n === null ? '–' : n.toFixed(d));
const pct = (label: string, share: number | null | undefined): string => (share == null ? '' : `${label ? `${label} ` : ''}${(share * 100).toFixed(0)} %`);

function median(xs: (number | null)[]): string {
  const v = xs.filter((x): x is number => x !== null).sort((a, b) => a - b);
  return v.length ? pct('', v[Math.floor(v.length / 2)]!) : 'n/a';
}

function table(rows: Row[]): string {
  const head =
    '| request | latency s | out tok | resp chars | strokes | points | valid raw | raw issues | in detail range | valid after normalize | final strokes / pts | chars str / nested | tok≈ str / nested | connectors: join / nearest |\n' +
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|';
  const body = rows.map((r) =>
    r.error && !r.rawStrokes
      ? `| ${r.key} | ${num(r.latencyMs === null ? null : r.latencyMs / 1000, 1)} | – | – | – | – | **no** | ${r.error.replace(/\|/g, '/')} | – | **no** | – | – | – | – |`
      : `| ${r.key} | ${num(r.latencyMs === null ? null : r.latencyMs / 1000, 1)} | ${num(r.outputTokens)} | ${num(r.responseChars)} | ${r.rawStrokes} | ${r.rawPoints} | ${yes(r.rawValid)} | ${r.rawIssues.join('; ') || '–'} | ${yes(r.countInRange)} | ${yes(r.finalValid)} | ${r.finalStrokes} / ${r.finalPoints} | ${r.charsStrings} / ${r.charsNested} | ${r.tokProxyStrings} / ${r.tokProxyNested} | ${r.joinConnectorShare === null ? '–' : `${pct('', r.joinConnectorShare)} / ${pct('', r.nearestConnectorShare)}`} |`,
  );
  return [head, ...body].join('\n');
}

function summary(rows: Row[]): string {
  const ok = rows.filter((r) => r.rawStrokes > 0);
  const sum = (f: (r: Row) => number | null): number => ok.reduce((n, r) => n + (f(r) ?? 0), 0);
  const cs = sum((r) => r.charsStrings);
  const cn = sum((r) => r.charsNested);
  const ts = sum((r) => r.tokProxyStrings);
  const tn = sum((r) => r.tokProxyNested);
  const lat = ok.map((r) => r.latencyMs).filter((n): n is number => n !== null).sort((a, b) => a - b);
  const med = lat.length ? lat[Math.floor(lat.length / 2)]! / 1000 : null;
  return [
    `- requests: ${rows.length}; errors: ${rows.filter((r) => r.error).length}`,
    `- valid as written: ${rows.filter((r) => r.rawValid).length}/${rows.length}; stroke/point count in the detail range: ${rows.filter((r) => r.countInRange).length}/${rows.length}`,
    `- valid after normalize (+ join for line): ${rows.filter((r) => r.finalValid).length}/${rows.length}`,
    `- latency median: ${med === null ? 'n/a' : `${med.toFixed(1)} s`}; max ${lat.length ? (lat.at(-1)! / 1000).toFixed(1) : 'n/a'} s`,
    `- sketch → one line, connector share of length (median): drawing order ${median(ok.map((r) => r.joinConnectorShare))}, nearest-next ${median(ok.map((r) => r.nearestConnectorShare))}`,
    `- encoding (same geometry): strings ${cs} chars / ≈${ts} tok, nested ${cn} chars / ≈${tn} tok → nested costs ×${cs ? (cn / cs).toFixed(2) : '–'} chars, ×${ts ? (tn / ts).toFixed(2) : '–'} tok`,
  ].join('\n');
}

async function sheets(col: Column, results: Result[]): Promise<void> {
  const sheetName = arg.sheet ?? col.name;
  const find = (slug: string, mode: Mode, detail: Detail, variant = 0) =>
    results.find((r) => r.e.subject.slug === slug && r.e.mode === mode && r.e.detail === detail && r.e.variant === variant);
  const art = (r: Result | undefined, view: (d: SketchDoc) => string): string =>
    r?.doc && r.doc.strokes.length ? view(r.doc) : failedSvg(r?.row.error ?? 'missing');
  const note = (r: Result | undefined): string =>
    r ? `${r.row.rawStrokes} strokes · ${r.row.rawPoints} pts${r.row.latencyMs === null ? '' : ` · ${(r.row.latencyMs / 1000).toFixed(1)} s`}${r.row.finalValid ? '' : ' · INVALID'}` : '';
  const slugs = [...new Set(results.map((r) => r.e.subject.slug))];
  const main: Cell[] = [];
  for (const slug of slugs) {
    const s = find(slug, 'sketch', 3);
    const l = find(slug, 'line', 3);
    const name = s?.e.subject.description ?? slug;
    main.push({ label: `${name} · sketch d3`, svg: art(s, inkSvg), note: note(s) });
    main.push({ label: `${name} · line d3 (joined)`, svg: art(l, inkSvg), note: note(l) });
    main.push({ label: `${name} · line at 50 %`, svg: art(l, (d) => drawOrderSvg(d, 0.5)), note: `${l?.row.finalPoints ?? 0} pts after join` });
    main.push({
      label: `${name} · sketch d3 → joinToSingleLine`,
      svg: s?.joined ? inkSvg(s.joined) : failedSvg('no sketch'),
      note: pct('connectors', s?.row.joinConnectorShare),
    });
    main.push({
      label: `${name} · sketch d3 → joinNearest`,
      svg: s?.nearest ? inkSvg(s.nearest) : failedSvg('no sketch'),
      note: pct('connectors', s?.row.nearestConnectorShare),
    });
  }
  const title = `S1 · ${col.label} · ${encoding} encoding`;
  const sheetDir = join(REPO, 'out/dev/sketch-spikes');
  console.log(await sheet(join(sheetDir, `s1-${sheetName}.png`), main, { cols: 5, cell: 220, title }));
  const detail: Cell[] = [];
  for (const slug of DETAIL_SUBJECTS.filter((s) => slugs.includes(s))) {
    for (const mode of ['sketch', 'line'] as const)
      for (const d of [1, 3, 5] as const) {
        const r = find(slug, mode, d);
        detail.push({ label: `${slug} · ${mode} d${d}`, svg: art(r, inkSvg), note: note(r) });
      }
    for (const d of [1, 3, 5] as const) {
      const r = find(slug, 'sketch', d);
      detail.push({ label: `${slug} · sketch d${d} → joinToSingleLine`, svg: r?.joined ? inkSvg(r.joined) : failedSvg('no sketch'), note: pct('connectors', r?.row.joinConnectorShare) });
    }
    for (const d of [1, 3, 5] as const) {
      const r = find(slug, 'sketch', d);
      detail.push({ label: `${slug} · sketch d${d} → joinNearest`, svg: r?.nearest ? inkSvg(r.nearest) : failedSvg('no sketch'), note: pct('connectors', r?.row.nearestConnectorShare) });
    }
  }
  if (detail.length) console.log(await sheet(join(sheetDir, `s1-${sheetName}-detail.png`), detail, { cols: 3, cell: 260, title: `${title} · detail 1 / 3 / 5` }));
  if (variants > 1) {
    const cells: Cell[] = [];
    for (const slug of slugs)
      for (const mode of ['sketch', 'line'] as const)
        for (let v = 0; v < variants; v++) {
          const r = find(slug, mode, 3, v);
          cells.push({ label: `${slug} · ${mode} d3 · v${v + 1}`, svg: art(r, inkSvg), note: note(r) });
        }
    console.log(await sheet(join(sheetDir, `s1-${sheetName}-variants.png`), cells, { cols: variants, cell: 260, title: `${title} · variants` }));
  }
}

async function runColumn(col: Column, concurrency: number): Promise<void> {
  const entries = matrix();
  console.log(`${col.label}: ${entries.length} requests`);
  const results = await pool(entries, concurrency, async (e) => {
    const r = await runOne(col, e);
    console.log(`  ${r.row.key}: ${r.row.error ?? `${r.row.rawStrokes} strokes, ${r.row.rawPoints} pts, raw ${r.row.rawValid ? 'valid' : `invalid (${r.row.rawIssues.join('; ')})`}, final ${r.row.finalValid ? 'valid' : r.row.finalProblems.join('; ')}`}`);
    return { e, ...r };
  });
  const rows = results.map((r) => r.row);
  await writeJson(join(outRoot, col.name, 'results.json'), { column: col.label, encoding, variants, version: VERSION, rows });
  const md = `# S1 · ${col.label}\n\nEncoding: ${encoding}. Generated by \`SketchLLM-run.ts\`.\n\n${summary(rows)}\n\n${table(rows)}\n`;
  await writeFile(join(outRoot, col.name, 'results.md'), md);
  console.log(summary(rows));
  await sheets(col, results);
}

async function main(): Promise<void> {
  if (arg.prompts) {
    const dir = resolve(REPO, arg.prompts);
    for (const e of matrix()) await writeJson(join(dir, `${keyOf(e)}.json`), reqOf(e));
    console.log(`wrote ${matrix().length} requests to ${dir}`);
    return;
  }
  if (arg.replay) {
    const dir = resolve(REPO, arg.replay);
    const name = arg.name ?? basename(basename(dir) === 'raw' ? dirname(dir) : dir);
    await runColumn(
      {
        name,
        label: arg.label ?? `replay of ${name}`,
        get: async (e) => ({
          raw: JSON.parse(await readFile(join(dir, `${keyOf(e)}.json`), 'utf8')) as unknown,
          latencyMs: null,
          outputTokens: null,
          model: name,
        }),
      },
      1,
    );
    return;
  }
  loadDotEnv();
  const providers = arg.providers!.split(',').map((p) => p.trim()) as Provider[];
  for (const p of providers) {
    if (p !== 'gemini' && p !== 'claude') throw new Error(`unknown provider ${p} (gemini, claude)`);
    if (!hasKey(p)) {
      console.log(`skip ${p}: ${KEY[p]} is not set (environment or ${join(REPO, '.env')})`);
      continue;
    }
    await runColumn(
      {
        name: p,
        label: p,
        get: async (e) => {
          const t0 = performance.now();
          const res = await callJson(p, reqOf(e), {
            maxTokens: Number(arg['max-tokens']),
            temperature: TEMPERATURE[e.variant] ?? 1,
            seed: e.variant + 1,
          });
          const latencyMs = performance.now() - t0;
          await writeJson(join(outRoot, p, 'raw', `${keyOf(e)}.json`), res.raw);
          return { raw: res.raw, latencyMs, outputTokens: res.outputTokens, model: res.model };
        },
      },
      Number(arg.concurrency),
    );
  }
}

await main();
