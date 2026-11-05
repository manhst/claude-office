// Screenshots: Xém Nướng, flower-garden romance with hearts, slower-talk overview.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = (n) => resolve(root, `docs/screens/town-${n}.png`);
const env = { ...process.env }; delete env.OFFICE_PROMETHEUS_URL;
const p = spawn(resolve(root, 'orchestrator/node_modules/.bin/tsx'), ['orchestrator/src/cli.ts', 'start', '--demo', '--port', '0', '--step-ms', '1800'], { cwd: root, env, stdio: ['ignore', 'ignore', 'pipe'] });
const url = await new Promise((res, rej) => {
  p.stderr.on('data', (d) => { if (/\[office\] UI:/.test(String(d))) res(readFileSync(resolve(root, 'orchestrator/.run/ui-url.txt'), 'utf8').trim()); });
  setTimeout(() => rej(new Error('no start')), 15000);
});
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = []; const done = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => localStorage.setItem('vp-debug', '1'));
  const pg = await ctx.newPage(); pg.on('pageerror', (e) => errors.push(e.message));
  await pg.goto(url); await pg.waitForSelector('[data-testid=conn]:has-text("live")');
  await pg.waitForSelector('[data-testid=vp-xem-nuong]', { timeout: 30000 }); await pg.waitForTimeout(2500);
  const stage = await pg.locator('[data-testid=office-vanphong]').boundingBox();
  const around = async (sel, w, h, dy = 0) => {
    const b = await pg.locator(sel).first().boundingBox();
    const x = Math.min(Math.max(stage.x, b.x + b.width / 2 - w / 2), stage.x + stage.width - w);
    const y = Math.min(Math.max(stage.y, b.y + b.height / 2 - h / 2 + dy), stage.y + stage.height - h);
    return { clip: { x, y, width: Math.min(w, stage.width), height: Math.min(h, stage.height) } };
  };
  const panTo = async (sel, zooms = 3) => {
    const b = await pg.locator(sel).boundingBox();
    const cx = stage.x + stage.width / 2, cy = stage.y + stage.height / 2;
    await pg.mouse.move(b.x + b.width / 2, b.y + 60);
    await pg.mouse.down({ button: 'right' });
    await pg.mouse.move(cx, cy, { steps: 18 });
    await pg.mouse.up({ button: 'right' });
    await pg.mouse.move(cx, cy);
    for (let i = 0; i < zooms; i++) { await pg.mouse.wheel(0, -220); await pg.waitForTimeout(120); }
    await pg.waitForTimeout(500);
  };

  await panTo('[data-testid=vp-xem-nuong]', 4);
  await pg.screenshot({ path: out('xem-nuong'), ...(await around('[data-testid=vp-xem-nuong]', 820, 680, 180)) });
  done.push('xem-nuong');

  await panTo('[data-testid=vp-garden]', 2);
  await pg.evaluate(() => window.__vpTown.romance());
  await pg.waitForFunction(() => document.querySelectorAll('[data-act=romance]').length >= 2, null, { timeout: 60000 }).catch(() => errors.push('romance NPCs missing'));
  await pg.waitForTimeout(2500);
  await pg.waitForFunction(() => document.querySelectorAll('[data-act=romance]').length >= 1, null, { timeout: 5000 }).catch(() => {});
  // Force a few heart bursts at the couple for a clear shot
  await pg.evaluate(() => {
    const el = document.querySelector('[data-act=romance]');
    const g = document.querySelector('[data-testid=vp-garden]');
    for (let i = 0; i < 4; i++) window.__vpTown.hearts();
  });
  await pg.waitForFunction(() => document.querySelectorAll('.vp-heart').length > 0, null, { timeout: 8000 }).catch(() => errors.push('no heart particles'));
  await pg.waitForTimeout(350);
  await pg.screenshot({ path: out('flower-garden'), ...(await around('[data-testid=vp-garden]', 900, 700, 80)) });
  done.push('flower-garden');

  {
    const cx = stage.x + stage.width / 2, cy = stage.y + stage.height * 0.45;
    await pg.mouse.move(cx, cy);
    for (let i = 0; i < 7; i++) { await pg.mouse.wheel(0, 260); await pg.waitForTimeout(80); }
    await pg.waitForTimeout(800);
  }
  await pg.locator('[data-testid=office-vanphong]').screenshot({ path: out('slower-talk') });
  done.push('slower-talk');

  await ctx.close();
} finally { await browser.close(); p.kill('SIGTERM'); }
console.log('shots', done.join(' '), 'errors', JSON.stringify(errors));
