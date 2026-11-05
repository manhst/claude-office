// Demo-mode screenshots of the town (2D view): overview, cafe + trà đá, croc pond throw, IT Ops reporting, dog vs cat, name/avatar editor.
// Starts the server with --demo (IT Ops in labelled demo mode), kills only that server. Never prints the UI URL (it carries the run token).
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
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: true });
const errors = []; const done = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1100 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => localStorage.setItem('office.view', '2d'));
  const pg = await ctx.newPage(); pg.on('pageerror', (e) => errors.push(e.message));
  await pg.goto(url); await pg.waitForSelector('[data-testid=conn]:has-text("live")');
  await pg.waitForSelector('.town [data-testid^=agent-]', { timeout: 15000 }); await pg.waitForTimeout(3000);
  const town = await pg.locator('[data-testid=town]').boundingBox();
  const z = town.width / 1600; const clip = (x, y, w, h) => ({ clip: { x: town.x + x * z, y: town.y + y * z, width: w * z, height: h * z } });
  // name/avatar editor on the first agent
  await pg.locator('.town [data-testid^=agent-]').first().click({ button: 'right' }); await pg.click('[data-testid=ctx-edit]');
  await pg.fill('[data-testid=editor-name]', 'Hùng Coder'); await pg.click('[data-testid=preset-nam_05]'); await pg.waitForTimeout(200);
  await pg.locator('[data-testid=editor]').screenshot({ path: out('editor') }); done.push('editor');
  await pg.click('[data-testid=editor-save]');
  await pg.locator('[data-testid=ent-npc-2]').click(); await pg.click('[data-testid=ctx-edit]'); await pg.click('button:has-text("Nữ")'); await pg.click('[data-testid=preset-nu_10]'); await pg.click('[data-testid=editor-save]');
  await pg.waitForTimeout(4000);
  await pg.locator('[data-testid=town]').screenshot({ path: out('overview') }); done.push('overview');
  await pg.waitForFunction(() => document.querySelector('[data-testid=ent-npc-1], [data-testid=ent-npc-2], [data-testid=ent-npc-3], [data-testid=ent-npc-4]') && [...document.querySelectorAll('[data-act=drink],[data-act=beer]')].length > 0, null, { timeout: 60000 }).catch(() => {});
  await pg.screenshot({ path: out('cafe-trada'), ...clip(1290, 100, 310, 560) }); done.push('cafe-trada');
  // throw the second agent into the croc pond
  await pg.locator('.town [data-testid^=agent-]').nth(1).click({ button: 'right' }); await pg.click('[data-testid=ctx-throw]');
  await pg.waitForTimeout(1000);
  await pg.screenshot({ path: out('croc-throw'), ...clip(0, 250, 760, 560) }); done.push('croc-throw');
  // IT Ops (demo monitor alternates ok/alert every 15 s) runs to the Architect
  await pg.waitForSelector('.bubble.alert', { timeout: 45000 });
  await pg.screenshot({ path: out('itops-report'), ...clip(560, 760, 900, 320) }); done.push('itops-report');
  // dog vs cat
  await pg.waitForFunction(() => document.querySelector('[data-testid=ent-cat]')?.getAttribute('data-act') === 'fight', null, { timeout: 120000, polling: 100 });
  const cat = await pg.locator('[data-testid=ent-cat]').boundingBox();
  await pg.screenshot({ path: out('dog-cat'), clip: { x: Math.max(town.x, cat.x - 220 * z), y: Math.max(town.y, cat.y - 160 * z), width: 480 * z, height: 300 * z } }); done.push('dog-cat');
  await ctx.close();
} finally { await browser.close(); p.kill('SIGTERM'); }
console.log('shots', done.join(' '), 'errors', JSON.stringify(errors));
