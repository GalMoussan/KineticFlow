/**
 * Isometric-blocks layout.
 *
 * Typesetting (at layout time, Node-free maths only): each section becomes rows (emphasis and numbers on rows of
 * their own, plain words packed ≤ k per row, the k that gives the largest type), every row the front face of a block
 * (ink + padding wide, `depth` em deep), blocks stacked without gaps and centred. The base size fits the projected
 * stack (front, top and side faces at the rest pose) into the safe area at the largest hold zoom.
 *
 * 3D: section group coordinates are the front plane (z = −R) of the section's tower, shifted so the projected stack is
 * centred: local = group − C + d. Tower i stands on its side of the world, so its yaw is rest + turn(t) − 90 · i. The
 * pivot (local origin) projects to P = C + R · Q₀ẑ, so every section's front face rests on the safe centre. Faces are
 * decoration units on box (0, 0, w, h) mapped by their world plane; units whose face points away are hidden.
 */
import type { SoundCue } from '@reel/core';
import { clamp01 } from '@reel/runtime';
import { defineLayout } from '../../../contract.ts';
import { logoBadge } from '../../../lib/deco.ts';
import {
  facing,
  inv2,
  mix,
  orbit,
  ortho,
  placeOnPlane,
  planeMap,
  project,
  rig,
  steep,
  type Plane,
  type Mat2,
  type Vec3,
  warp,
} from '../../../lib/spatial.ts';
import { bestRows, inkDims, isWide, placeRow, sectionBlocks, type Row } from '../../../lib/spatial-rows.ts';
import { meta } from './meta.ts';

const PAD_X = 0.34; // block padding around the row's ink, em of the row
const PAD_Y = 0.2;
const BADGE = { logoH: 0.85, pad: 0.16, gap: 0.24, radius: 0.12 };
const DROP_LEN = 0.42; // s
const FACES = ['back', 'left', 'right', 'top', 'front'] as const;
type Face = (typeof FACES)[number];
const NORMAL: Record<Face, Vec3> = { front: [0, 0, -1], back: [0, 0, 1], top: [0, -1, 0], left: [-1, 0, 0], right: [1, 0, 0] };

/** What a unit needs per frame (`unit.data.layout`): its plane in tower-local coordinates and the block's row. */
interface Placed {
  row: number;
  face: Face;
  plane: Plane;
  surface?: string;
}
/** Per section (`section.data.layout`): rows' drop times and the tower constants. */
interface Tower {
  index: number;
  drops: number[];
  dropH: number;
  R: number;
  P: [number, number];
  /** Screen-space map that keeps front faces undistorted at rest. */
  K: Mat2;
}

