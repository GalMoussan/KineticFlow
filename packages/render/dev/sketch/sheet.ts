/**
 * P0 spike helper: renders labelled SVG cells (or images) into one contact-sheet PNG with headless Chromium.
 *
 *   import { sheet } from './sheet.ts';
 *   await sheet('out/dev/sketch-spikes/s1-gemini.png', cells, { cols: 5, cell: 300 });
 *
 * A cell is `{ label, svg }` (inline SVG markup) or `{ label, src }` (a file path or data: URL of an image).
 */
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { chromium } from 'playwright';

export interface Cell {
  label: string;
  svg?: string;
  src?: string;
  note?: string;
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

async function dataUrl(path: string): Promise<string> {
  if (path.startsWith('data:')) return path;
  const ext = extname(path).slice(1).toLowerCase();
  const mime = ext === 'jpg' ? 'image/jpeg' : ext === 'svg' ? 'image/svg+xml' : `image/${ext}`;
  return `data:${mime};base64,${(await readFile(path)).toString('base64')}`;
}

export async function sheet(out: string, cells: Cell[], o: { cols?: number; cell?: number; title?: string; bg?: string } = {}): Promise<string> {
  const cols = o.cols ?? 5;
  const size = o.cell ?? 300;
  const items = await Promise.all(
    cells.map(async (c) => {
      const body = c.svg ?? (c.src ? `<img src="${await dataUrl(c.src)}">` : '');
      return `<figure><div class="art">${body}</div><figcaption>${esc(c.label)}${c.note ? `<small>${esc(c.note)}</small>` : ''}</figcaption></figure>`;
    }),
  );
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;padding:16px;background:${o.bg ?? '#f4f1ea'};font:14px system-ui,sans-serif;color:#222;width:${cols * (size + 16)}px}
    h1{font-size:18px;margin:0 0 12px}
    .grid{display:grid;grid-template-columns:repeat(${cols},${size}px);gap:16px}
    figure{margin:0}
    .art{width:${size}px;height:${size}px;background:#fff;border:1px solid #ccc;display:flex;align-items:center;justify-content:center}
    .art svg,.art img{max-width:100%;max-height:100%}
    figcaption{margin-top:4px;line-height:1.25}
    small{display:block;color:#666;font-size:12px}
  </style>${o.title ? `<h1>${esc(o.title)}</h1>` : ''}<div class="grid">${items.join('')}</div>`;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: cols * (size + 16) + 32, height: 400 }, deviceScaleFactor: 1 });
    await page.setContent(html);
    const path = resolve(out);
    await mkdir(dirname(path), { recursive: true });
    await page.screenshot({ path, fullPage: true });
    return path;
  } finally {
    await browser.close();
  }
}
