/**
 * P0 spike S1 — SVG for contact sheets. The 50% view is the line with the pen halfway along it.
 */
import type { Point, SketchDoc } from './doc.ts';

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function poly(pts: Point[], stroke: string, width: number): string {
  if (pts.length < 2) return '';
  const points = pts.map((p) => `${p[0]},${p[1]}`).join(' ');
  return `<polyline points="${points}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

/** Neutral black drawing, same idea as `plainSvg` but owned by this spike. */
export function inkSvg(doc: SketchDoc): string {
  const [w, h] = doc.box;
  const sw = Math.max(w, h) / 110;
  const paths = doc.strokes.map((s) => poly(s.pts, '#161616', (s.w ?? 1.4) * sw)).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${paths}</svg>`;
}

function walk(pts: Point[], target: number): { done: Point[]; rest: Point[] } {
  if (pts.length < 2) return { done: pts.slice(), rest: [] };
  let run = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const seg = Math.sqrt(dx * dx + dy * dy);
    if (run + seg >= target || i === pts.length - 1) {
      const u = seg < 1e-9 ? 1 : Math.min(1, (target - run) / seg);
      const mid: Point = [a[0] + dx * u, a[1] + dy * u];
      return { done: pts.slice(0, i).concat([mid]), rest: [mid].concat(pts.slice(i)) };
    }
    run += seg;
  }
  return { done: pts.slice(), rest: [] };
}

/**
 * Full line in gray, the first `fraction` of arc length in ink, dot at the pen.
 * `fraction` is 0..1 across every stroke in drawing order.
 */
export function drawOrderSvg(doc: SketchDoc, fraction: number): string {
  const [w, h] = doc.box;
  const sw = Math.max(w, h) / 80;
  const strokes = doc.strokes.filter((s) => s.pts.length >= 2);
  let total = 0;
  const lengths: number[] = [];
  for (const s of strokes) {
    let n = 0;
    for (let i = 1; i < s.pts.length; i++) {
      const a = s.pts[i - 1]!;
      const b = s.pts[i]!;
      n += Math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2);
    }
    lengths.push(n);
    total += n;
  }
  const target = total * Math.min(1, Math.max(0, fraction));
  let remain = target;
  const done: string[] = [];
  const rest: string[] = [];
  let pen: Point | null = null;
  for (const [i, s] of strokes.entries()) {
    const len = lengths[i] ?? 0;
    if (remain <= 0) {
      rest.push(poly(s.pts, '#c8c8c8', sw));
      continue;
    }
    if (remain >= len) {
      done.push(poly(s.pts, '#161616', sw * 1.15));
      pen = s.pts[s.pts.length - 1] ?? null;
      remain -= len;
      continue;
    }
    const cut = walk(s.pts, remain);
    done.push(poly(cut.done, '#161616', sw * 1.15));
    rest.push(poly(cut.rest, '#c8c8c8', sw));
    pen = cut.done[cut.done.length - 1] ?? null;
    remain = 0;
  }
  const gray = strokes.map((s) => poly(s.pts, '#e4e4e4', sw)).join('');
  const dot = pen ? `<circle cx="${pen[0]}" cy="${pen[1]}" r="${sw * 2.2}" fill="#c4512c"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${gray}${rest.join('')}${done.join('')}${dot}</svg>`;
}

export function failedSvg(message: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><text x="40" y="500" fill="#888" font-size="64" font-family="system-ui,sans-serif">${esc(message.slice(0, 80))}</text></svg>`;
}
