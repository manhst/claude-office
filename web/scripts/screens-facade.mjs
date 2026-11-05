// Screenshots: front glass facade + printer/photocopier at the back wall.
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
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => { localStorage.removeItem('vp-labels'); localStorage.removeItem('vp-debug'); });
  const pg = await ctx.newPage(); pg.on('pageerror', (e) => errors.push(e.message));
  await pg.goto(url); await pg.waitForSelector('[data-testid=conn]:has-text("live")');
  await pg.waitForSelector('[data-testid=vp-print]', { timeout: 45000, state: 'attached' });
  await pg.waitForTimeout(2500);
  const stage = pg.locator('[data-testid=office-vanphong]');
  const box = await stage.boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const steps = JSON.parse(process.env.SHOTS ?? JSON.stringify([
    ['town-front-glass-facade', []],
    ['town-printer-back-wall', [['pan', 30, -180], ['plus', 4], ['rot', -5, 20]]],
  ]));
  for (const [name, ops] of steps) {
    for (const [op, a, b] of ops) {
      await pg.mouse.move(cx, cy);
      if (op === 'plus') for (let i = 0; i < a; i++) { await pg.getByRole('button', { name: 'Zoom in' }).first().click(); await pg.waitForTimeout(250); }
      if (op === 'zoom') for (let i = 0; i < Math.abs(a); i++) { await pg.mouse.wheel(0, a > 0 ? 200 : -200); await pg.waitForTimeout(60); }
      if (op === 'pan') { await pg.mouse.down(); await pg.mouse.move(cx + a, cy + b, { steps: 12 }); await pg.mouse.up(); }
      if (op === 'rot') { await pg.mouse.down({ button: 'right' }); await pg.mouse.move(cx + a, cy + b, { steps: 12 }); await pg.mouse.up({ button: 'right' }); }
      await pg.waitForTimeout(300);
    }
    await pg.waitForTimeout(500);
    await stage.screenshot({ path: resolve(root, `docs/screens/${name}.png`) });
  }
  await ctx.close();
  console.log('shots ok', 'errors', JSON.stringify(errors));
} finally { await browser.close(); p.kill('SIGTERM'); }
if (errors.length) process.exitCode = 1;
