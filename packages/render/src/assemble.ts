/** Chunks → one MP4 per format: concat `-c copy`, AAC mux, `+faststart`, a no-music copy and a thumbnail. */
import { stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { formatSlug, type FormatId } from '@reel/core';
import { ffmpeg } from './util.ts';

export interface Exported {
  format: FormatId;
  video: { path: string; bytes: number };
  noMusic?: { path: string; bytes: number };
  thumbnail: { path: string; bytes: number };
}

export async function assemble(o: {
  jobId: string;
  format: FormatId;
  chunks: string[];
  aac: string;
  outDir: string;
  workDir: string;
  noMusic: boolean;
  /** Thumbnail time (the end card's holdStart). */
  thumbAt: number;
}): Promise<Exported> {
  const base = join(o.outDir, `${o.jobId}-${formatSlug(o.format)}`);
  const list = join(o.workDir, `concat-${formatSlug(o.format)}.txt`);
  await writeFile(list, o.chunks.map((c) => `file '${c.replaceAll("'", "'\\''")}'`).join('\n') + '\n');
  const concat = ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list];

  const size = async (path: string) => ({ path, bytes: (await stat(path)).size });
  const video = `${base}.mp4`;
  const thumbnail = `${base}-thumbnail.jpg`;
  const withMusic = async () => {
    await ffmpeg([...concat, '-i', o.aac, '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-movflags', '+faststart', video]);
    await ffmpeg(['-y', '-v', 'error', '-ss', o.thumbAt.toFixed(3), '-i', video, '-frames:v', '1', '-q:v', '2', thumbnail]);
  };
  const silent = `${base}-no-music.mp4`;
  await Promise.all([
    withMusic(),
    o.noMusic ? ffmpeg([...concat, '-map', '0:v:0', '-c', 'copy', '-movflags', '+faststart', silent]) : null,
  ]);
  return {
    format: o.format,
    video: await size(video),
    thumbnail: await size(thumbnail),
    ...(o.noMusic ? { noMusic: await size(silent) } : {}),
  };
}
