/**
 * Channel records → DOM. Writes go through a per-element cache so unchanged properties are not touched; the DOM is
 * still a pure function of the last frame's channels.
 */
import type { Channels, Layer, PartChannels, StageChannels, Unit, View } from '../contract.ts';

export function resetChannels(c: Channels): void {
  c.tx = 0;
  c.ty = 0;
  c.sx = 1;
  c.sy = 1;
  c.rot = 0;
  c.skx = 0;
  c.opacity = 1;
  c.blur = 0;
  c.itx = 0;
  c.ity = 0;
  c.isx = 1;
  c.isy = 1;
  c.irot = 0;
  c.iskx = 0;
  c.clip = 1;
  c.clipFrom = 'start';
  c.color = null;
  c.glow = 0;
  c.glowColor = null;
  c.split = 0;
  c.shadow = '';
  c.wght = 0;
  c.visible = true;
}

export function resetPart(c: PartChannels): void {
  c.tx = 0;
  c.ty = 0;
  c.sx = 1;
  c.sy = 1;
  c.rot = 0;
  c.skx = 0;
  c.opacity = 1;
  c.blur = 0;
  c.color = null;
  c.glow = 0;
  c.glowColor = null;
  c.split = 0;
  c.shadow = '';
  c.glyph = null;
}

const written = new WeakMap<HTMLElement, Map<string, string>>();
function put(el: HTMLElement, prop: string, value: string): void {
  let m = written.get(el);
  if (!m) written.set(el, (m = new Map()));
  if (m.get(prop) === value) return;
  m.set(prop, value);
  el.style.setProperty(prop, value);
}

const n2 = (v: number) => v.toFixed(2);
const n4 = (v: number) => v.toFixed(4);

/** translate → rotate → skewX → scale; `none` at identity. */
function transform(tx: number, ty: number, rot: number, sx: number, sy: number, skx = 0): string {
  let s = '';
  if (tx !== 0 || ty !== 0) s += `translate(${n2(tx)}px, ${n2(ty)}px) `;
  if (rot !== 0) s += `rotate(${n4(rot)}deg) `;
  if (skx !== 0) s += `skewX(${n4(skx)}deg) `;
  if (sx !== 1 || sy !== 1) s += sx === sy ? `scale(${n4(sx)}) ` : `scale(${n4(sx)}, ${n4(sy)}) `;
  return s ? s.trimEnd() : 'none';
}

const filter = (blur: number) => (blur > 0.01 ? `blur(${n2(blur)}px)` : 'none');

function shadow(glow: number, color: string, split: number, extra: string): string {
  const s: string[] = [];
  if (split > 0.01) s.push(`${n2(split)}px 0 var(--split-a)`, `${n2(-split)}px 0 var(--split-b)`);
  if (glow > 0.01) s.push(`0 0 ${n2(glow)}px ${color}`, `0 0 ${n2(glow * 3)}px ${color}`);
  if (extra) s.push(extra);
  return s.length ? s.join(', ') : 'none';
}

/** Inset clip revealing `clip` of the box from `from` (start/end resolved by direction). */
function inset(clip: number, from: Channels['clipFrom'], rtl: boolean): string {
  if (clip >= 1) return 'none';
  const h = `${((1 - Math.max(0, clip)) * 100).toFixed(3)}%`;
  const side = from === 'start' ? (rtl ? 'right' : 'left') : from === 'end' ? (rtl ? 'left' : 'right') : from;
  // the hidden part is on the side opposite to where the reveal starts
  const t = side === 'bottom' ? h : '0';
  const b = side === 'top' ? h : '0';
  const l = side === 'right' ? h : '0';
  const r = side === 'left' ? h : '0';
  return `inset(${t} ${r} ${b} ${l})`;
}

/**
 * Whether the unit draws anything this frame. A (near-)zero scale counts as hidden: Chromium can leave a stale pixel
 * behind a `scale(0)` element that was visible in an earlier frame, which breaks seek-order independence.
 */
