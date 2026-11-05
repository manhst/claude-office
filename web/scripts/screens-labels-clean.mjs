// Screenshot: default structure labels (shops + pond only; Monitor hidden when ok).
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = resolve(root, 'docs/screens/town-labels-clean.png');
const env = { ...process.env }; delete env.OFFICE_PROMETHEUS_URL;
const p = spawn(resolve(root, 'orchestrator/node_modules/.bin/tsx'), ['orchestrator/src/cli.ts', 'start', '--demo', '--port', '0', '--step-ms', '1800'], { cwd: root, env, stdio: ['ignore', 'ignore', 'pipe'] });
const url = await new Promise((res, rej) => {
  p.stderr.on('data', (d) => { if (/\[office\] UI:/.test(String(d))) res(readFileSync(resolve(root, 'orchestrator/.run/ui-url.txt'), 'utf8').trim()); });
  setTimeout(() => rej(new Error('no start')), 20000);
});
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  // Force default labels (clear any leftover prefs) and skip vp-debug clutter.
  await ctx.addInitScript(() => {
    localStorage.removeItem('vp-labels');
    localStorage.removeItem('vp-debug');
  });
  const pg = await ctx.newPage(); pg.on('pageerror', (e) => errors.push(e.message));
  await pg.goto(url); await pg.waitForSelector('[data-testid=conn]:has-text("live")');
  await pg.waitForSelector('[data-testid=vp-cafe]', { timeout: 45000 });
  await pg.waitForTimeout(2800);
  // Zoom out so shops + pond + office fit.
  const stage = await pg.locator('[data-testid=office-vanphong]').boundingBox();
  const cx = stage.x + stage.width / 2, cy = stage.y + stage.height / 2;
  await pg.mouse.move(cx, cy);
  for (let i = 0; i < 6; i++) { await pg.mouse.wheel(0, 260); await pg.waitForTimeout(80); }
  await pg.waitForTimeout(600);
  // Assert hidden amenity labels are not displayed.
  const check = await pg.evaluate(() => {
    const vis = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return 'missing';
      if (el.classList.contains('nhan-an')) return 'hidden';
      return getComputedStyle(el).display === 'none' ? 'hidden' : 'shown';
    };
    return {
      cafe: vis('[data-testid=vp-cafe]'),
      massage: vis('[data-testid=vp-massage]'),
      bbq: vis('[data-testid=vp-xem-nuong]'),
      trada: vis('[data-testid=vp-trada]'),
      pond: vis('[data-testid=vp-pond]'),
      gate: vis('[data-testid=vp-gate]'),
      gym: vis('[data-testid=vp-gym]'),
      smoke: vis('[data-testid=vp-smoke]'),
      atm: vis('[data-testid=vp-atm]'),
      print: vis('[data-testid=vp-print]'),
      pod: vis('[data-testid=vp-pod]'),
      garden: vis('[data-testid=vp-garden]'),
      noc: vis('[data-testid=noc]'),
    };
  });
  for (const k of ['cafe', 'massage', 'bbq', 'trada', 'pond']) if (check[k] !== 'shown') errors.push(`${k}=${check[k]}`);
  for (const k of ['gate', 'gym', 'smoke', 'atm', 'print', 'pod', 'garden']) if (check[k] !== 'hidden') errors.push(`${k}=${check[k]}`);
  // noc may be shown briefly during demo alert — wait until ok/hidden if possible
  await pg.waitForFunction(() => {
    const el = document.querySelector('[data-testid=noc]');
    return !el || getComputedStyle(el).display === 'none' || el.classList.contains('noc-alert') || el.classList.contains('noc-error');
  }, null, { timeout: 20000 }).catch(() => {});
  // If currently alert, wait a cycle for ok (demo alternates ~15s) — or just accept and note.
  const nocState = await pg.evaluate(() => {
    const el = document.querySelector('[data-testid=noc]');
    if (!el) return 'missing';
    if (getComputedStyle(el).display === 'none') return 'hidden';
    return [...el.classList].find((c) => c.startsWith('noc-')) || 'shown';
  });
  if (nocState !== 'hidden' && nocState !== 'noc-alert' && nocState !== 'noc-error') errors.push(`noc=${nocState}`);
  await pg.locator('[data-testid=office-vanphong]').screenshot({ path: out });
  await ctx.close();
  console.log('shot', out, 'check', JSON.stringify(check), 'noc', nocState, 'errors', JSON.stringify(errors));
} finally { await browser.close(); p.kill('SIGTERM'); }
if (errors.length) process.exitCode = 1;
