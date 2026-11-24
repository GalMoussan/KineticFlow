/**
 * Row typesetting shared by the planar-3D layouts (iso-blocks: one block per row; card-deck: rows on cards). A
 * section becomes rows by role (emphasis and numbers on rows of their own, plain words packed ≤ k per row); rows are
 * measured with `host.metrics` at base size 1 and placed ink-tight (the kinetic-quote recipe) in bidi visual order.
 */
import { visualOrder } from '@reel/runtime';
import type { Host, Metrics, Section, Unit } from '../contract.ts';

export interface Tok {
  u: Unit;
  wt: number;
}
export type Row = { kind: 'text'; f: number; toks: Tok[] } | { kind: 'badge'; f: number; u: Unit };
/** A fixed row, or a run of tokens packed ≤ k per row. */
export type Block = { kind: 'row'; row: Row } | { kind: 'pack'; f: number; toks: Tok[] };

/** Word gap inside a row and unit box padding around the ink, em of the row. */
export const GAP = 0.26;
const UNIT_PAD = 0.06;
const KEEP = 0.92;
const WIDE = 1.3;

/** Splits a run into ⌈m/k⌉ rows of near-equal length, longer rows first. */
export function pack(toks: Tok[], k: number, f: number): Row[] {
  const n = Math.ceil(toks.length / k);
  const base = Math.floor(toks.length / n);
  const extra = toks.length - base * n;
  const rows: Row[] = [];
  let i = 0;
  for (let r = 0; r < n; r++) {
    const len = base + (r < extra ? 1 : 0);
    rows.push({ kind: 'text', f, toks: toks.slice(i, i + len) });
    i += len;
  }
  return rows;
}

/** A section's rows by role (sizes f relative to the base size). Marks the title's last word as the hero. */
export function sectionBlocks(s: Section, plain = 0.72): Block[] {
  const content = s.units.filter((u) => u.item >= 0);
  const of = (...kinds: string[]) => content.filter((u) => kinds.includes(u.kind));
  const tok = (u: Unit, wt = 800): Tok => ({ u, wt });
  const row = (f: number, toks: Tok[]): Block => ({ kind: 'row', row: { kind: 'text', f, toks } });
  const out: Block[] = [];
  switch (s.role) {
    case 'title':
    case 'cta': {
      const ws = of('word');
      if (s.role === 'title' && ws.length) ws.at(-1)!.tags.hero = true;
      out.push({ kind: 'pack', f: 1, toks: ws.map((u) => tok(u)) });
      break;
    }
    case 'datetime':
      for (const u of content) out.push(row(u.kind === 'weekday' ? 0.55 : u.kind === 'date' ? 1 : 0.75, [tok(u, u.kind === 'weekday' ? 700 : 800)]));
      break;
    case 'location':
      out.push({ kind: 'pack', f: 0.9, toks: of('place').map((u) => tok(u)) });
      for (const u of of('city')) out.push(row(0.55, [tok(u, 700)]));
      break;
    case 'list':
      for (const u of of('list-title')) out.push(row(0.6, [tok(u, 700)]));
      for (const u of of('list-item')) out.push(row(plain, [tok(u)]));
      break;
    case 'stat':
    case 'countdown':
      for (const u of of('stat', 'countdown')) out.push(row(1.4, [tok(u)]));
      out.push({ kind: 'pack', f: 0.55, toks: of('word').map((u) => tok(u, 700)) });
      break;
    case 'endcard':
      out.push({ kind: 'pack', f: 0.75, toks: of('word').map((u) => tok(u)) });
      for (const u of of('logos')) out.push({ kind: 'row', row: { kind: 'badge', f: 1, u } });
      break;
    default: {
      let run: Tok[] = [];
      const flush = () => {
        if (run.length) out.push({ kind: 'pack', f: plain, toks: run });
        run = [];
      };
      for (const u of of('word')) {
        if (u.emphasis) {
          flush();
          out.push(row(1, [tok(u)]));
        } else run.push(tok(u));
      }
      flush();
    }
  }
  return out.filter((b) => b.kind === 'row' || b.toks.length);
}

/**
 * Rows for every k = 1…3 words per packed row; keeps the candidates whose size is ≥ 92 % of the best and takes the
 * fewest words per row (narrow frames) or the most (wide frames).
 */
export function bestRows(bs: Block[], sizeOf: (rows: Row[]) => number, wide: boolean): { rows: Row[]; size: number } {
  const maxK = Math.min(3, Math.max(1, ...bs.map((b) => (b.kind === 'pack' ? b.toks.length : 1))));
  const tries = Array.from({ length: maxK }, (_, i) => {
    const rows = bs.flatMap((b): Row[] => (b.kind === 'row' ? [b.row] : pack(b.toks, i + 1, b.f)));
    return { rows, size: sizeOf(rows) };
  });
  const best = Math.max(...tries.map((x) => x.size));
  const near = tries.filter((x) => x.size >= KEEP * best);
  return wide ? near.at(-1)! : near[0]!;
}

/** Whether a safe area counts as wide (rows of several words win). */
export const isWide = (host: Host) => host.safe.w > WIDE * host.safe.h;

/** Ink width, ascent and descent of a text row at base size 1 (already × f). */
export function inkDims(host: Host, r: Row & { kind: 'text' }): { ink: number; ia: number; id: number } {
  const ms = r.toks.map((t) => host.metrics(t.u.text, t.wt, t.u.ltr));
  return {
    ink: (ms.reduce((a, m) => a + m.bl + m.br, 0) + GAP * (r.toks.length - 1)) * r.f,
    ia: Math.max(...ms.map((m) => m.ia)) * r.f,
    id: Math.max(...ms.map((m) => m.id)) * r.f,
  };
}

/**
 * Places a text row's units ink-tight, centred on x = cx with the baseline at `base` (group px), at base size S, in
 * bidi visual order. Sets box, font, textAt, inkBox, baseline, innerOrigin and `tags.line`.
 */
export function placeRow(host: Host, s: Section, r: Row & { kind: 'text' }, S: number, cx: number, base: number, line: number): void {
  const Sr = S * r.f;
  const d = inkDims(host, r);
  let x = cx - (d.ink * S) / 2;
  const order = visualOrder(r.toks.map((t) => t.u.text), s.dir);
  for (const t of order.map((i) => r.toks[i]!)) {
    const m: Metrics = host.metrics(t.u.text, t.wt, t.u.ltr);
    const inkW = (m.bl + m.br) * Sr;
    const gx = x;
    x += inkW + GAP * Sr;
    const u = t.u;
    u.tags.line = line;
    const box = { x: gx - UNIT_PAD * Sr, y: base - m.ia * Sr - UNIT_PAD * Sr, w: inkW + 2 * UNIT_PAD * Sr, h: (m.ia + m.id + 2 * UNIT_PAD) * Sr };
    const mid = Sr / 2 + ((m.fa - m.fd) * Sr) / 2;
    const inkBox = { x: -m.bl * Sr, y: -m.ia * Sr + mid, w: inkW, h: (m.ia + m.id) * Sr };
    Object.assign(u, {
      box,
      baseline: base,
      font: { family: 'display', size: Sr, weight: t.wt },
      textAt: { x: gx + m.bl * Sr - box.x, y: base - mid - box.y },
      inkBox,
      innerOrigin: `${(inkBox.x + inkW / 2).toFixed(2)}px ${(inkBox.y + inkBox.h / 2).toFixed(2)}px`,
    });
  }
}
