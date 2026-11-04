#!/usr/bin/env node
// Commits all changes in this repo and pushes the current branch (no deps, cross-platform).
// Usage: node scripts/commit.mjs "message" [--no-push] [--skip-checks] [--dry-run] [-y]
// - Runs tests + typecheck only for the packages that changed (mod/ → orchestrator; orchestrator/src/types.ts → web too).
// - Refuses run-token / log / env files even if they are not git-ignored, shows the file list and asks before committing.
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const die = (msg) => { console.error(`[commit] ${msg}`); process.exit(1); };
const git = (...args) => { const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' }); return { ok: r.status === 0, out: (r.stdout ?? '').trimEnd(), err: (r.stderr ?? '').trim() }; };
const run = (cwd, cmd) => spawnSync(cmd, { cwd: join(root, cwd), stdio: 'inherit', shell: true }).status === 0;
const FORBIDDEN = [/(^|\/)\.run\//, /(^|\/)ui-url\.txt$/, /(^|\/)logs\/.*\.jsonl$/, /(^|\/)\.env(\.|$)/, /(^|\/)node_modules\//, /(^|\/)settings\.local\.json$/];

/** Packages whose checks must run for these changed paths. */
export function packagesFor(files) {
  const p = new Set();
  for (const f of files) {
    if (f.startsWith('orchestrator/') || f.startsWith('mod/')) p.add('orchestrator');
    if (f.startsWith('web/') || f === 'orchestrator/src/types.ts') p.add('web');
  }
  return [...p];
}
/** `git status --porcelain` lines → paths (rename targets, quotes stripped). */
export function parsePorcelain(text) {
  return text.split('\n').filter(Boolean).map((l) => l.slice(3).split(' -> ').pop().replace(/^"(.*)"$/, '$1'));
}

async function main(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith('-')));
  let msg = argv.filter((a) => !a.startsWith('-')).join(' ').trim();
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD').out;
  if (!branch || branch === 'HEAD') die('not on a branch (detached HEAD).');

  const files = parsePorcelain(git('status', '--porcelain', '-uall').out);
  if (!files.length) { console.log('[commit] nothing to commit.'); return; }
  const bad = files.filter((f) => FORBIDDEN.some((re) => re.test(f)));
  if (bad.length) die(`refusing to commit secret/log files, add them to .gitignore first:\n  ${bad.join('\n  ')}`);

  console.log(`[commit] ${files.length} changed file(s) on ${branch}:`);
  console.log(git('status', '--short', '-uall').out.split('\n').map((l) => `  ${l}`).join('\n'));

  if (!flags.has('--skip-checks')) {
    for (const pkg of packagesFor(files)) {
      if (!existsSync(join(root, pkg, 'node_modules')) && !run(pkg, 'npm install')) die(`npm install failed in ${pkg}/.`);
      console.log(`[commit] checks: ${pkg}/ (npm test, npm run typecheck)`);
      if (!run(pkg, 'npm test') || !run(pkg, 'npm run typecheck')) die(`checks failed in ${pkg}/, nothing committed. Fix them or pass --skip-checks.`);
    }
  }
  if (flags.has('--dry-run')) { console.log('[commit] dry run: checks done, nothing committed.'); return; }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  if (!msg) msg = (await rl.question('Commit message: ')).trim();
  if (!msg) { rl.close(); die('empty commit message.'); }
  const push = !flags.has('--no-push');
  if (!flags.has('-y')) {
    const ok = (await rl.question(`Commit ${files.length} file(s) to ${branch}${push ? ' and push' : ''}? [y/N] `)).trim().toLowerCase();
    if (ok !== 'y' && ok !== 'yes') { rl.close(); die('cancelled.'); }
  }
  rl.close();

  if (!git('add', '-A').ok) die('git add failed.');
  const c = spawnSync('git', ['commit', '-m', msg], { cwd: root, stdio: 'inherit' });
  if (c.status !== 0) die('git commit failed.');
  if (!push) { console.log('[commit] committed (not pushed).'); return; }

  const upstream = git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}').ok;
  const p = spawnSync('git', upstream ? ['push'] : ['push', '-u', 'origin', branch], { cwd: root, stdio: 'inherit' });
  if (p.status !== 0) die('push failed (commit is kept locally). If the remote moved: git pull --rebase, then git push.');
  console.log(`[commit] pushed ${branch}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch((e) => die(e.message));
