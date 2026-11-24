/**
 * The grid solver of `layout: grid-reflow` (pure, unit-tested in `solve.test.ts`): splits a run of units into grid
 * lines (consecutive units, ≤ `per` per line), gives each line a number of module rows and each unit a number of
 * module columns (every line uses all columns), maximising Σ weight · ln(font size). Ties keep the first candidate
 * in enumeration order, so the result is deterministic.
 */

export interface GridItem {
  /** Ink width / height per px of font size. */
  w1: number;
  h1: number;
  /** Importance: hero/emphasis > plain > short function words. */
  weight: number;
  /** Extra top inset inside its span (a module rule), px. */
  top: number;
}

export interface GridSpec {
  cols: number;
  rows: number;
  /** Module width / height, gutter and inner padding of a span. */
  cw: number;
  rh: number;
  g: number;
  pad: number;
}

export interface GridLine {
  /** Units [from, to] (inclusive, logical order). */
  from: number;
  to: number;
  rows: number;
  /** Columns per unit of the line, logical order; they sum to `cols`. */
  cols: number[];
}

/** Font size at which an item fills `cs × rs` modules (inside the padding). */
export function fitSize(it: GridItem, cs: number, rs: number, G: GridSpec): number {
  const w = cs * G.cw + (cs - 1) * G.g - 2 * G.pad;
  const h = rs * G.rh + (rs - 1) * G.g - 2 * G.pad - it.top;
  return Math.min(w / it.w1, h / it.h1);
}

/** Every composition of `total` into `parts` positive integers, in lexicographic order. */
export function compositions(total: number, parts: number): number[][] {
  if (parts === 1) return total >= 1 ? [[total]] : [];
  const out: number[][] = [];
  for (let first = 1; first <= total - parts + 1; first++) {
    for (const rest of compositions(total - first, parts - 1)) out.push([first, ...rest]);
  }
  return out;
}

/** Solves the grid for `items`; null when they cannot fit (more lines than rows). */
export function solveGrid(items: readonly GridItem[], G: GridSpec, per: number): GridLine[] | null {
  const n = items.length;
  if (!n) return [];
  const lineMemo = new Map<string, { score: number; cols: number[] } | null>();
  const line = (i: number, j: number, rows: number) => {
    const key = `${i}:${j}:${rows}`;
    if (lineMemo.has(key)) return lineMemo.get(key)!;
    let best: { score: number; cols: number[] } | null = null;
    for (const cols of compositions(G.cols, j - i + 1)) {
      let score = 0;
      let ok = true;
      cols.forEach((cs, k) => {
        const it = items[i + k]!;
        const S = fitSize(it, cs, rows, G);
        if (!(S > 0)) ok = false;
        else score += it.weight * Math.log(S);
      });
      if (ok && (!best || score > best.score + 1e-9)) best = { score, cols };
    }
    lineMemo.set(key, best);
    return best;
  };
  const memo = new Map<string, { score: number; lines: GridLine[] } | null>();
  const rest = (i: number, rows: number): { score: number; lines: GridLine[] } | null => {
    const key = `${i}:${rows}`;
    if (memo.has(key)) return memo.get(key)!;
    let best: { score: number; lines: GridLine[] } | null = null;
    for (let j = i; j < Math.min(n, i + per); j++) {
      const last = j === n - 1;
      for (let r = 1; r <= rows - (last ? 0 : 1); r++) {
        const l = line(i, j, r);
        if (!l) continue;
        const tail = last ? { score: 0, lines: [] } : rest(j + 1, rows - r);
        if (!tail) continue;
        const score = l.score + tail.score;
        if (!best || score > best.score + 1e-9) best = { score, lines: [{ from: i, to: j, rows: r, cols: l.cols }, ...tail.lines] };
      }
    }
    memo.set(key, best);
    return best;
  };
  return rest(0, G.rows)?.lines ?? null;
}
