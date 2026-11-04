// ref-ui screenshots: the ported Vanphong view through several states of a mock run (+ a night shot).
// Kills only the orchestrators it started. Never prints the UI URL (it carries the run token).
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = (n) => resolve(root, `docs/screens/refui-${n}.png`);
const startOrch = (args, task) => new Promise((res, rej) => {
  const p = spawn(resolve(root, 'orchestrator/node_modules/.bin/tsx'), ['orchestrator/src/cli.ts', 'start', '--mock', '--office', '--keep-alive', '--port', '0', ...args, task], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'], detached: true });
  let done = false;
  p.stderr.on('data', (d) => { if (!done && /\[office\] UI:/.test(String(d))) { done = true; res({ p, url: readFileSync(resolve(root, 'orchestrator/.run/ui-url.txt'), 'utf8').trim() }); } });
  p.on('exit', () => !done && rej(new Error('orchestrator exited'))); setTimeout(() => !done && rej(new Error('no start')), 15000);
});
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [], csp = [];
const open = async (url, night) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript((n) => { localStorage.setItem('office.view', 'vanphong'); localStorage.setItem('office.vp.night', n ? '1' : '0'); }, night);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); if (/Content Security Policy/i.test(m.text())) csp.push(m.text()); });
  await p.goto(url); await p.waitForSelector('[data-testid=conn]:has-text("live")'); await p.waitForSelector('[data-testid=office-vanphong] canvas'); return p;
};
const states = (p) => p.evaluate(() => Object.fromEntries([...document.querySelectorAll('.nguoi-3d')].map((e) => [e.dataset.nv, `${e.dataset.state}/${e.dataset.phase}`])));
const res = {};
const step = async (p, name, sel, timeout) => { try { await p.waitForSelector(sel, { state: 'attached', timeout }); } catch { res[`timeout_${name}`] = await states(p); } };
let o = await startOrch(['--mock-delay', '900', '--start-delay', '4000'], 'Plan a Claude Code mod that shows the virtual office');
try {
  const p = await open(o.url, false);
  await p.waitForTimeout(1500); await p.screenshot({ path: out('1-empty-office') });
  await p.waitForFunction(() => document.querySelectorAll('.nguoi-3d').length >= 3, null, { timeout: 20000 }); await p.waitForTimeout(1200);
  res.walkIn = await states(p); await p.screenshot({ path: out('2-walk-in') });
  await step(p, 'data-phase', '.nguoi-3d[data-phase=seated][data-state=working]', 30000); await p.waitForTimeout(600);
  res.working = await states(p); await p.screenshot({ path: out('3-working') });
  await step(p, 'data-phase', '.nguoi-3d[data-phase=walking]:not([data-state=idle])', 40000); await p.waitForTimeout(400);
  res.walkToColleague = await states(p); await p.screenshot({ path: out('4-walk-to-colleague') });
  await step(p, 'data-phase', '.nguoi-3d[data-phase=waiting]', 30000); await p.waitForTimeout(600);
  res.waiting = await states(p); await p.screenshot({ path: out('5-asking-at-desk') });
  await step(p, 'data-nv=re', '.nguoi-3d[data-nv^=researcher][data-state=done]', 90000); await p.waitForTimeout(2500);
  res.done = await states(p); await p.screenshot({ path: out('6-done') });
  await p.click('[data-3d=ngay-dem]'); await p.waitForTimeout(800); await p.screenshot({ path: out('7-done-night') });
  res.emoji = await p.evaluate(() => /\p{Extended_Pictographic}/u.test(document.body.innerText));
  await p.click('[data-testid=view-2d]'); await p.waitForTimeout(300); res.backTo2d = await p.locator('[data-testid=office-vanphong]').count() === 0;
  await p.context().close();
} finally { await browser.close(); try { process.kill(-o.p.pid, 'SIGINT'); } catch { /* already gone */ } }
console.log(JSON.stringify({ ...res, csp: csp.slice(0, 3), errors: errors.slice(0, 5) }));
