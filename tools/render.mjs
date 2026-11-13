#!/usr/bin/env node
/* node tools/render.mjs --name=octo --size=1920x1080 --pr=1.5 --fps=60 --sub=4 [--t0=0 --t1=34] [--sound=out/sound.wav]
 * Each output frame = SUB sub-frames over a 180° shutter, blended (tmix) → real motion blur on spokes, chain and arms. */
import puppeteer from 'puppeteer-core'; import { spawn, spawnSync } from 'node:child_process'; import fs from 'node:fs'; import path from 'node:path'; import { pathToFileURL, fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), OUT = path.join(ROOT, 'out');
const opt = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const NAME = opt('name', 'octo'), [W, H] = opt('size', '1920x1080').split('x').map(Number), PR = opt('pr', '1.5'), FPS = +opt('fps', '60'), SUB = +opt('sub', '4'), SHUT = 0.5;
fs.mkdirSync(OUT, { recursive: true });
const b = await puppeteer.launch({ executablePath: (process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'), headless: 'new', defaultViewport: { width: W, height: H, deviceScaleFactor: 1 }, args: ['--allow-file-access-from-files', '--hide-scrollbars', '--mute-audio', '--ignore-gpu-blocklist'], protocolTimeout: 600000 });
const p = await b.newPage(); p.on('pageerror', (e) => { console.log('PAGE ERROR', e.message); process.exit(1); });
await p.goto(pathToFileURL(path.join(ROOT, 'index.html')).href + `?pr=${PR}`, { waitUntil: 'networkidle0', timeout: 300000 }); await p.waitForFunction(() => window.ready === true, { timeout: 300000 });
const dur = await p.evaluate(() => window.DURATION), t0 = +opt('t0', '0'), t1 = +opt('t1', String(dur));
const frames = Math.round((t1 - t0) * FPS), silent = path.join(OUT, `${NAME}-silent.mp4`);
const vf = SUB > 1 ? `tmix=frames=${SUB}:weights='${Array(SUB).fill(1).join(' ')}',select='eq(mod(n\\,${SUB})\\,${SUB - 1})',setpts=N/${FPS}/TB,` : '';
const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS * SUB), '-c:v', 'mjpeg', '-i', '-', '-vf', `${vf}setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv`,
  '-r', String(FPS), '-c:v', 'libx264', '-preset', 'slow', '-crf', opt('crf', '14'), '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-movflags', '+faststart', silent], { stdio: ['pipe', 'inherit', 'inherit'] });
const T = Date.now();
for (let n = 0; n < frames; n++) {
  for (let s = 0; s < SUB; s++) { const t = t0 + (n + (SUB > 1 ? s / SUB * SHUT : 0)) / FPS;
    await p.evaluate((x) => { window.seek(x); return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); }, t);
    const buf = await p.screenshot({ type: 'jpeg', quality: 95 }); if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r)); }
  if (n % 60 === 0) { const el = (Date.now() - T) / 1000; console.log(`frame ${n}/${frames}  ${el.toFixed(0)}s  eta ${(el / (n + 1) * (frames - n - 1) / 60).toFixed(1)} min`); }
}
ff.stdin.end(); await new Promise((r) => ff.on('close', r));
await p.evaluate(() => window.seek(31.5)); await p.screenshot({ path: path.join(OUT, `${NAME}-cover.jpg`), type: 'jpeg', quality: 93 }); await b.close();
const wav = opt('sound'), final = path.join(OUT, `${NAME}.mp4`);
if (wav && fs.existsSync(wav)) { spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', silent, '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-shortest', '-movflags', '+faststart', final], { stdio: 'inherit' }); }
else fs.copyFileSync(silent, final);
console.log(`wrote ${final} in ${((Date.now() - T) / 60000).toFixed(1)} min`);
