// Cropped ATM · snack pad vs front street (grey pad must not overlap the roadway).
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
mkdirSync(resolve(root, 'docs/screens'), { recursive: true });
const out = resolve(root, 'docs/screens/town-atm-pad.png');
const urlFile = resolve(root, 'orchestrator/.run/ui-url.txt'), prevUrl = existsSync(urlFile) ? readFileSync(urlFile, 'utf8') : null;
const env = { ...process.env }; delete env.OFFICE_PROMETHEUS_URL;
const p = spawn(resolve(root, 'orchestrator/node_modules/.bin/tsx'), ['orchestrator/src/cli.ts', 'start', '--demo', '--port', '0', '--step-ms', '1800'], { cwd: root, env, stdio: ['ignore', 'ignore', 'pipe'] });
const url = await new Promise((res, rej) => {
  p.stderr.on('data', (d) => { if (/\[office\] UI:/.test(String(d))) res(readFileSync(urlFile, 'utf8').trim()); });
  setTimeout(() => rej(new Error('no start')), 20000);
});
if (prevUrl != null) writeFileSync(urlFile, prevUrl, { mode: 0o600 });
const errors = [];
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    localStorage.setItem('vp-debug', '1');
    localStorage.setItem('vp-labels', JSON.stringify({ cafe: true, massage: true, bbq: true, trada: true, pond: true, bia: true, garden: false, smoke: false, gym: false, atm: true, gate: false, pod: false, print: false, pantry: false, game: false, workroom: false, monitor: 'alert' }));
  });
  const pg = await ctx.newPage(); pg.on('pageerror', (e) => errors.push(e.message));
  await pg.goto(url); await pg.waitForSelector('[data-testid=conn]:has-text("live")');
  await pg.waitForSelector('[data-testid=vp-atm]', { timeout: 45000 });
  const stageEl = pg.locator('[data-testid=office-vanphong]');
  let stage = await stageEl.boundingBox();
  const cx = stage.x + stage.width / 2, cy = stage.y + stage.height / 2;
  await pg.mouse.move(cx, cy);
  for (let i = 0; i < 8; i++) { await pg.mouse.wheel(0, 280); await pg.waitForTimeout(60); }
  await pg.waitForTimeout(400);
  for (let attempt = 0; attempt < 12; attempt++) {
    stage = await stageEl.boundingBox();
    const b = await pg.locator('[data-testid=vp-atm]').first().boundingBox();
    if (b && b.x > stage.x + 40 && b.y > stage.y + 40 && b.x < stage.x + stage.width - 40 && b.y < stage.y + stage.height - 40) {
      await pg.mouse.move(b.x + b.width / 2, b.y + 40);
      await pg.mouse.down({ button: 'right' }); await pg.mouse.move(cx, cy, { steps: 16 }); await pg.mouse.up({ button: 'right' });
      break;
    }
    const dirs = [[-280, 0], [280, 0], [0, -220], [0, 220], [200, 160], [-200, 160], [200, -160], [-200, -160]];
    const [dx, dy] = dirs[attempt % dirs.length];
    await pg.mouse.move(cx, cy); await pg.mouse.down({ button: 'right' }); await pg.mouse.move(cx + dx, cy + dy, { steps: 12 }); await pg.mouse.up({ button: 'right' });
    await pg.waitForTimeout(180);
  }
  await pg.mouse.move(cx, cy);
  for (let i = 0; i < 7; i++) { await pg.mouse.wheel(0, -260); await pg.waitForTimeout(90); }
  await pg.mouse.down({ button: 'right' }); await pg.mouse.move(cx, cy - 70, { steps: 10 }); await pg.mouse.up({ button: 'right' });
  await pg.waitForTimeout(500);
  stage = await stageEl.boundingBox();
  const b = await pg.locator('[data-testid=vp-atm]').first().boundingBox();
  if (!b || !stage) errors.push('no atm/stage box');
  else {
    const w = 520, h = 300;
    const x = Math.min(Math.max(stage.x, b.x + b.width / 2 - w / 2), stage.x + stage.width - w);
    const y = Math.min(Math.max(stage.y, b.y - 16), stage.y + stage.height - h);
    await pg.screenshot({ path: out, clip: { x, y, width: Math.min(w, stage.width), height: Math.min(h, stage.height) } });
  }
  await ctx.close();
  console.log('shot', out, 'errors', JSON.stringify(errors));
} finally { await browser.close(); p.kill('SIGTERM'); }
if (errors.length) process.exitCode = 1;
