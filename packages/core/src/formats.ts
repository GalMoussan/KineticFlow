import { z } from 'zod';

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Output sizes and the area text must stay inside. 9:16 keeps clear of the Instagram Reels UI as measured in Nov 2026
 * on a 1080×1920 frame: status/header bar y < 210, profile + caption rail y > 1590, action buttons x ≥ 996 for
 * y 614–1460 (capqa.app/guides/reels-safe-zone; krumzi.com organic: top 220, bottom 320, sides 65). Right 120 keeps
 * 36 px off the buttons; bottom 380 leaves room for a second caption line. Meta's ad guidance (bottom 35 %) is stricter.
 */
export const FORMATS = {
  '9:16': { w: 1080, h: 1920, safe: { top: 220, right: 120, bottom: 380, left: 70 } },
  '1:1': { w: 1080, h: 1080, safe: { top: 120, right: 110, bottom: 120, left: 110 } },
  '4:5': { w: 1080, h: 1350, safe: { top: 110, right: 90, bottom: 140, left: 90 } },
  '16:9': { w: 1920, h: 1080, safe: { top: 100, right: 160, bottom: 100, left: 160 } },
} as const satisfies Record<string, { w: number; h: number; safe: Insets }>;

export const FormatId = z.enum(['9:16', '1:1', '4:5', '16:9']);
export type FormatId = z.infer<typeof FormatId>;

export interface Format {
  id: FormatId;
  w: number;
  h: number;
  safe: Insets;
}

export function format(id: FormatId): Format {
  return { id, ...FORMATS[id] };
}

/** `9:16` → `9x16`, for file names. */
export function formatSlug(id: FormatId): string {
  return id.replace(':', 'x');
}
