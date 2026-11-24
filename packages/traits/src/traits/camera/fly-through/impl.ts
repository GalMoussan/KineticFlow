/**
 * Fly-through camera. One camera path for the whole reel (every layer's instance computes the same path from the
 * cue sheet's section timings): section i's plane is at depth Z_i = i · gap; the camera rests at Z_i − 1 (the plane
 * one focal length away: scale 1) from its arrival A_i = min(holdStart, in + settle), creeping forward by `creep`
 * until holdEnd, then flies to Z_{i+1} − 1 between out_i and A_{i+1} (smoothstep-like ease, rolling). A layer's view
 * scale is 1/d with d = Z − camera; planes closer than NEAR are hidden, planes closing in fade (`fog`).
 */
import type { SoundCue } from '@reel/core';
import { clamp01, easeInOut } from '@reel/runtime';
import { defineCamera, type Host, type Layer } from '../../../contract.ts';
import { rig } from '../../../lib/spatial.ts';
import { meta } from './meta.ts';

type P = { gap: number; creep: number; settle: number; roll: number; far: number };
/** One piece of the path: the camera goes from c0 to c1 over [t0, t1] (`move` eased with a roll, `rest` linear). */
interface Seg {
  kind: 'move' | 'rest';
  t0: number;
  t1: number;
  c0: number;
  c1: number;
  /** Roll direction of a move. */
  dir: number;
}
const NEAR = 0.14;
/** Distance at which a plane flying past starts to fade, and where it is gone. */
const FADE0 = 0.75;
const FADE1 = 0.22;

/** Paths per page and path params (sections with other fly-through params get their own path). */
const paths = new WeakMap<Host, Map<string, Seg[]>>();
function path(host: Host, p: P): Seg[] {
  const key = `${p.gap}|${p.creep}|${p.settle}`;
  let byKey = paths.get(host);
  if (!byKey) paths.set(host, (byKey = new Map()));
  const known = byKey.get(key);
  if (known) return known;
  const segs: Seg[] = [];
  const S = host.sections;
  let c = -1 - p.gap; // the intro flies in from one gap before the first plane
  let t = 0;
  S.forEach((s, i) => {
    const T = s.timing;
    const A = Math.max(T.in, Math.min(T.holdStart, T.in + p.settle));
    const rest = i * p.gap - 1;
    if (A > t) segs.push({ kind: 'move', t0: t, t1: A, c0: c, c1: rest, dir: i % 2 ? 1 : -1 });
    const hold = Math.max(A, T.holdEnd);
    segs.push({ kind: 'rest', t0: A, t1: hold, c0: rest, c1: rest + p.creep, dir: 0 });
    c = rest + p.creep;
    t = s.next ? Math.max(hold, T.out) : Infinity;
    if (t > hold) segs.push({ kind: 'rest', t0: hold, t1: t, c0: c, c1: c, dir: 0 });
  });
  byKey.set(key, segs);
  return segs;
}

function at(segs: Seg[], t: number): { c: number; roll: number } {
  let s = segs[0]!;
  for (const x of segs) if (t >= x.t0) s = x;
  const k = s.t1 > s.t0 && Number.isFinite(s.t1) ? clamp01((t - s.t0) / (s.t1 - s.t0)) : t >= s.t0 ? 1 : 0;
  if (s.kind === 'rest') return { c: s.c0 + (s.c1 - s.c0) * k, roll: 0 };
  return { c: s.c0 + (s.c1 - s.c0) * easeInOut(k), roll: s.dir * Math.sin(Math.PI * k) };
}

/** Distance from the camera to a layer's plane at t. */
const distOf = (host: Host, L: Layer, p: P, t: number) => L.sections[0]!.index * p.gap - at(path(host, p), t).c;

export default defineCamera({
  meta,
  setup({ host, layer, params }) {
    Object.assign(rig(layer), {
      dist: (t: number) => distOf(host, layer, params, t),
      travel: (t: number) => at(path(host, params), t).c,
      roll: (t: number) => params.roll * at(path(host, params), t).roll,
    });
  },
  view({ host, layer, params }, t) {
    const d = distOf(host, layer, params, t);
    return { x: host.safe.cx, y: host.safe.cy, r: params.roll * at(path(host, params), t).roll, s: 1 / Math.max(NEAR, d) };
  },
  range: ({ params }) => [1, 1 / (1 - params.creep)],
  /** Planes flying past the camera fade between FADE0 and FADE1 and vanish at NEAR. */
  frame({ host, layer, params }, t) {
    const d = distOf(host, layer, params, t);
    const fog = clamp01((d - FADE1) / (FADE0 - FADE1)) * clamp01((params.far - d) / (0.5 * params.far));
    for (const s of layer.sections) {
      for (const u of s.units) {
        u.ch.opacity *= fog;
        u.ch.visible &&= d > NEAR;
      }
    }
  },
  /** The path pieces that reach the window (they depend on neighbouring sections' timings). */
  fingerprint({ host, params }, t0, t1) {
    return path(host, params).filter((s) => s.t0 < t1 && s.t1 >= t0);
  },
  /** One whoosh per flight into this layer's plane (the reel's intro flight for the first layer). */
  sounds({ host, layer, params }) {
    const first = layer.sections[0]!;
    const into = path(host, params).filter((s) => s.kind === 'move' && s.c1 === first.index * params.gap - 1);
    return into
      .filter((s) => s.t1 - s.t0 >= 0.2)
      .map((s): SoundCue => ({ t: s.t0, until: s.t1, kind: 'whoosh', weight: first.index ? 0.6 : 0.45, pan: 0.2 * s.dir, section: first.id }));
  },
});
