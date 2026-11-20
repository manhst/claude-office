// Screenshot: Settings panel (Prometheus form, no secrets shown).
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
mkdirSync(resolve(root, 'docs/screens'), { recursive: true });
const out = resolve(root, 'docs/screens/settings.png');
const runDir = mkdtempSync(join(tmpdir(), 'deck-screens-')); // temp DECK_RUN_DIR: never overwrite the live orchestrator/.run/ui-url.txt
const env = { ...process.env, DECK_RUN_DIR: runDir }; for (const k of ['DECK_PROMETHEUS_URL', 'OFFICE_PROMETHEUS_URL', 'OFFICE_RUN_DIR']) delete env[k];
const p = spawn(resolve(root, 'orchestrator/node_modules/.bin/tsx'), ['orchestrator/src/cli.ts', 'start', '--demo', '--port', '0', '--step-ms', '2000'], { cwd: root, env, stdio: ['ignore', 'ignore', 'pipe'] });
const url = await new Promise((res, rej) => {
  p.stderr.on('data', (d) => { if (/\[deck\] UI:/.test(String(d))) res(readFileSync(join(runDir, 'ui-url.txt'), 'utf8').trim()); });
  setTimeout(() => rej(new Error('no start')), 15000);
});
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  const pg = await ctx.newPage(); pg.on('pageerror', (e) => errors.push(e.message));
  await pg.goto(url); await pg.waitForSelector('[data-testid=conn]:has-text("live")');
  await pg.waitForTimeout(800);
  await pg.click('[data-testid=settings-open]');
  await pg.waitForSelector('[data-testid=settings-panel]');
  await pg.waitForSelector('[data-testid=settings-demo]');
  // Fill a placeholder URL without real secrets for the shot (don't Save — just show the form).
  await pg.fill('[data-testid=settings-prom-url]', 'http://monitor:***@prometheus.example:9090');
  await pg.waitForTimeout(200);
  await pg.locator('[data-testid=settings-panel] .settings-panel, .settings-panel').first().screenshot({ path: out }).catch(async () => {
    await pg.locator('[data-testid=settings-panel]').screenshot({ path: out });
  });
  // Prefer clipping the inner editor panel
  const box = await pg.locator('.settings-panel').boundingBox();
  if (box) await pg.screenshot({ path: out, clip: { x: Math.max(0, box.x - 8), y: Math.max(0, box.y - 8), width: Math.min(box.width + 16, 1400), height: Math.min(box.height + 16, 900) } });
  await ctx.close();
} finally { await browser.close(); p.kill('SIGTERM'); }
console.log('shot', out, 'errors', JSON.stringify(errors));
