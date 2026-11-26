import { z } from 'zod';

/** Ids of styles, traits, sections, assets: lowercase kebab-case. Its own module so `style.ts` and `sketch.ts` can share it without an import cycle. */
export const Slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lowercase-kebab-case id');
