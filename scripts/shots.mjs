// Dev helper: screenshots of the running dev server (npm run dev). Usage:
//   node scripts/shots.mjs <outdir> name=querystring...   e.g. raised="wb=nhd:demo-lake-tahoe&view=raised"
import { chromium } from 'playwright';
const [, , out, ...specs] = process.argv;
const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: [
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--no-sandbox',
  ],
});
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
p.on('console', (m) => {
  if (m.type() === 'error') errs.push(m.text());
});
for (const s of specs) {
  const [name, qs] =
    s.split('=', 2).length === 2
      ? [s.slice(0, s.indexOf('=')), s.slice(s.indexOf('=') + 1)]
      : [s, ''];
  await p.goto(`http://localhost:5173/?${qs}`);
  await p.waitForTimeout(+(process.env.WAIT ?? 6000));
  await p.screenshot({ path: `${out}/${name}.png` });
  console.log('shot', name);
}
if (errs.length) console.log('ERRORS:\n' + [...new Set(errs)].slice(0, 15).join('\n'));
await b.close();
