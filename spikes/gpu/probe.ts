/** Spike M0a step 1: which launch modes give a hardware WebGL context on this Mac? */
import { launch, type Mode } from '../lib.ts';

const modes: Mode[] = ['shell-nogpu', 'shell', 'new-headless', 'chrome', 'headed'];
for (const mode of modes) {
  const t0 = performance.now();
  try {
    const browser = await launch(mode);
    const page = await browser.newPage();
    const info = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return { webgl2: false };
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        webgl2: true,
        renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      };
    });
    console.log(JSON.stringify({ mode, version: browser.version(), ms: Math.round(performance.now() - t0), ...info }));
    await browser.close();
  } catch (e) {
    console.log(JSON.stringify({ mode, error: String(e).split('\n')[0] }));
  }
}
