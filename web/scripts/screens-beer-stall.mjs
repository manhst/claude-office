// Screenshots: the beer stall across from the gate + completed office shell.
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
mkdirSync(resolve(root, 'docs/screens'), { recursive: true });
const runDir = mkdtempSync(join(tmpdir(), 'deck-screens-')); // temp DECK_RUN_DIR: never overwrite the live orchestrator/.run/ui-url.txt
const env = { ...process.env, DECK_RUN_DIR: runDir }; for (const k of ['DECK_PROMETHEUS_URL', 'OFFICE_PROMETHEUS_URL', 'OFFICE_RUN_DIR']) delete env[k];
const p = spawn(resolve(root, 'orchestrator/node_modules/.bin/tsx'), ['orchestrator/src/cli.ts', 'start', '--demo', '--port', '0', '--step-ms', '1500'], { cwd: root, env, stdio: ['ignore', 'ignore', 'pipe'] });
const url = await new Promise((res, rej) => {
  p.stderr.on('data', (d) => { if (/\[deck\] UI:/.test(String(d))) res(readFileSync(join(runDir, 'ui-url.txt'), 'utf8').trim()); });
  setTimeout(() => rej(new Error('no start')), 20000);
});
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => { localStorage.removeItem('deck.labels'); localStorage.removeItem('deck.debug'); });
  const pg = await ctx.newPage(); pg.on('pageerror', (e) => errors.push(e.message));
  await pg.goto(url); await pg.waitForSelector('[data-testid=conn]:has-text("live")');
  await pg.waitForSelector('[data-testid=office3d-beer-stall]', { timeout: 45000 });
  await pg.waitForTimeout(2500);
  const stage = pg.locator('[data-testid=office-view]');
  const box = await stage.boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await pg.mouse.move(cx, cy);
  for (let i = 0; i < 5; i++) { await pg.mouse.wheel(0, 280); await pg.waitForTimeout(60); }
  // Pan toward SW (gate + beer stall)
  await pg.mouse.down(); await pg.mouse.move(cx + 180, cy - 120, { steps: 12 }); await pg.mouse.up();
  await pg.waitForTimeout(400);
  await stage.screenshot({ path: resolve(root, 'docs/screens/town-beer-stall.png') });
  // Office shell: pan back / zoom to building
  await pg.mouse.move(cx, cy);
  for (let i = 0; i < 3; i++) { await pg.mouse.wheel(0, -200); await pg.waitForTimeout(60); }
  await pg.mouse.down(); await pg.mouse.move(cx - 100, cy + 80, { steps: 10 }); await pg.mouse.up();
  await pg.waitForTimeout(400);
  await stage.screenshot({ path: resolve(root, 'docs/screens/town-office-shell.png') });
  const beer = await pg.evaluate(() => {
    const el = document.querySelector('[data-testid=office3d-beer-stall]');
    return el && !el.classList.contains('label-hidden') ? 'shown' : 'hidden';
  });
  if (beer !== 'shown') errors.push(`beer=${beer}`);
  await ctx.close();
  console.log('shots ok', 'beer-stall', beer, 'errors', JSON.stringify(errors));
} finally { await browser.close(); p.kill('SIGTERM'); }
if (errors.length) process.exitCode = 1;