export function drawn(c: Channels): boolean {
  return c.visible && c.opacity > 0 && c.clip > 0 && Math.abs(c.sx) > 1e-4 && Math.abs(c.sy) > 1e-4;
}

export function commitUnit(u: Unit): void {
  const el = u.el;
  if (!el) return;
  const c = u.ch;
  const shown = drawn(c);
  // Every property is written even while hidden: hidden elements still take part in compositing decisions, so
  // stale values from an earlier frame would make the picture depend on seek order.
  put(el, 'visibility', shown ? 'visible' : 'hidden');
  put(el, 'transform', transform(c.tx, c.ty, c.rot, c.sx, c.sy, c.skx));
  put(el, 'opacity', c.opacity >= 1 ? '1' : c.opacity.toFixed(3));
  put(el, 'filter', filter(c.blur));
  put(el, 'clip-path', inset(c.clip, c.clipFrom, u.section.dir === 'rtl'));
  const inner = u.inner;
  if (!inner) return;
  put(inner, 'transform', transform(c.itx, c.ity, c.irot, c.isx, c.isy, c.iskx));
  const color = c.color ?? u.color;
  put(inner, 'color', color);
  put(inner, 'text-shadow', shadow(c.glow, c.glowColor ?? color, c.split, c.shadow));
  if (u.font.size) put(inner, 'font-weight', String(c.wght || u.font.weight));
  for (const p of u.parts) {
    const pc = p.ch;
    const s = p.span;
    // never `visibility` on parts: a visible child would show through a hidden unit
    const flat = Math.abs(pc.sx) <= 1e-4 || Math.abs(pc.sy) <= 1e-4;
    put(s, 'transform', flat ? 'none' : transform(pc.tx, pc.ty, pc.rot, pc.sx, pc.sy, pc.skx));
    put(s, 'opacity', flat || pc.opacity <= 0 ? '0' : pc.opacity >= 1 ? '1' : pc.opacity.toFixed(3));
    put(s, 'filter', filter(pc.blur));
    const pcolor = pc.color ?? color;
    put(s, 'color', pcolor);
    put(s, 'text-shadow', shadow(pc.glow, pc.glowColor ?? pcolor, pc.split, pc.shadow));
    const text = pc.glyph ?? p.text;
    if (s.textContent !== text) s.textContent = text;
  }
}

export function commitStage(stage: HTMLElement, sc: StageChannels): void {
  let flash = stage.querySelector<HTMLElement>(':scope > .flash');
  if (!flash) {
    flash = document.createElement('div');
    flash.className = 'flash';
    stage.appendChild(flash);
  }
  put(flash, 'opacity', sc.flash > 0 ? Math.min(1, sc.flash).toFixed(3) : '0');
  put(flash, 'background', sc.flashColor);
}

/**
 * Layer element + its camera: content push (tx, ty, s, blur), stage shake and kick, then the camera view, all around
 * the focus point.
 */
export function commitLayer(L: Layer, sc: StageChannels, focus: View, active: boolean): void {
  const on = active && L.ch.visible;
  put(L.el, 'display', on ? 'block' : 'none');
  if (!on) return;
  put(L.el, 'opacity', L.ch.opacity >= 1 ? '1' : Math.max(0, L.ch.opacity).toFixed(3));
  put(L.el, 'clip-path', L.ch.clip ?? 'none');
  const v = L.view;
  const s = v.s * (1 + sc.kick) * L.ch.s;
  const shake = sc.shakeRot !== 0 ? ` rotate(${n4(sc.shakeRot)}deg)` : '';
  put(
    L.cam,
    'transform',
    `translate(${n2(focus.x + L.ch.tx + sc.shakeX)}px, ${n2(focus.y + L.ch.ty + sc.shakeY)}px)${shake} ` +
      `scale(${s.toFixed(5)}) rotate(${n4(-v.r)}deg) translate(${n2(-v.x)}px, ${n2(-v.y)}px)`,
  );
  put(L.cam, 'filter', filter(L.ch.blur));
}
