import puppeteer from 'puppeteer-core'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const b = await puppeteer.launch({ executablePath: (process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'), headless: 'new', defaultViewport: { width: 480, height: 270 }, args: ['--allow-file-access-from-files'] });
const p = await b.newPage(); p.on('console', (m) => console.log(m.text()));
await p.goto(pathToFileURL(path.resolve('index.html')).href + '?pr=1', { waitUntil: 'networkidle0' }); await p.waitForFunction(() => window.ready === true, { timeout: 120000 });
console.log(await p.evaluate(process.argv[2]));
await b.close();
