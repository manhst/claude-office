// Phase-3 screenshots: one mock office run, watched by a 2D page and a 3D page at once. Kills only the orchestrator it started.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = (n) => resolve(root, `docs/screens/phase3-${n}.png`);
const orch = spawn(resolve(root, 'orchestrator/node_modules/.bin/tsx'),
  ['orchestrator/src/cli.ts', 'start', '--mock', '--office', '--mock-delay', '700', '--start-delay', '6000', '--keep-alive', '--port', '0',
   'Plan a Claude Code mod that shows the virtual office'], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] });
let uiUrl;
await new Promise((res, rej) => { orch.stderr.on('data', (d) => { if (/\[office\] UI:/.test(String(d)) && !uiUrl) { uiUrl = readFileSync(resolve(root, 'orchestrator/.run/ui-url.txt'), 'utf8').trim(); res(); } }); orch.on('exit', rej); setTimeout(() => rej(new Error('no start')), 10000); });
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
const open = async (view) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript((v) => localStorage.setItem('office.view', v), view);
  const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(`${view}: ${e.message}`)); p.on('console', (m) => m.type() === 'error' && errors.push(`${view}: ${m.text()}`));
  await p.goto(uiUrl); await p.waitForSelector('[data-testid=conn]:has-text("live")'); return p;
};
const rafFps = (p, ms = 3000) => p.evaluate((ms) => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; performance.now() - t0 < ms ? requestAnimationFrame(f) : r(Math.round(n * 1000 / (performance.now() - t0))); }; requestAnimationFrame(f); }), ms);
const fps = {};
try {
  const p2 = await open('2d'), p3 = await open('3d');
  await p3.waitForSelector('[data-testid=office3d] canvas');
  await p3.waitForTimeout(1500); await p3.screenshot({ path: out('3d-1-initial') });
  fps.idle3d = await rafFps(p3);
  await p3.waitForSelector('[data-testid=agent3d-researcher] .chip', { timeout: 20000 }); await p3.waitForTimeout(900);
  await p3.screenshot({ path: out('3d-2-working') });
  fps.working3d = await rafFps(p3, 2000); fps.r3fReported = await p3.evaluate(() => window.__officeFps);
  await p2.waitForSelector('[data-testid=msg-card]', { timeout: 30000 }); await p3.waitForSelector('[data-testid=msg-card3d]');
  await p2.waitForTimeout(500); await p2.screenshot({ path: out('2d-messages') }); await p3.screenshot({ path: out('3d-3-messages') });
  // overlap check: message card must not intersect any agent name/chip
  fps.overlap2d = await p2.evaluate(() => { const r = (e) => e.getBoundingClientRect(); const cards = [...document.querySelectorAll('[data-testid=msg-card]')].map(r);
    const parts = [...document.querySelectorAll('.agent .name, .agent .chip, .agent .avatar')].map(r);
    return cards.some((c) => parts.some((p) => c.left < p.right && c.right > p.left && c.top < p.bottom && c.bottom > p.top)); });
  await p3.waitForSelector('.env-reply', { timeout: 30000 }); await p3.waitForTimeout(600); await p3.screenshot({ path: out('3d-4-replies') });
  fps.messages3d = await rafFps(p3, 2000);
  await p2.waitForSelector('[data-testid=agent-researcher][data-state=done]', { timeout: 60000 }); await p2.waitForTimeout(4500);
  await p2.screenshot({ path: out('2d-done') }); await p3.screenshot({ path: out('3d-5-done') });
  fps.done2d = await rafFps(p2, 2000);
  fps.emoji = await p2.evaluate(() => /\p{Extended_Pictographic}/u.test(document.body.innerText));
  // camera limit check: drag to orbit below the floor and zoom far out; camera must stay above the floor and within maxDistance
  const box = await p3.locator('canvas').boundingBox();
  await p3.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p3.mouse.down(); await p3.mouse.move(box.x + box.width / 2, box.y + 5, { steps: 20 }); await p3.mouse.up();
  for (let i = 0; i < 20; i++) await p3.mouse.wheel(0, 400);
  await p3.waitForTimeout(800); await p3.screenshot({ path: out('3d-6-camera-limits') });
  await p2.context().close(); await p3.context().close();
} finally { orch.kill('SIGINT'); }
// FPS pass: a fresh mock run watched by the 3D page alone (no competing 2D page), sampled every second.
const orch2 = spawn(resolve(root, 'orchestrator/node_modules/.bin/tsx'),
  ['orchestrator/src/cli.ts', 'start', '--mock', '--office', '--mock-delay', '300', '--start-delay', '2000', '--keep-alive', '--port', '0', 'fps run'], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] });
uiUrl = undefined;
await new Promise((res) => orch2.stderr.on('data', (d) => { if (/\[office\] UI:/.test(String(d)) && !uiUrl) { uiUrl = readFileSync(resolve(root, 'orchestrator/.run/ui-url.txt'), 'utf8').trim(); res(); } }));
try {
  const p = await open('3d'); await p.waitForSelector('[data-testid=office3d] canvas'); await p.waitForTimeout(1000);
  const samples = [];
  for (let i = 0; i < 14; i++) samples.push(await rafFps(p, 1000));
  fps.solo3d = { samples, avg: Math.round(samples.reduce((a, b) => a + b, 0) / samples.length), min: Math.min(...samples) };
  fps.renderer = await p.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); const e = c?.getExtension('WEBGL_debug_renderer_info'); return e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
  console.log(JSON.stringify({ fps, errors: errors.slice(0, 5) }));
} finally { await browser.close(); orch2.kill('SIGINT'); }
