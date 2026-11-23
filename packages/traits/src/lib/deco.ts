/**
 * Shared decoration pieces (logo badge, location pin, quote marks) for any layout or material. They only build
 * markup/geometry; the trait that creates the decoration unit animates it through channels.
 */
import type { LogoRef } from '@reel/core';
import type { Host, Section } from '../contract.ts';

/** Location pin, `size` px tall-ish (width 0.72·size, height 0.9·size), viewBox 0 0 100 125. */
export function pinSVG(size: number, c: { body: string; hole: string; shadow: string }): string {
  return (
    `<svg width="${size * 0.72}" height="${size * 0.9}" viewBox="0 0 100 125" style="display:block;overflow:visible">` +
    `<ellipse cx="50" cy="121" rx="26" ry="5" fill="${c.shadow}"/>` +
    `<path d="M50 4 C25 4 8 22 8 46 C8 76 50 120 50 120 C50 120 92 76 92 46 C92 22 75 4 50 4 Z" fill="${c.body}"/>` +
    `<circle cx="50" cy="45" r="16" fill="${c.hole}"/></svg>`
  );
}

/** Ink metrics of the pin per 1 px of `size` (it sits on the baseline like a glyph). */
export const PIN_METRICS = { bl: 0, br: 0.72, ia: 0.864, id: 0.04, fa: 0, fd: 0 } as const;

// one "99" mark: round head + tapering tail (viewBox 0 0 64 100)
const MARK = 'M32 2 A28 28 0 1 1 31.9 2 Z M58 34 C60 64 44 88 12 99 L8 90 C28 79 36 64 34 52 Z';

/** A pair of quote marks `size` wide (0.667·size tall): `open` is the turned "66" shape, `close` the "99". */
export function quoteSVG(kind: 'open' | 'close', size: number, color: string): string {
  return (
    `<svg width="${size}" height="${size * 0.667}" viewBox="0 0 150 100" style="display:block;overflow:visible">` +
    `<g fill="${color}" transform="${kind === 'open' ? 'rotate(180 75 50)' : ''}"><path d="${MARK}"/>` +
    `<path transform="translate(80 0)" d="${MARK}"/></g></svg>`
  );
}

export interface BadgeOptions {
  /** Logo height before shrinking to fit. */
  logoH?: number;
  pad?: number;
  gap?: number;
  fill?: string;
  border?: string;
  /** Colour of the offset shadow; null = none. */
  shadow?: string | null;
  radius?: number;
}

export interface Badge {
  w: number;
  h: number;
  /** Appends the badge (filling its parent) with clones of the decoded logos. Use as a unit's `mount`. */
  mount(parent: HTMLElement): void;
  /** Fingerprint stand-in for `mount`. */
  key: string;
}

/** A rounded badge holding every logo in a row, at most `maxW` wide, in `section`'s palette unless overridden. */
export function logoBadge(host: Host, section: Section, logos: readonly LogoRef[], maxW: number, o: BadgeOptions = {}): Badge {
  const logoH = o.logoH ?? 240;
  const pad = o.pad ?? 44;
  const gap = o.gap ?? 56;
  const natural = logos.reduce((a, l) => a + (logoH * l.w) / l.h, 0);
  const room = maxW - 2 * pad - gap * (logos.length - 1);
  const lh = natural > room ? (logoH * room) / natural : logoH;
  const sized = logos.map((l) => ({ url: l.url, w: (lh * l.w) / l.h, h: lh }));
  const w = sized.reduce((a, l) => a + l.w, 0) + gap * (sized.length - 1) + 2 * pad;
  const h = lh + 2 * pad;
  const style = {
    position: 'absolute',
    inset: '0',
    display: 'flex',
    'align-items': 'center',
    'justify-content': 'center',
    'box-sizing': 'border-box',
    gap: `${gap}px`,
    background: o.fill ?? '#FEF2E2',
    'border-radius': `${o.radius ?? 44}px`,
    border: `3px solid ${o.border ?? section.palette.text}`,
    ...(o.shadow !== null ? { 'box-shadow': `0 18px 0 -6px color-mix(in srgb, ${o.shadow ?? host.accent(3, section)} 55%, transparent)` } : {}),
  };
  return {
    w,
    h,
    key: JSON.stringify({ sized, style }),
    mount(parent) {
      const badge = host.el('div', 'badge', parent, style);
      for (const l of sized) {
        const img = host.images.get(l.url)!.cloneNode() as HTMLImageElement;
        Object.assign(img.style, { display: 'block', width: `${l.w.toFixed(2)}px`, height: `${l.h.toFixed(2)}px` });
        badge.appendChild(img);
      }
    },
  };
}
