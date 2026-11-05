// Screenshots: Layoff hunt, eat-on-spot, pond drop.
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
mkdirSync(resolve(root, 'docs/screens'), { recursive: true });
const out = (n) => resolve(root, `docs/screens/layoff-${n}.png`);
const env = { ...process.env }; delete env.OFFICE_PROMETHEUS_URL;
const p = spawn(resolve(root, 'orchestrator/node_modules/.bin/tsx'), ['orchestrator/src/cli.ts', 'start', '--demo', '--port', '0', '--step-ms', '2000'], { cwd: root, env, stdio: ['ignore', 'ignore', 'pipe'] });
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
  await pg.waitForTimeout(1800);
  const stage = pg.locator('[data-testid=office-vanphong]');
  const box = await stage.boundingBox();
  const dismiss = async () => {
    await pg.keyboard.press('Escape').catch(() => {});
    if (box) await pg.mouse.click(box.x + 40, box.y + 40);
    await pg.waitForTimeout(150);
  };
  const zoomOut = async (n = 10) => {
    if (!box) return;
    await pg.mouse.move(box.x + box.width / 2, box.y + box.height * 0.55);
    for (let i = 0; i < n; i++) { await pg.mouse.wheel(0, 280); await pg.waitForTimeout(60); }
  };
  const panToward = async (sel) => {
    if (!box) return;
    const b = await pg.locator(sel).first().boundingBox().catch(() => null);
    if (!b) return;
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    // left-drag rotate is fine; use right-drag pan but start from empty sky to avoid context menus
    await pg.mouse.move(box.x + 80, box.y + 80);
    await pg.mouse.down({ button: 'right' });
    await pg.mouse.move(cx - (b.x - cx) * 0.85, cy - (b.y - cy) * 0.85, { steps: 20 });
    await pg.mouse.up({ button: 'right' });
    await pg.waitForTimeout(350);
  };
  const shotAround = async (sel, path, w = 980, h = 760, dy = 60) => {
    await dismiss();
    await panToward(sel);
    const b = await pg.locator(sel).first().boundingBox();
    if (!b || !box) { await stage.screenshot({ path }); return; }
    const x = Math.min(Math.max(box.x, b.x + b.width / 2 - w / 2), box.x + box.width - w);
    const y = Math.min(Math.max(box.y, b.y + b.height / 2 - h / 2 + dy), box.y + box.height - h);
    await pg.screenshot({ path, clip: { x, y, width: Math.min(w, box.width), height: Math.min(h, box.height) } });
  };

  await zoomOut(8);

  // 1) Hunt — Layoff next to a panicking idle NPC (no resolve yet)
  await pg.evaluate(() => window.__vpTown.layoff('hunt'));
  await pg.waitForSelector('[data-testid=ent-layoff]', { state: 'attached', timeout: 10000 });
  await pg.waitForFunction(() => {
    const el = document.querySelector('[data-testid=ent-layoff]');
    return el && getComputedStyle(el).display !== 'none' && el.dataset.act === 'hunt';
  }, null, { timeout: 8000 }).catch(() => errors.push('layoff not hunting'));
  await pg.waitForTimeout(500);
  await shotAround('[data-testid=ent-layoff]', out('hunt'));
  done.push('hunt');

  // 2) Eat
  await pg.evaluate(() => window.__vpTown.layoffEat());
  await pg.waitForFunction(() => document.querySelector('[data-testid=ent-layoff]')?.dataset.act === 'chomp', null, { timeout: 8000 }).catch(() => errors.push('no chomp'));
  await pg.waitForTimeout(350);
  await shotAround('[data-testid=ent-layoff]', out('eat'), 980, 760, 30);
  done.push('eat');

  // 3) Pond
  await pg.evaluate(() => window.__vpTown.layoffPond());
  await pg.waitForFunction(() => {
    const L = document.querySelector('[data-testid=ent-layoff]');
    return L && (L.dataset.act === 'carry' || document.querySelector('[data-act=carried]') || document.querySelector('[data-act=fall]'));
  }, null, { timeout: 8000 }).catch(() => errors.push('no carry'));
  // Advance toward splash
  for (let i = 0; i < 30; i++) {
    const donePond = await pg.evaluate(() => !!(document.querySelector('[data-act=fall]') || document.querySelector('[data-act=eaten]')));
    if (donePond) break;
    await pg.waitForTimeout(350);
  }
  await pg.waitForTimeout(400);
  const pondCount = await pg.locator('[data-testid=vp-pond]').count();
  if (pondCount) await shotAround('[data-testid=vp-pond]', out('pond'), 1000, 780, 100);
  else await shotAround('[data-testid=ent-layoff]', out('pond'), 1000, 780, 40);
  done.push('pond');

  await ctx.close();
} finally { await browser.close(); p.kill('SIGTERM'); }
console.log('shots', done.join(' '), 'errors', JSON.stringify(errors));
