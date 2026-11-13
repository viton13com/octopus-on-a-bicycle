import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: (process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'), headless: 'new', args: ['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist'] });
const p = await b.newPage();
const r = await p.evaluate(() => { const c = document.createElement('canvas'); const g = c.getContext('webgl2'); if (!g) return 'no webgl2'; const d = g.getExtension('WEBGL_debug_renderer_info'); return g.getParameter(d ? d.UNMASKED_RENDERER_WEBGL : g.RENDERER) + ' | maxTex ' + g.getParameter(g.MAX_TEXTURE_SIZE) + ' | float rt ' + !!g.getExtension('EXT_color_buffer_float'); });
console.log(r); await b.close();
