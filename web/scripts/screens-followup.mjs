// Demo screenshots after the IT Ops / Architect / labels / agent-massage / ambulance follow-up.
// Starts the server with --demo, kills only that server. Never prints the UI URL (it carries the run token).
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
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = []; const done = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => localStorage.setItem('vp-debug', '1'));
  const pg = await ctx.newPage(); pg.on('pageerror', (e) => errors.push(e.message));
  await pg.goto(url); await pg.waitForSelector('[data-testid=conn]:has-text("live")');
  await pg.waitForSelector('[data-testid^=vp-agent-] .ten-3d', { timeout: 20000 }); await pg.waitForTimeout(3500);
  const stage = await pg.locator('[data-testid=office-vanphong]').boundingBox();
  const around = async (sel, w, h, dy = 0) => { const b = await pg.locator(sel).first().boundingBox(); const x = Math.min(Math.max(stage.x, b.x + b.width / 2 - w / 2), stage.x + stage.width - w), y = Math.min(Math.max(stage.y, b.y + b.height / 2 - h / 2 + dy), stage.y + stage.height - h); return { clip: { x, y, width: Math.min(w, stage.width), height: Math.min(h, stage.height) } }; };

  // Office interior: IT Ops inside, no Architect label, smaller name tags
  const arch = await pg.locator('.ten-3d:has-text("Architect")').count();
  if (arch) errors.push('Architect still visible');
  await pg.screenshot({ path: out('office-itops'), ...(await around('[data-testid=ent-itops]', 900, 560, 40)) }); done.push('office-itops');

  // Smaller labels overview
  await pg.locator('[data-testid=office-vanphong]').screenshot({ path: out('labels') }); done.push('labels');

  // Agent at Xuka (walk there) — wait for an agent with phase waiting at massage, or any massage act
  await pg.waitForFunction(() => {
    const a = [...document.querySelectorAll('[data-testid^=vp-agent-]')].some((el) => el.querySelector('.ten-3d small')?.textContent === 'mát xa' || el.className.includes(''));
    const n = document.querySelectorAll('[data-act=massage]').length > 0;
    // agents don't set data-act; look for lying agent near massage sign by checking idle — fall back to NPC massage
    return n || a;
  }, null, { timeout: 120000 }).catch(() => errors.push('nobody at massage within 120s'));
  // Force-pan to massage
  { const b = await pg.locator('[data-testid=vp-massage]').boundingBox(); const cx = stage.x + stage.width / 2, cy = stage.y + stage.height / 2;
    await pg.mouse.move(b.x + b.width / 2, b.y + 80); await pg.mouse.down({ button: 'right' }); await pg.mouse.move(cx, cy, { steps: 18 }); await pg.mouse.up({ button: 'right' });
    await pg.mouse.move(cx, cy); for (let i = 0; i < 3; i++) { await pg.mouse.wheel(0, -220); await pg.waitForTimeout(120); } await pg.waitForTimeout(600); }
  await pg.screenshot({ path: out('agent-massage'), ...(await around('[data-testid=vp-massage]', 780, 640, 200)) }); done.push('agent-massage');

  // Reset camera toward the front street, then force a fire so ambulance + fire truck arrive
  await pg.evaluate(() => { const el = document.querySelector('[data-testid=office-vanphong]'); el?.dispatchEvent(new Event('click')); });
  // rough re-center: right-drag toward stage center from a bottom point, then zoom out
  { const cx = stage.x + stage.width / 2, cy = stage.y + stage.height * 0.55;
    await pg.mouse.move(cx, stage.y + 80); await pg.mouse.down({ button: 'right' }); await pg.mouse.move(cx, cy, { steps: 16 }); await pg.mouse.up({ button: 'right' });
    await pg.mouse.move(cx, cy); for (let i = 0; i < 5; i++) { await pg.mouse.wheel(0, 280); await pg.waitForTimeout(80); } }
  await pg.evaluate(() => window.__vpTraffic.fire(780));
  await pg.waitForFunction(() => [...document.querySelectorAll('[data-testid^=xe-]')].some((el) => el.dataset.type === 'cuu-thuong' && el.dataset.state === 'parked')
    || [...document.querySelectorAll('[data-testid^=xe-]')].some((el) => el.dataset.type === 'cuu-thuong'), null, { timeout: 20000 }).catch(() => errors.push('no ambulance'));
  await pg.waitForTimeout(3500);
  await pg.screenshot({ path: out('ambulance'), clip: { x: stage.x, y: stage.y + stage.height * 0.35, width: stage.width, height: stage.height * 0.62 } }); done.push('ambulance');
  const hasArch = await pg.evaluate(() => [...document.querySelectorAll('.ten-3d')].some((el) => /Architect/i.test(el.textContent || '')));
  if (hasArch) errors.push('Architect label still in DOM');
  const itopsInside = await pg.evaluate(() => { const el = document.querySelector('[data-testid=ent-itops]'); return !!el && !el.closest('[data-testid=xe-]'); });
  if (!itopsInside) errors.push('IT Ops missing');

  await ctx.close();
} finally { await browser.close(); p.kill('SIGTERM'); }
console.log('shots', done.join(' '), 'errors', JSON.stringify(errors));
