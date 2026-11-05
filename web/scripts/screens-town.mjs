// Demo-mode screenshots of the town around the Vanphong office: overview, cafe + trà đá, croc pond throw, IT Ops reporting, dog vs cat, name/avatar editor.
// Starts the server with --demo (IT Ops in labelled demo mode), kills only that server. Never prints the UI URL (it carries the run token).
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
  const pg = await ctx.newPage(); pg.on('pageerror', (e) => errors.push(e.message));
  await pg.goto(url); await pg.waitForSelector('[data-testid=conn]:has-text("live")');
  await pg.waitForSelector('[data-testid^=vp-agent-] .ten-3d', { timeout: 20000 }); await pg.waitForTimeout(4000);
  const stage = await pg.locator('[data-testid=office-vanphong]').boundingBox();
  // clip around a label, kept inside the 3D stage
  const around = async (sel, w, h, dy = 0) => { const b = await pg.locator(sel).first().boundingBox(); const x = Math.min(Math.max(stage.x, b.x + b.width / 2 - w / 2), stage.x + stage.width - w), y = Math.min(Math.max(stage.y, b.y + b.height / 2 - h / 2 + dy), stage.y + stage.height - h); return { clip: { x, y, width: Math.min(w, stage.width), height: Math.min(h, stage.height) } }; };
  const agentName = (i) => pg.locator('[data-testid^=vp-agent-] .ten-3d').nth(i);
  // name/avatar editor on the first (existing) agent
  await agentName(0).click({ button: 'right' }); await pg.click('[data-testid=ctx-edit]');
  await pg.fill('[data-testid=editor-name]', 'Hùng Coder'); await pg.click('[data-testid=preset-nam_05]'); await pg.waitForTimeout(200);
  await pg.locator('[data-testid=editor]').screenshot({ path: out('editor') }); done.push('editor');
  await pg.click('[data-testid=editor-save]');
  await pg.locator('[data-testid=ent-npc-2] .ten-3d').click(); await pg.click('[data-testid=ctx-edit]'); await pg.click('button:has-text("Nữ")'); await pg.click('[data-testid=preset-nu_10]'); await pg.click('[data-testid=editor-save]');
  await pg.waitForTimeout(4000);
  if (!(await pg.locator('[data-testid^=vp-agent-] .ten-3d:has-text("Hùng Coder")').count())) errors.push('custom name not applied to existing agent');
  await pg.locator('[data-testid=office-vanphong]').screenshot({ path: out('overview') }); done.push('overview');
  await pg.waitForFunction(() => document.querySelectorAll('[data-act=drink],[data-act=beer]').length > 0, null, { timeout: 60000 }).catch(() => {});
  await pg.screenshot({ path: out('cafe-trada'), ...(await around('[data-testid=vp-cafe]', 520, 560, 140)) }); done.push('cafe-trada');
  // throw the second agent into the croc pond
  await agentName(1).click({ button: 'right' }); await pg.click('[data-testid=ctx-throw]');
  await pg.waitForTimeout(1100);
  await pg.screenshot({ path: out('croc-throw'), ...(await around('[data-testid=vp-pond]', 640, 520, 160)) }); done.push('croc-throw');
  // IT Ops (demo monitor alternates ok/alert every 15 s) runs to the Architect
  await pg.waitForSelector('.ent-3d.bao-dong .bong-3d', { timeout: 45000 });
  await pg.screenshot({ path: out('itops-report'), ...(await around('.ent-3d.bao-dong', 820, 420)) }); done.push('itops-report');
  // dog vs cat
  await pg.waitForFunction(() => document.querySelector('[data-testid=ent-cat]')?.getAttribute('data-act') === 'fight', null, { timeout: 120000, polling: 100 });
  await pg.screenshot({ path: out('dog-cat'), ...(await around('[data-testid=ent-cat]', 520, 340, 40)) }); done.push('dog-cat');
  await ctx.close();
} finally { await browser.close(); p.kill('SIGTERM'); }
console.log('shots', done.join(' '), 'errors', JSON.stringify(errors));
