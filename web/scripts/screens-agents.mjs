// Screenshot: Agents panel (replaces Events) + draggable 80:20 split.
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
mkdirSync(resolve(root, 'docs/screens'), { recursive: true });
const out = resolve(root, 'docs/screens/session-agents.png');
const outDrag = resolve(root, 'docs/screens/session-split.png');
const env = { ...process.env }; delete env.OFFICE_PROMETHEUS_URL;
const p = spawn(resolve(root, 'orchestrator/node_modules/.bin/tsx'), ['orchestrator/src/cli.ts', 'start', '--demo', '--port', '0', '--step-ms', '800'], { cwd: root, env, stdio: ['ignore', 'ignore', 'pipe'] });
const url = await new Promise((res, rej) => {
  p.stderr.on('data', (d) => { if (/\[office\] UI:/.test(String(d))) res(readFileSync(resolve(root, 'orchestrator/.run/ui-url.txt'), 'utf8').trim()); });
  setTimeout(() => rej(new Error('no start')), 20000);
});
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    localStorage.removeItem('vp-collapse');
    localStorage.removeItem('vp-split');
    localStorage.removeItem('vp-debug');
  });
  const pg = await ctx.newPage(); pg.on('pageerror', (e) => errors.push(e.message));
  await pg.goto(url); await pg.waitForSelector('[data-testid=conn]:has-text("live")');
  await pg.waitForSelector('[data-testid=sessions] button.sess', { timeout: 30000 });
  const shop = pg.locator('[data-testid=session-demo-shop-0001]');
  if (await shop.count()) await shop.click();
  await pg.waitForSelector('[data-testid=agents-list]', { timeout: 15000 });
  if (await pg.locator('[data-testid=events-collapse]').count()) errors.push('Events section still present');
  if (!(await pg.locator('[data-testid=session-dump]').count())) errors.push('missing session dump');
  if (!(await pg.locator('[data-testid=responses]').count())) errors.push('missing responses');
  await pg.waitForTimeout(2500);
  const rows = await pg.locator('[data-testid^=agent-desk],[data-testid^=agent-sub]').count();
  if (!rows) errors.push('no agent rows');
  await pg.screenshot({ path: out });
  const split = pg.locator('[data-testid=split]');
  const box = await split.boundingBox();
  if (!box) errors.push('no split gutter');
  else {
    const start = { x: box.x + box.width / 2, y: box.y + 40 };
    await pg.mouse.move(start.x, start.y);
    await pg.mouse.down();
    await pg.mouse.move(start.x - 120, start.y, { steps: 8 });
    await pg.mouse.up();
    await pg.waitForTimeout(400);
    const stored = await pg.evaluate(() => localStorage.getItem('vp-split'));
    if (!stored) errors.push('split ratio not persisted');
    else if (Math.abs(Number(stored) - 0.8) < 0.01) errors.push(`split did not move (vp-split=${stored})`);
    const now = Number(await pg.locator('[data-testid=split]').getAttribute('aria-valuenow'));
    if (!(now >= 45 && now <= 82)) errors.push(`split aria-valuenow out of range: ${now}`);
  }
  await pg.screenshot({ path: outDrag });
  const stage = await pg.locator('[data-testid=office-vanphong]').boundingBox();
  const side = await pg.locator('.side').boundingBox();
  if (stage && side && stage.width + side.width > 1280) errors.push('panes overflow viewport');
  await ctx.close();
  console.log('shot', out, outDrag, 'errors', JSON.stringify(errors));
} finally { await browser.close(); p.kill('SIGTERM'); }
if (errors.length) process.exitCode = 1;
try {
  mkdirSync('/opt/cursor/artifacts', { recursive: true });
  copyFileSync(out, '/opt/cursor/artifacts/session-agents.png');
  copyFileSync(outDrag, '/opt/cursor/artifacts/session-split.png');
} catch { /* artifacts dir may be missing outside cloud */ }
