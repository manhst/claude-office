#!/usr/bin/env node
// Installs the `office` mod into Claude Code by editing <config>/settings.json (no deps, cross-platform).
// - If `office@<marketplace>` is already installed as a plugin: don't use CLAUDE_CODE_PLUGIN_DIRS (and remove our dir from it).
// - Otherwise add <repo>/mod/office to env.CLAUDE_CODE_PLUGIN_DIRS (';' on Windows, ':' elsewhere), keeping other entries.
// - Set pluginConfigs.<office | installed id>.options.endpoint. Only writes (and backs up) when something changed.
// Never prints settings content (it can hold tokens).
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const readJson = (f) => { if (!existsSync(f)) return undefined; const t = readFileSync(f, 'utf8').replace(/^\uFEFF/, ''); return t.trim() ? JSON.parse(t) : {}; };
/** Find an installed plugin id like "office@office-mods" anywhere (keys or string values) in installed_plugins.json. */
export function findInstalledId(data) {
  let found;
  const walk = (v) => {
    if (found || v == null) return;
    if (typeof v === 'string') { if (/^office@[\w.-]+$/.test(v)) found = v; return; }
    if (Array.isArray(v)) return v.forEach(walk);
    if (typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (/^office@[\w.-]+$/.test(k)) { found = k; return; } walk(x); }
  };
  walk(data); return found;
}
const stamp = (d) => { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };
const samePath = (a, b, win) => (win ? a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase() : a.replace(/\/+$/, '') === b.replace(/\/+$/, ''));

export function install({ configDir, modDir, port = 7777, platform = process.platform, now = new Date() }) {
  const win = platform === 'win32', sep = win ? ';' : ':';
  const settingsFile = join(configDir, 'settings.json');
  const before = readJson(settingsFile) ?? {};
  const s = JSON.parse(JSON.stringify(before));
  const installedId = findInstalledId(readJson(join(configDir, 'plugins', 'installed_plugins.json')));
  const endpoint = `http://127.0.0.1:${port}/event`;

  const env = (s.env && typeof s.env === 'object') ? s.env : (s.env = {});
  const entries = String(env.CLAUDE_CODE_PLUGIN_DIRS ?? '').split(sep).map((x) => x.trim()).filter(Boolean);
  const others = [];
  for (const e of entries) if (!samePath(e, modDir, win) && !others.some((o) => samePath(o, e, win))) others.push(e);
  const dirs = installedId ? others : [...others, modDir];
  if (dirs.length) env.CLAUDE_CODE_PLUGIN_DIRS = dirs.join(sep); else delete env.CLAUDE_CODE_PLUGIN_DIRS;
  if (!Object.keys(env).length && before.env === undefined) delete s.env;

  const pc = (s.pluginConfigs && typeof s.pluginConfigs === 'object') ? s.pluginConfigs : (s.pluginConfigs = {});
  for (const key of new Set(['office', ...(installedId ? [installedId] : [])])) {
    const c = (pc[key] && typeof pc[key] === 'object') ? pc[key] : (pc[key] = {});
    const o = (c.options && typeof c.options === 'object') ? c.options : (c.options = {});
    o.endpoint = endpoint;
  }

  const changed = JSON.stringify(s) !== JSON.stringify(before) || !existsSync(settingsFile);
  let backup;
  if (changed) {
    mkdirSync(configDir, { recursive: true });
    if (existsSync(settingsFile)) { backup = `${settingsFile}.bak-${stamp(now)}`; copyFileSync(settingsFile, backup); }
    writeFileSync(settingsFile, JSON.stringify(s, null, 2) + '\n', { encoding: 'utf8' });
  }
  return { changed, backup, settingsFile, endpoint, installedId, modDir, viaPluginDirs: !installedId };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const i = process.argv.indexOf('--port'); const port = i > 0 ? Number(process.argv[i + 1]) : 7777;
  const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  const modDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'mod', 'office');
  try {
    const r = install({ configDir, modDir, port });
    console.log(`[office] mod: ${r.installedId ? `installed plugin ${r.installedId}` : r.modDir} | endpoint: ${r.endpoint} | settings ${r.changed ? 'updated' : 'unchanged'}${r.backup ? ' (backup saved)' : ''}`);
    console.log('Mở lại các session Claude Code đang mở để nạp mod.');
  } catch (e) { console.warn(`[office] WARNING: could not install the mod (${e.message}); continuing.`); }
}
