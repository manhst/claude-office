// Screenshot: Prompt composer under Responses. Demo sessions have no $.prompt.submit — Send stays disabled, labeled DEMO.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
mkdirSync(resolve(root, 'docs/screens'), { recursive: true });
const out = resolve(root, 'docs/screens/session-composer.png');
const urlFile = resolve(root, 'orchestrator/.run/ui-url.txt'), prevUrl = existsSync(urlFile) ? readFileSync(urlFile, 'utf8') : null;
const env = { ...process.env }; delete env.OFFICE_PROMETHEUS_URL;
const p = spawn(process.execPath, [resolve(root, 'orchestrator/node_modules/tsx/dist/cli.mjs'), 'orchestrator/src/cli.ts', 'start', '--demo', '--port', '0', '--step-ms', '900'], { cwd: root, env, stdio: ['ignore', 'ignore', 'pipe'] });
const url = await new Promise((res, rej) => {
  p.stderr.on('data', (d) => { if (/\[office\] UI:/.test(String(d))) res(readFileSync(urlFile, 'utf8').trim()); });
  setTimeout(() => rej(new Error('no start')), 20000);
});
if (prevUrl != null) writeFileSync(urlFile, prevUrl, { mode: 0o600 });
const errors = [];
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => { localStorage.removeItem('vp-collapse'); });
  const pg = await ctx.newPage(); pg.on('pageerror', (e) => errors.push(e.message));
  await pg.goto(url); await pg.waitForSelector('[data-testid=conn]:has-text("live")');
  await pg.waitForSelector('[data-testid=prompt-composer]');
  const demo = await pg.locator('[data-testid=composer-demo]').innerText();
  if (!/DEMO/.test(demo)) errors.push('missing DEMO label');
  if (!(await pg.locator('[data-testid=composer-send]').isDisabled())) errors.push('send should be disabled in demo');
  await pg.locator('[data-testid=composer-text]').fill('demo payload — not a live Claude submit');
  await pg.locator('[data-testid=prompt-composer]').screenshot({ path: out });
  await ctx.close();
  console.log('shot', out, 'errors', JSON.stringify(errors));
} finally { await browser.close(); p.kill('SIGTERM'); }
if (errors.length) process.exitCode = 1;
