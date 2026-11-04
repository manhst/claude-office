// Phase-4 screenshots + video: mock office run in 3D (walking, waiting, models), a capsule-fallback check, and a solo fps pass.
// Kills only the orchestrators it started. Never prints the UI URL (it carries the run token).
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, renameSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = (n) => resolve(root, `docs/screens/phase4-${n}.png`);
const startOrch = (args, task) => new Promise((res, rej) => {
  const p = spawn(resolve(root, 'orchestrator/node_modules/.bin/tsx'), ['orchestrator/src/cli.ts', 'start', '--mock', '--office', '--keep-alive', '--port', '0', ...args, task], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] });
  let done = false;
  p.stderr.on('data', (d) => { if (!done && /\[office\] UI:/.test(String(d))) { done = true; res({ p, url: readFileSync(resolve(root, 'orchestrator/.run/ui-url.txt'), 'utf8').trim() }); } });
  p.on('exit', () => !done && rej(new Error('orchestrator exited'))); setTimeout(() => !done && rej(new Error('no start')), 15000);
});
const withQuery = (u, q) => u.replace('/#', `/?${q}#`);
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
const vidDir = resolve(root, 'web/.video'); rmSync(vidDir, { recursive: true, force: true }); mkdirSync(vidDir, { recursive: true });
const open = async (url, { video = false } = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...(video ? { recordVideo: { dir: vidDir, size: { width: 1280, height: 800 } } } : {}) });
  await ctx.addInitScript(() => localStorage.setItem('office.view', '3d'));
  const p = await ctx.newPage(); p.on('pageerror', (e) => !/missing\.glb/.test(e.message) && errors.push(e.message)); p.on('console', (m) => m.type() === 'error' && !/missing\.glb|404/.test(m.text()) && errors.push(m.text()));
  await p.goto(url); await p.waitForSelector('[data-testid=conn]:has-text("live")'); await p.waitForSelector('[data-testid=office3d] canvas'); return p;
};
const rafFps = (p, ms = 3000) => p.evaluate((ms) => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; performance.now() - t0 < ms ? requestAnimationFrame(f) : r(Math.round(n * 1000 / (performance.now() - t0))); }; requestAnimationFrame(f); }), ms);
const overlap3d = (p) => p.evaluate(() => { const r = (e) => e.getBoundingClientRect(); const fixed = [...document.querySelectorAll('[data-lbl=fixed]')].map(r), mov = [...document.querySelectorAll('[data-lbl=move]')].map(r).filter((b) => b.width);
  const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  return { names: fixed.length, movable: mov.length, overlaps: mov.filter((m) => fixed.some((f) => hit(m, f))).length + mov.filter((m, i) => mov.some((n, j) => j > i && hit(m, n))).length }; });
const phases = (p) => p.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-testid^=agent3d-]')].map((e) => [e.dataset.testid.slice(8), e.dataset.phase])));
const res = { overlaps: [] };
let o = await startOrch(['--mock-delay', '900', '--start-delay', '4000'], 'Plan a Claude Code mod that shows the virtual office');
try {
  const p = await open(o.url, { video: true });
  await p.waitForTimeout(1200); await p.screenshot({ path: out('1-walk-in') });
  await p.waitForFunction(() => Object.keys(window.__officeAvatars ?? {}).length >= 3, null, { timeout: 20000 });
  res.avatars = await p.evaluate(() => window.__officeAvatars);
  await p.waitForSelector('[data-phase=seated][data-state=working], [data-phase=seated][data-state=thinking]', { timeout: 30000 }); await p.waitForTimeout(500);
  await p.screenshot({ path: out('2-working') }); res.overlaps.push(await overlap3d(p));
    await p.waitForSelector('[data-testid=msg-card3d]', { timeout: 30000 }); await p.waitForTimeout(900);
  res.walking = await phases(p); await p.screenshot({ path: out('3-walk-to-colleague') });
  await p.waitForSelector('[data-phase=waiting]', { timeout: 30000 }); await p.waitForTimeout(500);
  res.waiting = await phases(p); await p.screenshot({ path: out('4-waiting-at-desk') }); res.overlaps.push(await overlap3d(p));
  await p.waitForSelector('.env-reply', { timeout: 40000 }); await p.waitForTimeout(1200);
  res.afterReply = await phases(p); await p.screenshot({ path: out('5-reply-walk-back') }); res.overlaps.push(await overlap3d(p));
  await p.waitForSelector('[data-testid=agent3d-researcher][data-state=done]', { timeout: 90000 }); await p.waitForTimeout(3500);
  await p.screenshot({ path: out('6-done') }); res.overlaps.push(await overlap3d(p));
  const box = await p.locator('canvas').boundingBox(); await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 12; i++) await p.mouse.wheel(0, 400);
  await p.waitForTimeout(1500); await p.screenshot({ path: out('7-done-zoomed-out') }); res.overlaps.push(await overlap3d(p));
  res.emoji = await p.evaluate(() => /\p{Extended_Pictographic}/u.test(document.body.innerText));
  const v = p.video(); await p.context().close(); renameSync(await v.path(), resolve(vidDir, 'run.webm'));
} finally { o.p.kill('SIGINT'); }
// Fallback: point the loader at a file that does not exist; every avatar must render as a capsule, with no crash.
o = await startOrch(['--mock-delay', '300', '--start-delay', '1500'], 'fallback run');
try {
  const p = await open(withQuery(o.url, 'model=missing.glb'));
  await p.waitForFunction(() => Object.keys(window.__officeAvatars ?? {}).length >= 3, null, { timeout: 20000 });
  res.fallback = await p.evaluate(() => window.__officeAvatars); await p.waitForTimeout(1500); await p.screenshot({ path: out('8-capsule-fallback') });
  await p.context().close();
} finally { o.p.kill('SIGINT'); }
o = await startOrch(['--mock-delay', '300', '--start-delay', '2000'], 'fps run');
try {
  const p = await open(o.url); await p.waitForTimeout(1500);
  const samples = []; for (let i = 0; i < 14; i++) samples.push(await rafFps(p, 1000));
  res.solo3d = { samples, avg: Math.round(samples.reduce((a, b) => a + b, 0) / samples.length), min: Math.min(...samples) };
  res.renderer = await p.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); const e = c?.getExtension('WEBGL_debug_renderer_info'); return e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
} finally { await browser.close(); o.p.kill('SIGINT'); }
// video → mp4 (H.264) + small gif
const ff = process.env.FFMPEG ?? '/usr/bin/ffmpeg', webm = resolve(vidDir, 'run.webm'), mp4 = resolve(root, 'docs/screens/phase4-mock-run.mp4'), gif = resolve(root, 'docs/screens/phase4-mock-run.gif');
execFileSync(ff, ['-y', '-loglevel', 'error', '-i', webm, '-vf', 'scale=960:-2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '28', '-movflags', '+faststart', mp4]);
execFileSync(ff, ['-y', '-loglevel', 'error', '-i', webm, '-vf', 'fps=5,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle', gif]);
rmSync(vidDir, { recursive: true, force: true });
console.log(JSON.stringify({ ...res, errors: errors.slice(0, 5) }, null, 0));
