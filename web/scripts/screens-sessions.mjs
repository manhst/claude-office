// Demo-mode screenshots: start the server with --demo (3 simulated sessions), open the token URL headless, capture 1280 + 390 widths.
// Kills only the server it started. Never prints the UI URL (it carries the run token).
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = (n) => resolve(root, `docs/screens/session-${n}.png`);
const p = spawn(resolve(root, 'orchestrator/node_modules/.bin/tsx'), ['orchestrator/src/cli.ts', 'start', '--demo', '--port', '0', '--step-ms', '1800'], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] });
const url = await new Promise((res, rej) => { p.stderr.on('data', (d) => /\[office\] UI:/.test(String(d)) && res(readFileSync(resolve(root, 'orchestrator/.run/ui-url.txt'), 'utf8').trim())); setTimeout(() => rej(new Error('no start')), 15000); });
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
try {
  for (const [w, h] of [[1280, 860], [390, 1400]]) {
    { const view = 'vanphong';
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
      const pg = await ctx.newPage(); pg.on('pageerror', (e) => errors.push(e.message));
      await pg.goto(url); await pg.waitForSelector('[data-testid=conn]:has-text("live")');
      await pg.waitForFunction(() => document.querySelectorAll('[data-testid^=session-demo]').length === 3, null, { timeout: 15000 });
      await pg.waitForTimeout(7000);
      if (w === 1280) { await pg.click('[data-testid=session-demo-blog-0002]'); await pg.waitForTimeout(300); await pg.screenshot({ path: out('1280-vanphong-claude-md') }); await pg.click('[data-testid=session-demo-shop-0001]'); await pg.waitForTimeout(300); }
      await pg.screenshot({ path: out(`${w}-${view}`), fullPage: w === 390 });
      console.log(view, w, 'sessions', await pg.locator('[data-testid^=session-demo]').count(), 'profiles', await pg.locator('[data-testid=profile]').count());
      await ctx.close();
    }
  }
} finally { await browser.close(); p.kill('SIGTERM'); }
console.log('errors', JSON.stringify(errors));
