// node tools/sheet.mjs out.jpg t0 t1 step  → contact sheet of frames (480x270 tiles)
import puppeteer from 'puppeteer-core'; import path from 'node:path'; import { pathToFileURL } from 'node:url'; import { spawnSync } from 'node:child_process'; import fs from 'node:fs';
const [out, t0 = 0, t1 = 34, step = 1] = process.argv.slice(2); const tmp = out + '.d'; fs.mkdirSync(tmp, { recursive: true });
const b = await puppeteer.launch({ executablePath: (process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'), headless: 'new', defaultViewport: { width: 960, height: 540 }, args: ['--allow-file-access-from-files'] });
const p = await b.newPage(); p.on('pageerror', (e) => { console.log('PAGE ERROR', e.message); process.exit(1); });
await p.goto(pathToFileURL(path.resolve('index.html')).href + '?pr=1', { waitUntil: 'networkidle0' }); await p.waitForFunction(() => window.ready === true, { timeout: 120000 });
const files = []; for (let t = +t0; t <= +t1 + 1e-6; t += +step) { await p.evaluate((x) => window.seek(x), t); await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); const f = `${tmp}/${String(files.length).padStart(3, '0')}.jpg`; await p.screenshot({ path: f, type: 'jpeg', quality: 80 }); files.push(f); }
await b.close();
const cols = 6, ins = files.flatMap((f) => ['-i', f]), sc = files.map((_, i) => `[${i}]scale=480:270[s${i}];`).join(''), lay = files.map((_, i) => `${(i % cols) * 480}_${Math.floor(i / cols) * 270}`).join('|');
const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...ins, '-filter_complex', `${sc}${files.map((_, i) => `[s${i}]`).join('')}xstack=inputs=${files.length}:layout=${lay}:fill=black`, out], { stdio: 'inherit' }); console.log('sheet', out, files.length);
