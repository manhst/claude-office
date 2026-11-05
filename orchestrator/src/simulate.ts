// Demo/mock: simulates 3 Claude Code sessions posting `office` mod events, so the UI can be tested without Claude.
// Usage: tsx src/simulate.ts [endpoint]   (default http://127.0.0.1:7777/event). Also used by `cli.ts start --demo`.
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const demo = (p: string) => resolve(here, '../fixtures/demo', p);
type Ev = Record<string, unknown>;
type Step = { kind: 'text'; text: string } | { kind: 'tool'; name: string; detail?: string; isError?: boolean };
/** A demo turn: starts at step `at`, posts growing steps until it ends at step `end` (indexes into the session's steps). */
type DemoTurn = { at: number; end: number; agentId?: string; agentType?: string; prompt: string; steps: Step[]; answer: string };
const txt = (text: string): Step => ({ kind: 'text', text });
const tool = (name: string, detail?: string, isError?: boolean): Step => ({ kind: 'tool', name, detail, ...(isError ? { isError } : {}) });
/** Demo Responses panel content, per session sid. */
export const DEMO_TURNS: Record<string, DemoTurn[]> = {
  'demo-shop-0001': [
    { at: 0, end: 6, prompt: 'Add discount codes to checkout.\nCodes are percent or fixed amount, one per order, and must not push the total below zero.',
      steps: [txt("I'll look at how checkout computes totals first."), tool('Read', 'checkout.ts'), tool('Grep', 'applyPromotion'),
        txt('Totals are computed in `checkoutTotal()`. I will have the planner split this up, then hand the steps to the coder.'), tool('Agent', 'Plan discount codes'),
        tool('Agent', 'Implement step 1'), tool('Bash', 'npm test', true), txt('One test failed: `total never negative` (fixed code larger than subtotal). Clamping and re-running.'),
        tool('Edit', 'checkout.ts'), tool('Bash', 'npm test'), tool('Agent', 'Review the diff')],
      answer: 'Discount codes are in.\n\n- `POST /checkout` accepts `code`; percent and fixed codes are applied in `checkoutTotal()`.\n- One code per order; the total is clamped at 0.\n- 6 new tests in `checkout.test.ts`, all green.\n\nThe reviewer had no blocking comments.' },
    { at: 2, end: 3, agentId: 'a1', agentType: 'planner', prompt: 'Plan discount codes for checkout: percent and fixed codes, one per order, total never below zero.',
      steps: [tool('Read', 'checkout.ts'), tool('Glob', 'src/**/*.test.ts')],
      answer: '1. Add a `DiscountCode` type and a lookup table.\n2. Apply the code in `checkoutTotal()` after promotions, clamp at 0.\n3. Accept `code` on `POST /checkout`, 400 on an unknown code.\n4. Tests: percent, fixed, unknown, over-discount.' },
    { at: 3, end: 5, agentId: 'a2', agentType: 'coder', prompt: 'Implement step 1-3 of the discount code plan.',
      steps: [tool('Edit', 'types.ts'), tool('Edit', 'checkout.ts'), txt('Added the lookup and applied it after promotions.'), tool('Write', 'checkout.test.ts')],
      answer: 'Steps 1-3 done; 4 tests added in `checkout.test.ts`.' },
    { at: 5, end: 6, agentId: 'a3', agentType: 'reviewer', prompt: 'Review the discount code diff.',
      steps: [tool('Bash', 'git diff --stat'), tool('Read', 'checkout.ts')], answer: 'Looks good. Nit: name the 400 error `unknown_discount_code`.' },
  ],
  'demo-blog-0002': [
    { at: 0, end: 6, prompt: 'Draft a post about Claude Code mods.',
      steps: [txt("Let me see how existing posts are laid out."), tool('Glob', 'src/content/posts/*.md'), tool('Read', 'hello-world.md'),
        tool('Write', 'claude-code-mods.md'), txt('Draft written. Building to check the front matter.'), tool('Bash', 'npm run build')],
      answer: 'Draft is in `src/content/posts/claude-code-mods.md` (about 900 words): what a mod is, the hook chain, and a small example that posts session events to a local server. The build passes.' },
  ],
  'demo-scratch-0003': [
    { at: 1, end: 5, prompt: 'Why does this regex not match?\n\n    /^\\d{3}-\\d{4}$/.test("555-12345")',
      steps: [tool('Agent', 'Find regex usages'), txt('The pattern is anchored with `$`, so the extra digit makes it fail.')],
      answer: 'It is anchored: `^` and `$` make the whole string match exactly 3 digits, a dash and 4 digits. `"555-12345"` has 5 digits after the dash. Drop the `$` or use `\\d{4,}` if longer numbers are fine.' },
    { at: 2, end: 3, agentId: 'b1', agentType: 'Explore', prompt: 'Find where phone-number regexes are used in this repo.',
      steps: [tool('Grep', '\\d{3}-\\d{4}'), tool('Read', 'validate.ts')], answer: 'One use: `validate.ts` line 12, `isPhone()`.' },
  ],
};
/** Turn events for step i: start at `at`, progress in between, end at `end`. */
export function demoTurnEvents(sid: string, i: number, loop: number, stepMs: number): Ev[] {
  return (DEMO_TURNS[sid] ?? []).flatMap((t, k): Ev[] => {
    if (i < t.at || i > t.end) return [];
    const id = `t${loop}-${k}`, who = t.agentId ? { agentId: t.agentId, agentType: t.agentType } : {};
    if (i === t.end) return [{ type: 'turn', sid, turn: { id, phase: 'end', ...who, steps: t.steps, answer: t.answer, reason: 'answer', durationMs: (t.end - t.at) * stepMs } }];
    const steps = t.steps.slice(0, Math.ceil((t.steps.length * (i - t.at)) / (t.end - t.at)));
    return [{ type: 'turn', sid, turn: { id, phase: 'start', ...who, ...(i === t.at ? { prompt: t.prompt } : {}), ...(steps.length ? { steps } : {}) } }];
  });
}
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
/** Labelled demo usage: 5h climbs and resets, 7d creeps; resets_at are real times so the pace marker moves. */
export function demoUsage(now: number, step: number) {
  const H5 = 5 * 3600e3, D7 = 7 * 86400e3, fiveStart = now - ((step * 7 * 60e3) % H5), weekStart = now - 2.6 * 86400e3;
  return { type: 'usage', sid: 'demo-usage', usage: { source: 'demo', ts: now, five_hour: { pct: Math.min(100, 18 + (step % 40) * 2), resets_at: new Date(fiveStart + H5).toISOString() },
    seven_day: { pct: 41 + Math.floor(step / 10), resets_at: new Date(weekStart + D7).toISOString() }, context_pct: 35, cost_usd: 1.23 } };
}
/** Posts start events, then steps round-robin every stepMs. loops = how many passes over the steps (Infinity = forever). */
export async function simulate(endpoint: string, o: { stepMs?: number; loops?: number; end?: boolean } = {}) {
  const stepMs = o.stepMs ?? 1500, loops = o.loops ?? Infinity;
  await post(endpoint, demoUsage(Date.now(), 0));
  for (const s of DEMO_SESSIONS) await post(endpoint, { type: 'start', sid: s.sid, project: s.project, cwd: s.cwd, title: s.title, transcript: `(demo)/${s.sid}.jsonl` });
  const longest = Math.max(...DEMO_SESSIONS.map((s) => s.steps.length));
  for (let loop = 0; loop < loops; loop++) for (let i = 0; i < longest; i++) {
    await new Promise((r) => setTimeout(r, stepMs));
    await post(endpoint, demoUsage(Date.now(), loop * longest + i));
    for (const s of DEMO_SESSIONS) {
      const st = s.steps[i % s.steps.length]; await post(endpoint, { type: st.tool ? 'tool' : 'state', sid: s.sid, tool: null, ...st, costUsd: +(0.01 * (loop * longest + i + 1)).toFixed(3) });
      if (i < s.steps.length) for (const ev of demoTurnEvents(s.sid, i, loop, stepMs)) await post(endpoint, ev);
    }
  }
  if (o.end) for (const s of DEMO_SESSIONS) await post(endpoint, { type: 'end', sid: s.sid });
}
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) simulate(process.argv[2] ?? 'http://127.0.0.1:7777/event');
