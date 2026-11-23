import { z } from 'zod';

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Output sizes and the area text must stay inside. The 9:16 insets keep clear of the Instagram Reels UI
 * (caption/buttons at the bottom, header at the top); verify against the current app before M6 (PLAN.md §14).
 */
export const FORMATS = {
  '9:16': { w: 1080, h: 1920, safe: { top: 220, right: 70, bottom: 380, left: 70 } },
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