export default defineLayout({
  meta,
  layout({ host, layer, params }) {
    const { safe } = host;
    const C: [number, number] = [safe.cx, safe.cy];
    const margin = 8 + 0.03 * Math.min(safe.w, safe.h);
    const FIT_W = safe.w - 2 * margin;
    const FIT_H = safe.h - 2 * margin;
    const CAP = params.cap * Math.min(safe.w, 1.4 * safe.h);
    const R = params.radius * safe.w;
    const Dmax = 0.36 * safe.w;
    // front faces are drawn undistorted at rest (K undoes the pose's map of the front plane): no skewed text at holds
    const K = inv2(planeMap(ortho(orbit(params.yaw, params.pitch)), [1, 0, 0], [0, 1, 0]));
    const Q0 = warp(K, ortho(orbit(params.yaw, params.pitch)));
    const zAxis = project(Q0, [0, 0, 1]);
    const P: [number, number] = [C[0] + R * zAxis[0], C[1] + R * zAxis[1]];
    const logos = host.reel.logos;
    const badge1 = {
      w: logos.reduce((a, l) => a + (BADGE.logoH * l.w) / l.h, 0) + BADGE.gap * Math.max(0, logos.length - 1) + 2 * BADGE.pad,
      h: BADGE.logoH + 2 * BADGE.pad,
    };
    /** Ink + block extents of a row at base size 1. */
    const dims = (r: Row) => {
      if (r.kind === 'badge') return { ink: badge1.w, ia: badge1.h, id: 0, w: badge1.w + 2 * PAD_X * 0.5, h: badge1.h + 2 * PAD_Y * 0.5 };
      const d = inkDims(host, r);
      return { ...d, w: d.ink + 2 * PAD_X * r.f, h: d.ia + d.id + 2 * PAD_Y * r.f };
    };
    /** Projected bounding box (relative to the front face centre) of a stack of rows at base size 1. */
    const bbox = (rows: Row[], D: number) => {
      const ds = rows.map(dims);
      const total = ds.reduce((a, d) => a + d.h, 0);
      let y = -total / 2;
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (const d of ds) {
        for (const cx of [-d.w / 2, d.w / 2]) {
          for (const cy of [y, y + d.h]) {
            for (const cz of [0, D]) {
              const [px, py] = project(Q0, [cx, cy, cz]);
              x0 = Math.min(x0, px);
              x1 = Math.max(x1, px);
              y0 = Math.min(y0, py);
              y1 = Math.max(y1, py);
            }
          }
        }
        y += d.h;
      }
      return { x0, x1, y0, y1 };
    };
    const sizeOf = (rows: Row[], hi: number) => {
      const b = bbox(rows, params.depth);
      const fmax = Math.max(...rows.map((r) => r.f));
      return Math.min(FIT_W / (b.x1 - b.x0), FIT_H / (b.y1 - b.y0), CAP / fmax) / hi;
    };

    for (const s of layer.sections) {
      // the turntable's hold sway changes the projection a little: 4 % headroom
      const hi = host.zoomRange(s)[1] * 1.04;
      const { rows, size: S } = bestRows(sectionBlocks(s), (rs) => sizeOf(rs, hi), isWide(host));
      const D = Math.min(params.depth * S, Dmax);
      const bb = bbox(rows, D / S);
      const off: [number, number] = [(-(bb.x0 + bb.x1) / 2) * S, (-(bb.y0 + bb.y1) / 2) * S];
      /** Tower-local point of a content-space point (content = centred at 0). */
      const local = (x: number, y: number, z: number): Vec3 => [x + off[0], y + off[1], z];
      const front: Plane = { o: [off[0] - C[0], off[1] - C[1], -R], e1: [1, 0, 0], e2: [0, 1, 0] };
      const ds = rows.map(dims);
      const total = ds.reduce((a, d) => a + d.h * S, 0);
      let y = -total / 2;
      const n = rows.length;
      rows.forEach((r, ri) => {
        const d = ds[ri]!;
        const w = d.w * S;
        const h = d.h * S;
        const x0 = -w / 2;
        const acc = host.accent(ri + s.index, s);
        const shade: Record<Face, string> = {
          front: mix(acc, '#FFFFFF', 0.8),
          top: mix(acc, '#FFFFFF', 0.9),
          right: mix(acc, '#FFFFFF', 0.42),
          left: mix(mix(acc, '#FFFFFF', 0.42), '#000000', 0.12),
          back: mix(acc, '#FFFFFF', 0.5),
        };
        const edge = mix(acc, '#000000', 0.25);
        const zRow = (n - 1 - ri) * 10;
        const X0 = x0;
        const X1 = x0 + w;
        const Y0 = y;
        const Y1 = y + h;
        const Z0 = -R;
        const Z1 = -R + D;
        const planes: Record<Face, { plane: Plane; w: number; h: number }> = {
          front: { plane: { o: local(X0, Y0, Z0), e1: [1, 0, 0], e2: [0, 1, 0] }, w, h },
          back: { plane: { o: local(X1, Y0, Z1), e1: [-1, 0, 0], e2: [0, 1, 0] }, w, h },
          top: { plane: { o: local(X0, Y0, Z1), e1: [1, 0, 0], e2: [0, 0, -1] }, w, h: D },
          right: { plane: { o: local(X1, Y0, Z0), e1: [0, 0, 1], e2: [0, 1, 0] }, w: D, h },
          left: { plane: { o: local(X0, Y0, Z1), e1: [0, 0, -1], e2: [0, 1, 0] }, w: D, h },
        };
        FACES.forEach((face) => {
          const p = planes[face];
          const f = host.deco(s, {
            deco: `block-${face}`,
            box: { x: 0, y: 0, w: p.w, h: p.h },
            style: { background: shade[face] },
            z: zRow + (face === 'front' ? 2 : face === 'back' ? 0 : 1),
          });
          f.data.layout = { row: ri, face, plane: p.plane } satisfies Placed;
        });
        const surface = shade.front;
        if (r.kind === 'badge') {
          const b = logoBadge(host, s, logos, badge1.w * S + 1, {
            logoH: BADGE.logoH * S,
            pad: BADGE.pad * S,
            gap: BADGE.gap * S,
            radius: BADGE.radius * S,
            fill: '#FFFFFF',
            border: edge,
            shadow: null,
          });
          Object.assign(r.u, {
            box: { x: C[0] - b.w / 2, y: C[1] + y + (h - b.h) / 2, w: b.w, h: b.h },
            innerStyle: { width: `${b.w.toFixed(2)}px`, height: `${b.h.toFixed(2)}px` },
            mount: b.mount,
            mountKey: b.key,
            z: zRow + 5,
            font: { family: 'display', size: S, weight: 800 },
          });
          r.u.tags.line = ri;
          r.u.data.layout = { row: ri, face: 'front', plane: front, surface } satisfies Placed;
          y += h;
          return;
        }
        placeRow(host, s, r, S, C[0], C[1] + y + PAD_Y * S * r.f + d.ia * S, ri);
        for (const t of r.toks) {
          t.u.z = zRow + 5;
          t.u.data.layout = { row: ri, face: 'front', plane: front, surface } satisfies Placed;
        }
        y += h;
      });
      // rows drop bottom-up while the world turns in (or before the first landing), the last landing first-ish
      const w = s.window;
      const firstAt = s.timing.firstLand;
      const a0 = w ? w.t0 + 0.2 * (w.t1 - w.t0) : Math.max(0, firstAt - DROP_LEN - 0.09 * n);
      const step = Math.max(0.04, Math.min(0.11, (Math.max(firstAt, a0 + DROP_LEN) - a0 - DROP_LEN * 0.6) / n));
      const drops = rows.map((_, ri) => a0 + (n - 1 - ri) * step);
      s.place = { x: 0, y: 0, rot: 0 };
      s.frame = { x: C[0], y: C[1], r: 0, s: 1 };
      s.bounds = null;
      s.data.layout = { index: s.index, drops, dropH: params.drop * safe.h, R, P, K } satisfies Tower;
    }
    const r = rig(layer);
    r.origin = () => P;
    r.radius = R;
    r.floor = 0.56 * safe.h;
    r.proj = (t: number) => warp(K, ortho(orbit(params.yaw + (r.turn?.(t) ?? 0) - 90 * layer.sections[0]!.index, params.pitch)));
  },

  frame({ layer, params }, t) {
    const turn = rig(layer).turn?.(t) ?? 0;
    for (const s of layer.sections) {
      const T = s.data.layout as Tower;
      const rot = orbit(params.yaw + turn - 90 * T.index, params.pitch);
      const q = warp(T.K, ortho(rot));
      const show: Record<Face, boolean> = {
        front: facing(rot, NORMAL.front) > 0.02,
        back: facing(rot, NORMAL.back) > 0.02,
        top: facing(rot, NORMAL.top) > 0.02,
        left: facing(rot, NORMAL.left) > 0.02,
        right: facing(rot, NORMAL.right) > 0.02,
      };
      const m = s.motion;
      for (const u of s.units) {
        const p = u.data.layout as Placed | undefined;
        if (!p) continue;
        const k = clamp01((t - T.drops[p.row]!) / DROP_LEN);
        u.ch.visible &&= show[p.face] && t >= T.drops[p.row]!;
        const dy = -T.dropH * (1 - m.bounce(k, 1.1));
        const plane: Plane = { o: [p.plane.o[0], p.plane.o[1] + dy, p.plane.o[2]], e1: p.plane.e1, e2: p.plane.e2 };
        placeOnPlane(u, q, plane, T.P);
        // type on a face turned far away is unreadable and rasterises history-dependently (`steep`): the face turns
        // on without its print until it comes round
        if (u.text) u.ch.visible &&= !steep(u.ch);
        u.ch.opacity *= clamp01(k * 6);
      }
    }
  },

  /** The turn and the drops are functions of timings (fingerprinted) and `section.data.layout`. */
  fingerprint: () => 'iso-blocks@1',

  /** Every block knocks as it lands on the stack (a low pop, pitch rising up the stack). */
  sounds({ layer }) {
    const out: SoundCue[] = [];
    for (const s of layer.sections) {
      const T = s.data.layout as Tower;
      const n = T.drops.length;
      T.drops.forEach((t0, ri) =>
        out.push({ t: t0 + DROP_LEN / (1.1 + 1), kind: 'pop', weight: 0.4, pitch: -7 + 1.5 * (n - 1 - ri), section: s.id }),
      );
    }
    return out;
  },
});
