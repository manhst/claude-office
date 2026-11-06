// Screenshot: left sidebar session CLI dump + Agents, both expanded with collapse toggles (1280).
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
mkdirSync(resolve(root, 'docs/screens'), { recursive: true });
const out = resolve(root, 'docs/screens/session-dump.png');
const env = { ...process.env }; delete env.OFFICE_PROMETHEUS_URL;
const p = spawn(resolve(root, 'orchestrator/node_modules/.bin/tsx'), ['orchestrator/src/cli.ts', 'start', '--demo', '--port', '0', '--step-ms', '1200'], { cwd: root, env, stdio: ['ignore', 'ignore', 'pipe'] });
const url = await new Promise((res, rej) => {
  p.stderr.on('data', (d) => { if (/\[office\] UI:/.test(String(d))) res(readFileSync(resolve(root, 'orchestrator/.run/ui-url.txt'), 'utf8').trim()); });
  setTimeout(() => rej(new Error('no start')), 20000);
});
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    localStorage.removeItem('vp-collapse'); // both expanded by default
    localStorage.removeItem('vp-debug');
  });
  const pg = await ctx.newPage(); pg.on('pageerror', (e) => errors.push(e.message));
  await pg.goto(url); await pg.waitForSelector('[data-testid=conn]:has-text("live")');
  // Wait for a demo session + dump rows
  await pg.waitForSelector('[data-testid=sessions] button.sess', { timeout: 30000 });
  await pg.waitForSelector('[data-testid=session-dump]', { timeout: 30000 });
  await pg.waitForSelector('[data-testid=dump-sid]', { timeout: 10000 });
  await pg.waitForSelector('[data-testid=session-collapse][aria-expanded=true]');
  await pg.waitForSelector('[data-testid=agents-collapse][aria-expanded=true]');
  // Prefer a session that has cwd/transcript (all demos do); click shop-api if present for richer dump
  const shop = pg.locator('[data-testid=session-demo-shop-0001]');
  if (await shop.count()) await shop.click();
  await pg.waitForTimeout(1500);
  // Assert dump has key CLI fields
  for (const id of ['dump-sid', 'dump-cwd', 'dump-transcript', 'dump-state']) {
    if (!(await pg.locator(`[data-testid=${id}]`).count())) errors.push(`missing ${id}`);
  }
  // Collapse controls present
  if (!(await pg.locator('[data-testid=session-collapse]').count())) errors.push('no session-collapse');
  if (!(await pg.locator('[data-testid=agents-collapse]').count())) errors.push('no agents-collapse');
  await pg.screenshot({ path: out });
  await ctx.close();
  console.log('shot', out, 'errors', JSON.stringify(errors));
} finally { await browser.close(); p.kill('SIGTERM'); }
if (errors.length) process.exitCode = 1;
