// Screenshots: outdoor amenities (smoke/gym/ATM/gate/pod/print) + a drama bubble moment.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = (n) => resolve(root, `docs/screens/town-${n}.png`);
const env = { ...process.env }; delete env.OFFICE_PROMETHEUS_URL;
const p = spawn(resolve(root, 'orchestrator/node_modules/.bin/tsx'), ['orchestrator/src/cli.ts', 'start', '--demo', '--port', '0', '--step-ms', '1800'], { cwd: root, env, stdio: ['ignore', 'ignore', 'pipe'] });
const url = await new Promise((res, rej) => {
  p.stderr.on('data', (d) => { if (/\[office\] UI:/.test(String(d))) res(readFileSync(resolve(root, 'orchestrator/.run/ui-url.txt'), 'utf8').trim()); });
  setTimeout(() => rej(new Error('no start')), 20000);
});
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = []; const done = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => localStorage.setItem('vp-debug', '1'));
  const pg = await ctx.newPage(); pg.on('pageerror', (e) => errors.push(e.message));
  await pg.goto(url); await pg.waitForSelector('[data-testid=conn]:has-text("live")');
  await pg.waitForSelector('[data-testid=vp-smoke]', { timeout: 45000 }); await pg.waitForTimeout(3000);
  let stage = await pg.locator('[data-testid=office-vanphong]').boundingBox();

  const refreshStage = async () => { stage = await pg.locator('[data-testid=office-vanphong]').boundingBox(); };

  const around = async (sel, w, h, dy = 0) => {
    await refreshStage();
    const b = await pg.locator(sel).first().boundingBox();
    if (!b || !stage) {
      errors.push(`no box for ${sel}`);
      return { clip: { x: stage.x, y: stage.y, width: Math.min(w, stage.width), height: Math.min(h, stage.height) } };
    }
    const x = Math.min(Math.max(stage.x, b.x + b.width / 2 - w / 2), stage.x + stage.width - w);
    const y = Math.min(Math.max(stage.y, b.y + b.height / 2 - h / 2 + dy), stage.y + stage.height - h);
    return { clip: { x, y, width: Math.min(w, stage.width), height: Math.min(h, stage.height) } };
  };

  // Drag-pan the camera until the label is near the stage centre (labels off-canvas have null boxes).
  const panTo = async (sel, zooms = 4) => {
    await refreshStage();
    const cx = stage.x + stage.width / 2, cy = stage.y + stage.height / 2;
    // Zoom out first so more of the town is on screen (labels get boxes).
    await pg.mouse.move(cx, cy);
    for (let i = 0; i < 8; i++) { await pg.mouse.wheel(0, 280); await pg.waitForTimeout(60); }
    await pg.waitForTimeout(400);
    for (let attempt = 0; attempt < 10; attempt++) {
      const b = await pg.locator(sel).first().boundingBox();
      if (b && b.x > stage.x + 40 && b.y > stage.y + 40 && b.x < stage.x + stage.width - 40 && b.y < stage.y + stage.height - 40) {
        await pg.mouse.move(b.x + b.width / 2, b.y + 40);
        await pg.mouse.down({ button: 'right' });
        await pg.mouse.move(cx, cy, { steps: 16 });
        await pg.mouse.up({ button: 'right' });
        break;
      }
      // Nudge camera toward missing label: try cardinal pans
      const dirs = [[-280, 0], [280, 0], [0, -220], [0, 220], [-200, -160], [200, 160], [-200, 160], [200, -160]];
      const [dx, dy] = dirs[attempt % dirs.length];
      await pg.mouse.move(cx, cy);
      await pg.mouse.down({ button: 'right' });
      await pg.mouse.move(cx + dx, cy + dy, { steps: 12 });
      await pg.mouse.up({ button: 'right' });
      await pg.waitForTimeout(200);
    }
    await pg.mouse.move(cx, cy);
    for (let i = 0; i < zooms; i++) { await pg.mouse.wheel(0, -240); await pg.waitForTimeout(100); }
    await pg.waitForTimeout(500);
  };

  const shot = async (name, sel, w, h, dy = 0, zooms = 4) => {
    await panTo(sel, zooms);
    await pg.waitForTimeout(500);
    await pg.screenshot({ path: out(name), ...(await around(sel, w, h, dy)) });
    done.push(name);
  };

  await shot('smoke-corner', '[data-testid=vp-smoke]', 780, 600, 40, 5);
  await shot('gym-yard', '[data-testid=vp-gym]', 960, 680, 80, 5);
  await shot('atm-snack', '[data-testid=vp-atm]', 780, 600, 40, 4);
  await shot('security-gate', '[data-testid=vp-gate]', 780, 600, 40, 4);
  await shot('meeting-pod', '[data-testid=vp-pod]', 860, 640, 60, 5);
  await shot('print-kiosk', '[data-testid=vp-print]', 760, 560, 40, 4);

  await panTo('[data-testid=vp-smoke]', 5);
  await pg.evaluate(() => window.__vpTown.drama('smoke'));
  await pg.waitForFunction(() => document.querySelectorAll('[data-act=smoke],[data-act=walk]').length >= 2, null, { timeout: 20000 }).catch(() => errors.push('drama NPCs missing'));
  // Wait until they arrive (act=smoke) or bubbles show while walking
  await pg.waitForFunction(() => {
    const els = [...document.querySelectorAll('[data-act=smoke], [data-act=walk]')];
    return els.some((e) => e.classList.contains('co-bong'));
  }, null, { timeout: 45000 }).catch(() => errors.push('no drama bubble'));
  await pg.waitForTimeout(1500);
  // Prefer framing the smoking NPCs if present
  const dramaSel = (await pg.locator('[data-act=smoke]').count()) >= 1 ? '[data-act=smoke]' : '[data-testid=vp-smoke]';
  await pg.screenshot({ path: out('drama-smoke'), ...(await around(dramaSel, 880, 680, 40)) });
  done.push('drama-smoke');

  await ctx.close();
} finally { await browser.close(); p.kill('SIGTERM'); }
console.log('shots', done.join(' '), 'errors', JSON.stringify(errors));
