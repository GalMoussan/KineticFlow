/**
 * Shared state of the chat-bubbles signature traits: `layout/chat-thread` lays the thread out and writes it to
 * `section.data.layout` / `unit.data.layout`; `camera/chat-scroll`, `reveal/chat-pop`, `material/chat-ink` and
 * `background/chat-wallpaper` read it. Page-only (colour maths uses `**`).
 */
import type { Host, Layer, Section, Unit } from '../contract.ts';
import { mixHex, rgbOf } from './neon.ts';

/** `in` = incoming (start side, avatar), `out` = outgoing ("me", end side, read ticks), `sys` = centred date chip. */
export type Side = 'in' | 'out' | 'sys';
export type BubbleKind = 'msg' | 'chip' | 'card';
export type Part =
  | 'body' | 'tail' | 'text' | 'stamp' | 'ticks' | 'avatar' | 'map' | 'pin' | 'sep' | 'rule' | 'icon' | 'hl' | 'typing' | 'dot';

/** Per-unit role (`unit.data.layout`, or `unit.data.material` for the material's highlight pills). */
export interface ChatUnit {
  part: Part;
  /** Bubble index inside the section (-1 for the typing indicator). */
  b: number;
  side: Side;
  /** Tail / avatar: hidden from this time on (the next bubble of the same speaker takes them over). */
  until?: number;
  /** Typing dot index. */
  i?: number;
  /** Highlight pill: when it draws. */
  at?: number;
}

export interface Bubble {
  kind: BubbleKind;
  side: Side;
  /** Landing: the pop settles here (first landing of its items). */
  at: number;
  /** Pivot of the pop (tail tip, or the chip's centre), group coordinates. */
  px: number;
  py: number;
  /** Outgoing: when the read ticks turn on (the other side starts answering); null = never. */
  read: number | null;
  title: boolean;
  /** First / last item index of the section drawn in this bubble (list bursts: one item per bubble). */
  first: number;
  last: number;
}

export interface Typing {
  t0: number;
  t1: number;
  px: number;
  py: number;
  side: Side;
}

/** Scroll stop: from t over d seconds the camera eases to scroll `y` (world y Y is then drawn at screen y Y − y). */
export interface ScrollKey {
  t: number;
  d: number;
  y: number;
}

export interface ChatSection {
  bubbles: Bubble[];
  typing: Typing | null;
  keys: ScrollKey[];
  /** Base text size of the thread (px). */
  F: number;
}

/** A bubble starts popping this long before its landing and takes POP_DUR. */
export const POP_LEAD = 0.14;
export const POP_DUR = 0.42;

export const chatOf = (s: Section): ChatSection => s.data.layout as ChatSection;
export const chatUnit = (u: Unit): ChatUnit | undefined => (u.data.layout ?? u.data.material) as ChatUnit | undefined;

/** CSS transform-origin (`50% 50%`, `0 50%`, `100% 0`, px values) → point in group coordinates. */
export function originOf(u: Unit): [number, number] {
  const [a = '50%', b = '50%'] = u.origin.split(/\s+/);
  const at = (v: string, size: number) => (v.endsWith('%') ? (parseFloat(v) / 100) * size : parseFloat(v) || 0);
  return [u.box.x + at(a, u.box.w), u.box.y + at(b, u.box.h)];
}

/** Uniform scale `s` of a unit about the group point (px, py), composed into its channels. */
export function scaleAbout(u: Unit, s: number, px: number, py: number): void {
  const [ox, oy] = originOf(u);
  u.ch.tx += (1 - s) * (px - ox);
  u.ch.ty += (1 - s) * (py - oy);
  u.ch.sx *= s;
  u.ch.sy *= s;
}

// ── colours ──

const lum = (hex: string) => {
  const [r, g, b] = rgbOf(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** WCAG 2 contrast ratio of two `#RRGGBB` colours. */
export function contrast(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

const best = (on: string, options: string[]) => options.reduce((p, c) => (contrast(c, on) > contrast(p, on) ? c : p));

export interface ChatColours {
  fill(side: Side): string;
  text(side: Side): string;
  /** Emphasis / numbers on that side's fill. */
  emph(side: Side): string;
  /** Stamps, cities, typing dots. */
  muted(side: Side): string;
  /** Read ticks on the outgoing fill. */
  read: string;
  /** Footer panel and input field. */
  footer: string;
  field: string;
}

/**
 * Bubble colours from a palette: accent 0 = outgoing fill, accent 3 = incoming fill (else the background lifted
 * towards white), accent 1 / 2 = emphasis on the incoming / outgoing fill, accent 4 = read ticks. Any palette works:
 * text takes the more legible of the palette text, white and the background; an emphasis colour below 3:1 on its
 * fill is replaced by the most legible accent.
 */
export function chatColours(host: Host, of: Section | Layer): ChatColours {
  const p = of.palette;
  const acc = p.accents;
  const lift = mixHex(p.bg, '#FFFFFF', 0.72);
  const inFill = acc.length > 3 ? acc[3]! : lift;
  const outFill = host.accent(0, of);
  const chipFill = mixHex(p.bg, '#FFFFFF', 0.78);
  const fill = (s: Side) => (s === 'out' ? outFill : s === 'in' ? inFill : chipFill);
  const text = (s: Side) => best(fill(s), [p.text, '#FFFFFF', p.bg]);
  const emph = (s: Side) => {
    const want = host.accent(s === 'out' ? 2 : 1, of);
    if (contrast(want, fill(s)) >= 3) return want;
    const c = best(fill(s), acc.filter((a) => a !== fill(s)));
    return contrast(c, fill(s)) >= 3 ? c : text(s);
  };
  const muted = (s: Side) => mixHex(text(s), fill(s), 0.4);
  const readC = host.accent(4, of);
  return {
    fill,
    text,
    emph,
    muted,
    read: contrast(readC, outFill) >= 2 ? readC : text('out'),
    footer: mixHex(p.bg, '#FFFFFF', 0.55),
    field: mixHex(p.bg, '#FFFFFF', 0.9),
  };
}
