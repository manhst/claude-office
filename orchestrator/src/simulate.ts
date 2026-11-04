// Demo/mock: simulates 3 Claude Code sessions posting `office` mod events, so the UI can be tested without Claude.
// Usage: tsx src/simulate.ts [endpoint]   (default http://127.0.0.1:7777/event). Also used by `cli.ts start --demo`.
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const demo = (p: string) => resolve(here, '../fixtures/demo', p);
type Ev = Record<string, unknown>;
export const DEMO_SESSIONS = [
  { sid: 'demo-shop-0001', project: 'shop-api', cwd: demo('shop-api'), title: 'Add discount codes to checkout', steps: [
    { state: 'thinking', prompt: 'Add discount codes to checkout.' },
    { state: 'tool', tool: { name: 'Read', detail: 'checkout.ts' } },
    { state: 'tool', tool: { name: 'Task', detail: 'planner: plan discount codes' }, subagents: [{ id: 'a1', type: 'planner', description: 'Plan discount codes', status: 'running' }] },
    { state: 'thinking', subagents: [{ id: 'a1', type: 'planner', description: 'Plan discount codes', status: 'completed' }, { id: 'a2', type: 'coder', description: 'Implement step 1', status: 'running' }] },
    { state: 'waiting-permission', tool: { name: 'Bash', detail: 'npm test' }, subagents: [{ id: 'a2', type: 'coder', description: 'Implement step 1', status: 'running' }] },
    { state: 'tool', tool: { name: 'Bash', detail: 'npm test' }, subagents: [{ id: 'a2', type: 'coder', description: 'Implement step 1', status: 'running' }, { id: 'a3', type: 'reviewer', description: 'Review the diff', status: 'running' }] },
    { state: 'done', subagents: [] },
  ] },
  { sid: 'demo-blog-0002', project: 'blog', cwd: demo('blog'), title: 'Draft post about Claude Code mods', steps: [
    { state: 'thinking', prompt: 'Draft a post about Claude Code mods.' },
    { state: 'tool', tool: { name: 'Glob', detail: 'src/content/posts/*.md' } },
    { state: 'tool', tool: { name: 'Write', detail: 'claude-code-mods.md' } },
    { state: 'thinking' },
    { state: 'tool', tool: { name: 'Bash', detail: 'npm run build' } },
    { state: 'idle' },
    { state: 'done' },
  ] },
  { sid: 'demo-scratch-0003', project: 'scratch', cwd: demo('scratch'), title: 'Quick regex question', steps: [
    { state: 'idle' }, { state: 'thinking', prompt: 'Why does this regex not match?' },
    { state: 'tool', tool: { name: 'Explore', detail: 'search regex usages' }, subagents: [{ id: 'b1', type: 'Explore', description: 'Find regex usages', status: 'running' }] },
    { state: 'thinking', subagents: [] }, { state: 'idle' }, { state: 'done' }, { state: 'idle' },
  ] },
];
async function post(endpoint: string, ev: Ev) {
  try { await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(ev) }); } catch { /* server not up yet */ }
}
/** Posts start events, then steps round-robin every stepMs. loops = how many passes over the steps (Infinity = forever). */
export async function simulate(endpoint: string, o: { stepMs?: number; loops?: number; end?: boolean } = {}) {
  const stepMs = o.stepMs ?? 1500, loops = o.loops ?? Infinity;
  for (const s of DEMO_SESSIONS) await post(endpoint, { type: 'start', sid: s.sid, project: s.project, cwd: s.cwd, title: s.title, transcript: `(demo)/${s.sid}.jsonl` });
  const longest = Math.max(...DEMO_SESSIONS.map((s) => s.steps.length));
  for (let loop = 0; loop < loops; loop++) for (let i = 0; i < longest; i++) {
    await new Promise((r) => setTimeout(r, stepMs));
    for (const s of DEMO_SESSIONS) { const st = s.steps[i % s.steps.length]; await post(endpoint, { type: st.tool ? 'tool' : 'state', sid: s.sid, tool: null, ...st, costUsd: +(0.01 * (loop * longest + i + 1)).toFixed(3) }); }
  }
  if (o.end) for (const s of DEMO_SESSIONS) await post(endpoint, { type: 'end', sid: s.sid });
}
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) simulate(process.argv[2] ?? 'http://127.0.0.1:7777/event');
