/**
 * Screen-space FX canvases (`layer.over` / `layer.under`) that draw things anchored to a section's units: the map
 * from section-group coordinates to screen px this frame, and a full-frame canvas factory. Page-only.
 */
import type { Host, Section } from '../contract.ts';

/** 2D affine map `[a, b, c, d, e, f]` as `CanvasRenderingContext2D.setTransform` takes it. */
export type Mat = [number, number, number, number, number, number];

const mul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const rot = (deg: number): Mat => {
  const r = (deg * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
};
const move = (x: number, y: number): Mat => [1, 0, 0, 1, x, y];

/**
 * Section-group → screen through the section's placement and its layer's camera view of this frame (call it from
 * `frame`, after `camera.view` ran). Stage kick/shake and transition pushes are not included: the styles that use it
 * keep `rhythm.kick` at 0.
 */
export function groupToScreen(host: Host, s: Section): Mat {
  const v = s.layer.view;
  const cam = mul(mul(mul(move(host.safe.cx, host.safe.cy), [v.s, 0, 0, v.s, 0, 0]), rot(-v.r)), move(-v.x, -v.y));
  return mul(mul(cam, move(s.place.x, s.place.y)), rot(s.place.rot));
}

/** A full-frame canvas (format px) owned by the calling hook's trait instance. */
export function frameCanvas(host: Host, cls: string, parent: HTMLElement): CanvasRenderingContext2D {
  const cv = host.el('canvas', cls, parent, { position: 'absolute', left: '0', top: '0', width: `${host.W}px`, height: `${host.H}px` });
  cv.width = host.W;
  cv.height = host.H;
  return cv.getContext('2d')!;
}
