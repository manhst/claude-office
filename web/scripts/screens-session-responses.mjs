// Screenshot: left sidebar Responses section (CLI-style turns) fed by `turn` mod events POSTed to /event, 1280.
// Restores orchestrator/.run/ui-url.txt afterwards (a real server may be running) and never prints its contents.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
mkdirSync(resolve(root, 'docs/screens'), { recursive: true });
const out = resolve(root, 'docs/screens/session-responses.png'), outSide = resolve(root, 'docs/screens/session-responses-side.png');
const urlFile = resolve(root, 'orchestrator/.run/ui-url.txt'), prevUrl = existsSync(urlFile) ? readFileSync(urlFile, 'utf8') : null;
const env = { ...process.env }; delete env.OFFICE_PROMETHEUS_URL;
const p = spawn(process.execPath, [resolve(root, 'orchestrator/node_modules/tsx/dist/cli.mjs'), 'orchestrator/src/cli.ts', 'start', '--demo', '--port', '0', '--step-ms', '900'], { cwd: root, env, stdio: ['ignore', 'ignore', 'pipe'] });
const url = await new Promise((res, rej) => {
  p.stderr.on('data', (d) => { if (/\[office\] UI:/.test(String(d))) res(readFileSync(urlFile, 'utf8').trim()); });
  setTimeout(() => rej(new Error('no start')), 20000);
});
if (prevUrl != null) writeFileSync(urlFile, prevUrl, { mode: 0o600 }); // the page already has its URL; give the file back to the real server
const errors = [];
const post = async (b) => { const r = await fetch(`http://127.0.0.1:${new URL(url).port}/event`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); if (!r.ok) errors.push(`POST ${b.type} ${r.status}`); };
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => { localStorage.removeItem('vp-collapse'); });
  const pg = await ctx.newPage(); pg.on('pageerror', (e) => errors.push(e.message));
  await pg.goto(url); await pg.waitForSelector('[data-testid=conn]:has-text("live")');
  await pg.waitForSelector('[data-testid=responses-collapse][aria-expanded=true]');
  const sid = 'shot-office-0001', sid2 = 'shot-blog-0002';
  await post({ type: 'start', sid, project: 'claude-office', cwd: root });
  await post({ type: 'start', sid: sid2, project: 'blog', cwd: root });
  await post({ type: 'turn', sid, turn: { id: 't1', phase: 'start', prompt: 'Why is the Responses panel empty?' } });
  await post({ type: 'turn', sid, turn: { id: 't1', phase: 'end', reason: 'answer', durationMs: 12_300, prompt: 'Why is the Responses panel empty?',
    steps: [{ kind: 'text', text: "I'll check which events the panel lists." }, { kind: 'tool', name: 'Read', detail: 'listResponses.ts' }, { kind: 'tool', name: 'Grep', detail: 'agent.text' },
      { kind: 'tool', name: 'Bash', detail: 'npm test -- response-log', isError: true }],
    answer: 'It only lists old-design events (`agent.text`, `agent.done`, `tool.result`).\n\nThe live mod never sends them, so:\n- the list stays empty\n- the count stays 0' } });
  await post({ type: 'turn', sid: sid2, turn: { id: 'b1', phase: 'end', reason: 'aborted', durationMs: 4_100, prompt: 'Rewrite the intro', steps: [{ kind: 'tool', name: 'Read', detail: 'intro.md' }] } });
  await post({ type: 'turn', sid, turn: { id: 't2', phase: 'start', prompt: 'Render each turn like the CLI', steps: [{ kind: 'text', text: 'Delegating the UI part.' }, { kind: 'tool', name: 'Task', detail: 'web-dev' }] } });
  await post({ type: 'turn', sid, turn: { id: 't2', phase: 'start', agentId: 'ag1', agentType: 'web-dev',
    prompt: 'Feature: show each Claude Code turn like the CLI window.\n1. reducer: upsert session.turn\n2. Responses panel, CLI-style\n3. styles\n4. tests',
    steps: [{ kind: 'tool', name: 'Read', detail: 'reducer.ts' }, { kind: 'tool', name: 'Edit', detail: 'ResponseLog.tsx' }] } });
  await pg.waitForFunction(() => document.querySelectorAll('[data-testid=response-turn]').length >= 4, null, { timeout: 15000 });
  await pg.waitForTimeout(1500);
  for (const sel of ['[data-testid=turn-answer]', '[data-testid=turn-working]', '.rl-subagent .rl-more', '.rl-err', '.rl-proj']) if (!(await pg.locator(sel).count())) errors.push(`missing ${sel}`);
  await pg.screenshot({ path: out });
  console.log('working', JSON.stringify(await pg.locator('[data-testid=turn-working]').allInnerTexts()));
  await pg.click('[data-testid=session-collapse]'); // side shot: Session folded so the transcript gets the room
  await pg.locator('[data-testid=response-turn]', { hasText: 'Why is the Responses panel empty' }).evaluate((el) => el.scrollIntoView({ block: 'start' })); // show the posted example, not demo traffic
  await pg.waitForTimeout(200);
  await pg.locator('[data-testid=responses]').screenshot({ path: outSide });
  await ctx.close();
  console.log('shot', out, outSide, 'errors', JSON.stringify(errors));
} finally { await browser.close(); p.kill('SIGTERM'); }
if (errors.length) process.exitCode = 1;
