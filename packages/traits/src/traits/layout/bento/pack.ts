/**
 * Bento packing (pure, unit-tested in `pack.test.ts`): tiles, in reading order, fill a `cols × rows` cell grid
 * completely by guillotine cuts. Every cut splits the run of tiles in two (the first part goes left / on top), so
 * reading order survives; among all such trees the one with the largest Σ score(w, h) wins. Ties keep the first
 * candidate in enumeration order (splits by index, then vertical cuts before horizontal ones, small first), so the
 * packing is deterministic. Memoised on (first, last, w, h): a score depends on the size of a cell rect only.
 */

export interface Cells {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A tile's score for a `w × h` cell rect; −Infinity when its content cannot be shown there. */
export type TileScore = (w: number, h: number) => number;

interface Best {
  score: number;
  rects: Cells[];
}

/** Packs `tiles` into the grid; null when no guillotine packing gives every tile a finite score. */
export function packBento(tiles: readonly TileScore[], cols: number, rows: number): Cells[] | null {
  const n = tiles.length;
  if (!n || n > cols * rows) return null;
  const memo = new Map<string, Best | null>();
  const best = (i: number, j: number, w: number, h: number): Best | null => {
    const key = `${i}:${j}:${w}:${h}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let out: Best | null = null;
    if (w * h >= j - i + 1) {
      if (i === j) {
        const score = tiles[i]!(w, h);
        out = Number.isFinite(score) ? { score, rects: [{ x: 0, y: 0, w, h }] } : null;
      } else {
        for (let k = i; k < j; k++) {
          for (const vertical of [true, false]) {
            const span = vertical ? w : h;
            for (let cut = 1; cut < span; cut++) {
              const a = vertical ? best(i, k, cut, h) : best(i, k, w, cut);
              if (!a) continue;
              const b = vertical ? best(k + 1, j, w - cut, h) : best(k + 1, j, w, h - cut);
              if (!b) continue;
              const score = a.score + b.score;
              if (out && score <= out.score + 1e-9) continue;
              const shifted = b.rects.map((r) => (vertical ? { ...r, x: r.x + cut } : { ...r, y: r.y + cut }));
              out = { score, rects: [...a.rects, ...shifted] };
            }
          }
        }
      }
    }
    memo.set(key, out);
    return out;
  };
  return best(0, n - 1, cols, rows)?.rects ?? null;
}

/** Mirrors a packing left ↔ right (right-to-left reading: the first tile on the right). */
export const mirror = (rects: readonly Cells[], cols: number): Cells[] => rects.map((r) => ({ ...r, x: cols - r.x - r.w }));
