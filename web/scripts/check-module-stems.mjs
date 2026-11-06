#!/usr/bin/env node
// Fail if tracked source files in one directory share a case-insensitive module stem
// (Split.tsx + split.ts). Vite 8 on Windows then folds `./Split` onto one of them.
import { execFileSync } from 'node:child_process';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const files = execFileSync('git', ['-C', root, 'ls-files', '-z', '--', '*.ts', '*.tsx', '*.js', '*.jsx', '*.mjs', '*.cjs'], { encoding: 'utf8' })
  .split('\0').filter(Boolean);

const groups = new Map();
for (const f of files) {
  const ext = extname(f).toLowerCase();
  if (!EXTS.has(ext)) continue;
  const i = f.lastIndexOf('/');
  const dir = (i < 0 ? '' : f.slice(0, i)).toLowerCase();
  const base = i < 0 ? f : f.slice(i + 1);
  const stem = base.slice(0, base.length - ext.length).toLowerCase();
  const k = `${dir}\0${stem}`;
  const arr = groups.get(k) ?? [];
  arr.push(f);
  groups.set(k, arr);
}
const hits = [...groups.values()].filter((g) => g.length > 1);
if (hits.length) {
  console.error('case-insensitive sibling module-stem collisions (Windows/Vite):');
  for (const g of hits) console.error('  ' + g.sort().join(' + '));
  process.exit(1);
}
console.log(`module-stems: ok (${files.length} tracked source files, 0 collisions)`);
