import { z } from 'zod';

export const FORMATS = {
  '9:16': { w: 1080, h: 1920 },
  '1:1': { w: 1080, h: 1080 },
  '4:5': { w: 1080, h: 1350 },
  '16:9': { w: 1920, h: 1080 },
} as const;

export const FormatId = z.enum(['9:16', '1:1', '4:5', '16:9']);
export type FormatId = z.infer<typeof FormatId>;

export interface Format {
  id: FormatId;
  w: number;
  h: number;
}

export function format(id: FormatId): Format {
  return { id, ...FORMATS[id] };
}
