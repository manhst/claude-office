// Headless screenshots of the mock office. Starts its own orchestrator (mock, multi-agent) and kills only that process.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = (n) => resolve(root, `docs/screens/phase2-${n}.png`);
const orch = spawn(resolve(root, 'orchestrator/node_modules/.bin/tsx'),
  ['orchestrator/src/cli.ts', 'start', '--mock', '--office', '--mock-delay', '650', '--start-delay', '2500', '--keep-alive', '--port', '0',
   'Plan a Claude Code mod that shows the virtual office'], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] });
let uiUrl;
await new Promise((res, rej) => { orch.stderr.on('data', (d) => { if (/\[office\] UI:/.test(String(d)) && !uiUrl) { uiUrl = readFileSync(resolve(root, 'orchestrator/.run/ui-url.txt'), 'utf8').trim(); res(); } }); orch.on('exit', rej); setTimeout(() => rej(new Error('orchestrator did not start')), 10000); });
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(uiUrl);
  await page.waitForSelector('[data-testid=conn]:has-text("live")');
  if (page.url().includes('token=')) throw new Error('token not stripped from URL');
  await page.screenshot({ path: out('1-initial') });
  await page.waitForSelector('[data-testid=agent-researcher] .chip'); await page.waitForTimeout(300);
  await page.screenshot({ path: out('2-working') });
  await page.waitForSelector('.env-ask >> nth=0'); await page.waitForSelector('[data-testid=agent-coder] .chip'); await page.waitForTimeout(400);
  await page.screenshot({ path: out('3-messages') });
  await page.waitForSelector('.env-reply', { timeout: 30000 }); await page.waitForTimeout(200);
  await page.screenshot({ path: out('4-replies') });
  await page.waitForSelector('[data-testid=agent-researcher][data-state=done]', { timeout: 60000 });
  await page.waitForTimeout(4500); // let message wires fade
  await page.screenshot({ path: out('5-done') });
  console.log('screens written to docs/screens/phase2-*.png');
} finally { await browser.close(); orch.kill('SIGINT'); }
