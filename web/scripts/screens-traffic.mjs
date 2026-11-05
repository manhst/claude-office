// Demo-mode screenshots: Xuka Mát xa (opposite Crossian Cafe), main-road traffic, a crash argument, a vehicle fire + explosion.
// Starts the server with --demo, kills only that server. Never prints the UI URL (it carries the run token).
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = (n) => resolve(root, `docs/screens/town-${n}.png`);
const env = { ...process.env }; delete env.OFFICE_PROMETHEUS_URL;
const p = spawn(resolve(root, 'orchestrator/node_modules/.bin/tsx'), ['orchestrator/src/cli.ts', 'start', '--demo', '--port', '0', '--step-ms', '1800'], { cwd: root, env, stdio: ['ignore', 'ignore', 'pipe'] });
const url = await new Promise((res, rej) => { p.stderr.on('data', (d) => /\[office\] UI:/.test(String(d)) && res(readFileSync(resolve(root, 'orchestrator/.run/ui-url.txt'), 'utf8').trim())); setTimeout(() => rej(new Error('no start')), 15000); });
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = []; const done = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => localStorage.setItem('vp-debug', '1'));
  const pg = await ctx.newPage(); pg.on('pageerror', (e) => errors.push(e.message));
  await pg.goto(url); await pg.waitForSelector('[data-testid=conn]:has-text("live")');
  await pg.waitForSelector('[data-testid^=vp-agent-] .ten-3d', { timeout: 20000 }); await pg.waitForTimeout(3000);
  const stage = await pg.locator('[data-testid=office-vanphong]').boundingBox();
  const around = async (sel, w, h, dy = 0) => { const b = await pg.locator(sel).first().boundingBox(); const x = Math.min(Math.max(stage.x, b.x + b.width / 2 - w / 2), stage.x + stage.width - w), y = Math.min(Math.max(stage.y, b.y + b.height / 2 - h / 2 + dy), stage.y + stage.height - h); return { clip: { x, y, width: Math.min(w, stage.width), height: Math.min(h, stage.height) } }; };
  // traffic: a few vehicles on the main road
  await pg.waitForFunction(() => document.querySelectorAll('[data-testid^=xe-][data-state=drive]').length >= 2, null, { timeout: 60000 }).catch(() => errors.push('fewer than 2 vehicles'));
  await pg.screenshot({ path: out('traffic'), clip: { x: stage.x, y: stage.y + stage.height * 0.45, width: stage.width, height: stage.height * 0.55 } }); done.push('traffic');
  // crash argument
  await pg.evaluate(() => window.__vpTraffic.crash(560));
  await pg.waitForFunction(() => document.querySelectorAll('[data-state=argue].co-bong').length > 0, null, { timeout: 8000 });
  await pg.waitForTimeout(300);
  await pg.screenshot({ path: out('crash-argue'), ...(await around('[data-state=argue]', 760, 420, 40)) }); done.push('crash-argue');
  // fire, then the explosion
  await pg.evaluate(() => window.__vpTraffic.fire(1050));
  await pg.waitForTimeout(2500);
  await pg.screenshot({ path: out('fire'), ...(await around('[data-state=fire]', 640, 440, 60)) }); done.push('fire');
  await pg.waitForSelector('[data-state=boom]', { timeout: 12000 }); await pg.waitForTimeout(300);
  await pg.screenshot({ path: out('explosion'), ...(await around('[data-state=boom]', 640, 440, 60)) }); done.push('explosion');
  // massage shop: wait for someone lying on a bed (or just the shop)
  await pg.waitForFunction(() => document.querySelectorAll('[data-act=massage]').length > 0, null, { timeout: 90000 }).catch(() => errors.push('no one went to massage within 90s'));
  await pg.waitForTimeout(800);
  { const b = await pg.locator('[data-testid=vp-massage]').boundingBox(); const cx = stage.x + stage.width / 2, cy = stage.y + stage.height / 2; await pg.mouse.move(b.x + b.width / 2, b.y + 80); await pg.mouse.down({ button: 'right' }); await pg.mouse.move(cx, cy, { steps: 20 }); await pg.mouse.up({ button: 'right' }); await pg.waitForTimeout(300); await pg.mouse.move(cx, cy); for (let i = 0; i < 3; i++) { await pg.mouse.wheel(0, -250); await pg.waitForTimeout(150); } await pg.waitForTimeout(800); }
  await pg.screenshot({ path: out('massage'), ...(await around('[data-testid=vp-massage]', 760, 620, 220)) }); done.push('massage');
  await ctx.close();
} finally { await browser.close(); p.kill('SIGTERM'); }
console.log('shots', done.join(' '), 'errors', JSON.stringify(errors));
