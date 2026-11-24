/**
 * City map (see meta). The canvas is screen space (`layer.under` is outside the camera), so each frame rebuilds
 * the same matrix `commitLayer` applies and draws only the cells that matrix can see. Cleared every frame; no
 * blend mode, no shadow blur, no retained bitmap.
 */
import { defineBackground, type Host, type Layer } from '../../../contract.ts';
import { hsh, routeDraw, type Pt } from '../../../lib/map.ts';
import { mixHex, rgba } from '../../../lib/neon.ts';
import type { MapLayout } from '../../layout/map-route/impl.ts';
import { meta } from './meta.ts';

interface Mat {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

const ctxs = new WeakMap<Layer, CanvasRenderingContext2D>();

export default defineBackground({
  meta,
  mount({ host, layer }) {
    const cv = host.el('canvas', 'city-map', layer.under, { width: `${host.W}px`, height: `${host.H}px` });
    cv.width = host.W;
    cv.height = host.H;
    const g = cv.getContext('2d');
    if (g) ctxs.set(layer, g);
  },
  frame({ host, layer, params }, t) {
    const g = ctxs.get(layer);
    const map = layer.data.layout as MapLayout | undefined;
    if (!g || !map || !map.route?.length) return;
    const { W, H } = host;
    const bg = layer.palette.bg;
    const text = layer.palette.text;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, W, H);
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);

    const m = cameraMatrix(host, layer);
    g.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    const pitch = map.pitch;
    const box = visible(m, W, H);
    const c0 = Math.floor(box.x0 / pitch) - 1;
    const c1 = Math.floor(box.x1 / pitch) + 1;
    const r0 = Math.floor(box.y0 / pitch) - 1;
    const r1 = Math.floor(box.y1 / pitch) + 1;
    const inset = pitch * 0.18;
    if ((c1 - c0 + 1) * (r1 - r0 + 1) <= 8000) {
      for (let cy = r0; cy <= r1; cy++) {
        for (let cx = c0; cx <= c1; cx++) {
          const kind = hsh(map.seed + Math.imul(cx, 0x9e3779b1) + Math.imul(cy, 0x85ebca6b)) % 100;
          if (kind < 8) g.fillStyle = mixHex(bg, host.accent(2, layer), 0.62);
          else if (kind < 18) g.fillStyle = mixHex(bg, host.accent(1, layer), 0.5);
          else if (kind < 28) continue;
          else {
            const tone = kind % 3;
            g.fillStyle = tone === 0 ? mixHex(bg, text, 0.14) : tone === 1 ? mixHex(bg, host.accent(3, layer), 0.4) : mixHex(bg, text, 0.26);
          }
          g.fillRect(cx * pitch + inset, cy * pitch + inset, pitch - 2 * inset, pitch - 2 * inset);
        }
      }
    }

    const drawn = routeDraw(map.length, map.pinAt, t, map.t0, map.tPin, map.tEnd);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = mixHex(text, '#000000', 0.35);
    g.lineWidth = 11;
    strokeRoute(g, map.route, map.cum, drawn);
    g.strokeStyle = host.accent(0, layer);
    g.lineWidth = 7;
    strokeRoute(g, map.route, map.cum, drawn);

    const pts = waypointsOf(map);
    for (let i = 0; i < pts.length; i++) {
      if (i === map.pinIndex) continue;
      if ((map.marks[i] ?? Infinity) > drawn + 0.5) continue;
      const p = pts[i]!;
      g.fillStyle = host.accent(0, layer);
      g.beginPath();
      g.arc(p.x, p.y, 7, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = mixHex(bg, '#ffffff', 0.7);
      g.beginPath();
      g.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
      g.fill();
    }

    g.setTransform(1, 0, 0, 1, 0, 0);
    if (params.vignette > 0) {
      const vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.hypot(W, H) * 0.58);
      vg.addColorStop(0, rgba(text, 0));
      vg.addColorStop(1, rgba(text, params.vignette));
      g.fillStyle = vg;
      g.fillRect(0, 0, W, H);
    }
  },
});

/** The same matrix as `commitLayer`: view, kick, layer push, shake. */
function cameraMatrix(host: Host, layer: Layer): Mat {
  const v = layer.view;
  const sc = host.stageCh;
  const s = v.s * (1 + sc.kick) * layer.ch.s;
  const rad = (-v.r * Math.PI) / 180;
  const c1 = Math.cos(rad);
  const s1 = Math.sin(rad);
  const sr = (sc.shakeRot * Math.PI) / 180;
  const cs = Math.cos(sr);
  const sn = Math.sin(sr);
  const m00 = s * c1;
  const m01 = -s * s1;
  const m10 = s * s1;
  const m11 = s * c1;
  const a = cs * m00 - sn * m10;
  const c = cs * m01 - sn * m11;
  const b = sn * m00 + cs * m10;
  const d = sn * m01 + cs * m11;
  const fx = host.safe.cx + layer.ch.tx + sc.shakeX;
  const fy = host.safe.cy + layer.ch.ty + sc.shakeY;
  return { a, b, c, d, e: fx - (a * v.x + c * v.y), f: fy - (b * v.x + d * v.y) };
}

function visible(m: Mat, W: number, H: number): { x0: number; y0: number; x1: number; y1: number } {
  const det = m.a * m.d - m.b * m.c || 1;
  const inv = (sx: number, sy: number) => {
    const dx = sx - m.e;
    const dy = sy - m.f;
    return { x: (m.d * dx - m.c * dy) / det, y: (-m.b * dx + m.a * dy) / det };
  };
  const pts = [inv(0, 0), inv(W, 0), inv(0, H), inv(W, H)];
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x0, y0, x1, y1 };
}

function strokeRoute(g: CanvasRenderingContext2D, route: readonly Pt[], cum: readonly number[], dist: number): void {
  if (!(dist > 0) || route.length < 2) return;
  g.beginPath();
  g.moveTo(route[0]!.x, route[0]!.y);
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]!;
    const b = route[i]!;
    const c0 = cum[i - 1] ?? 0;
    const c1 = cum[i] ?? c0;
    if (dist >= c1) {
      g.lineTo(b.x, b.y);
      continue;
    }
    const k = c1 > c0 ? (dist - c0) / (c1 - c0) : 0;
    g.lineTo(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k);
    break;
  }
  g.stroke();
}

/** Section waypoints are the route vertices that `marks` index; corners have no mark. */
function waypointsOf(map: MapLayout): Pt[] {
  const out: Pt[] = [];
  let j = 0;
  for (let i = 0; i < map.marks.length; i++) {
    const target = map.marks[i]!;
    while (j < map.cum.length - 1 && (map.cum[j] ?? 0) < target) j++;
    out.push(map.route[j] ?? map.route[0]!);
  }
  return out;
}
