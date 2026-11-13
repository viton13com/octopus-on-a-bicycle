// node tools/shot.mjs page.html out.jpg WxH "js-expression" [more "js" out pairs...]
import puppeteer from 'puppeteer-core'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const [page_, ...rest] = process.argv.slice(2); const [W, H] = (process.env.SIZE || '1600x900').split('x').map(Number);
const b = await puppeteer.launch({ executablePath: (process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'), headless: 'new', defaultViewport: { width: W, height: H }, args: ['--allow-file-access-from-files', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const p = await b.newPage(); p.on('pageerror', (e) => { console.log('PAGE ERROR', e.message, e.stack); process.exit(1); }); p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warn' || m.text().startsWith('LOG')) console.log(m.type(), m.text()); });
await p.goto(pathToFileURL(path.resolve(page_)).href + (process.env.Q ? '?' + process.env.Q : ''), { waitUntil: 'networkidle0', timeout: 120000 });
await p.waitForFunction(() => window.ready === true, { timeout: 120000 });
for (let i = 0; i < rest.length; i += 2) { const t0 = Date.now(); await p.evaluate(rest[i]); await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); await p.screenshot({ path: rest[i + 1], type: 'jpeg', quality: 90 }); console.log('shot', rest[i + 1], Date.now() - t0, 'ms'); }
await b.close();
