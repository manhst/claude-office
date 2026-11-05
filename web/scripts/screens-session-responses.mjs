// Screenshot: left sidebar Responses section (with Session + Events collapse controls), 1280.
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
mkdirSync(resolve(root, 'docs/screens'), { recursive: true });
const out = resolve(root, 'docs/screens/session-responses.png');
const env = { ...process.env }; delete env.OFFICE_PROMETHEUS_URL;
const p = spawn(resolve(root, 'orchestrator/node_modules/.bin/tsx'), ['orchestrator/src/cli.ts', 'start', '--demo', '--port', '0', '--step-ms', '900'], { cwd: root, env, stdio: ['ignore', 'ignore', 'pipe'] });
const url = await new Promise((res, rej) => {
  p.stderr.on('data', (d) => { if (/\[office\] UI:/.test(String(d))) res(readFileSync(resolve(root, 'orchestrator/.run/ui-url.txt'), 'utf8').trim()); });
  setTimeout(() => rej(new Error('no start')), 20000);
});
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => { localStorage.removeItem('vp-collapse'); });
  const pg = await ctx.newPage(); pg.on('pageerror', (e) => errors.push(e.message));
  await pg.goto(url); await pg.waitForSelector('[data-testid=conn]:has-text("live")');
  await pg.waitForSelector('[data-testid=responses]', { timeout: 30000 });
  await pg.waitForSelector('[data-testid=responses-collapse][aria-expanded=true]');
  // Wait until at least one response row appears (demo emits agent.text / agent.done)
  await pg.waitForSelector('[data-testid=responses-list] [data-testid^=response-]', { timeout: 45000 });
  await pg.waitForTimeout(800);
  if (!(await pg.locator('[data-testid=session-collapse]').count())) errors.push('no session-collapse');
  if (!(await pg.locator('[data-testid=events-collapse]').count())) errors.push('no events-collapse');
  await pg.screenshot({ path: out });
  await ctx.close();
  console.log('shot', out, 'errors', JSON.stringify(errors));
} finally { await browser.close(); p.kill('SIGTERM'); }
if (errors.length) process.exitCode = 1;
