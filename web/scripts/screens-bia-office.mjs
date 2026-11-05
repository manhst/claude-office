// Screenshots: Bia Hải Xồm across from gate + completed office shell.
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
mkdirSync(resolve(root, 'docs/screens'), { recursive: true });
const env = { ...process.env }; delete env.OFFICE_PROMETHEUS_URL;
const p = spawn(resolve(root, 'orchestrator/node_modules/.bin/tsx'), ['orchestrator/src/cli.ts', 'start', '--demo', '--port', '0', '--step-ms', '1500'], { cwd: root, env, stdio: ['ignore', 'ignore', 'pipe'] });
const url = await new Promise((res, rej) => {
  p.stderr.on('data', (d) => { if (/\[office\] UI:/.test(String(d))) res(readFileSync(resolve(root, 'orchestrator/.run/ui-url.txt'), 'utf8').trim()); });
  setTimeout(() => rej(new Error('no start')), 20000);
});
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => { localStorage.removeItem('vp-labels'); localStorage.removeItem('vp-debug'); });
  const pg = await ctx.newPage(); pg.on('pageerror', (e) => errors.push(e.message));
  await pg.goto(url); await pg.waitForSelector('[data-testid=conn]:has-text("live")');
  await pg.waitForSelector('[data-testid=vp-bia]', { timeout: 45000 });
  await pg.waitForTimeout(2500);
  const stage = pg.locator('[data-testid=office-vanphong]');
  const box = await stage.boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await pg.mouse.move(cx, cy);
  for (let i = 0; i < 5; i++) { await pg.mouse.wheel(0, 280); await pg.waitForTimeout(60); }
  // Pan toward SW (gate + bia)
  await pg.mouse.down(); await pg.mouse.move(cx + 180, cy - 120, { steps: 12 }); await pg.mouse.up();
  await pg.waitForTimeout(400);
  await stage.screenshot({ path: resolve(root, 'docs/screens/town-bia-hai-xom.png') });
  // Office shell: pan back / zoom to building
  await pg.mouse.move(cx, cy);
  for (let i = 0; i < 3; i++) { await pg.mouse.wheel(0, -200); await pg.waitForTimeout(60); }
  await pg.mouse.down(); await pg.mouse.move(cx - 100, cy + 80, { steps: 10 }); await pg.mouse.up();
  await pg.waitForTimeout(400);
  await stage.screenshot({ path: resolve(root, 'docs/screens/town-office-shell.png') });
  const bia = await pg.evaluate(() => {
    const el = document.querySelector('[data-testid=vp-bia]');
    return el && !el.classList.contains('nhan-an') ? 'shown' : 'hidden';
  });
  if (bia !== 'shown') errors.push(`bia=${bia}`);
  await ctx.close();
  console.log('shots ok', 'bia', bia, 'errors', JSON.stringify(errors));
} finally { await browser.close(); p.kill('SIGTERM'); }
if (errors.length) process.exitCode = 1;
