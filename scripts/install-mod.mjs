#!/usr/bin/env node
// Installs the `deck` mod (Claude Deck) into Claude Code by editing <config>/settings.json (no deps, cross-platform).
// - If `deck@claude-deck-mods` (exact id) is already installed as a plugin: don't use CLAUDE_CODE_PLUGIN_DIRS (and remove our dir from it).
// - Otherwise add <repo>/mod/deck to env.CLAUDE_CODE_PLUGIN_DIRS (';' on Windows, ':' elsewhere), keeping other entries.
// - Set pluginConfigs.<deck | installed id>.options.endpoint. Only writes (and backs up) when something changed.
// - Migrates the pre-rename `office` mod (marketplace `office-mods`) so events are never sent twice: drops <repo>/mod/office from
//   CLAUDE_CODE_PLUGIN_DIRS, disables exactly `office@office-mods` in enabledPlugins (also when only listed in installed_plugins.json),
//   drops extraKnownMarketplaces["office-mods"] and moves pluginConfigs.office (other options kept) to pluginConfigs.deck.
//   Ids are matched exactly: `deck@<other>` / `office@<other>` belong to someone else and are never touched.
// - Warns (never refuses) when the mod dir, its parent or hooks/register.ts is group/other-writable: that code runs in every session.
// Never prints settings content (it can hold tokens).
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN = 'deck', MARKETPLACE = 'claude-deck-mods', PLUGIN_ID = `${PLUGIN}@${MARKETPLACE}`;
export const LEGACY_PLUGIN = 'office', LEGACY_MARKETPLACE = 'office-mods', LEGACY_ID = `${LEGACY_PLUGIN}@${LEGACY_MARKETPLACE}`;
const readJson = (f) => { if (!existsSync(f)) return undefined; const t = readFileSync(f, 'utf8').replace(/^﻿/, ''); return t.trim() ? JSON.parse(t) : {}; };
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
/** Find exactly the plugin id `id` (default "deck@claude-deck-mods") anywhere (keys or string values) in installed_plugins.json. */
export function findInstalledId(data, id = PLUGIN_ID) {
  let found;
  const walk = (v) => {
    if (found || v == null) return;
    if (typeof v === 'string') { if (v === id) found = v; return; }
    if (Array.isArray(v)) return v.forEach(walk);
    if (typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (k === id) { found = k; return; } walk(x); }
  };
  walk(data); return found;
}
const stamp = (d) => { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };
const samePath = (a, b, win) => (win ? a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase() : a.replace(/\/+$/, '') === b.replace(/\/+$/, ''));
/** <repo>/mod/office next to <repo>/mod/deck (same separator style). */
const legacyDirOf = (modDir) => modDir.replace(/[\\/]+$/, '').replace(/([\\/])[^\\/]+$/, `$1${LEGACY_PLUGIN}`);
/** Group/other-writable mod dir, parent or hooks/register.ts (POSIX only): anyone with that access can run code in every session. */
export function writableWarnings(modDir, platform = process.platform) {
  if (platform === 'win32') return [];
  const out = [];
  for (const [what, p] of [['mod dir', modDir], ['parent of the mod dir', dirname(modDir)], ['hooks/register.ts', join(modDir, 'hooks', 'register.ts')]]) {
    let m; try { m = statSync(p).mode; } catch { continue; }
    if (m & 0o022) out.push(`${what} ${p} is ${m & 0o002 ? 'world' : 'group'}-writable (mode ${(m & 0o777).toString(8)}); run: chmod go-w '${p}'`);
  }
  return out;
}

export function install({ configDir, modDir, port = 7777, platform = process.platform, now = new Date() }) {
  const win = platform === 'win32', sep = win ? ';' : ':';
  const settingsFile = join(configDir, 'settings.json');
  const before = readJson(settingsFile) ?? {};
  const s = JSON.parse(JSON.stringify(before));
  const installed = readJson(join(configDir, 'plugins', 'installed_plugins.json'));
  const installedId = findInstalledId(installed);
  const endpoint = `http://127.0.0.1:${port}/event`;
  const migrated = [];

  const env = isObj(s.env) ? s.env : (s.env = {});
  const entries = String(env.CLAUDE_CODE_PLUGIN_DIRS ?? '').split(sep).map((x) => x.trim()).filter(Boolean);
  const legacyDir = legacyDirOf(modDir), others = [];
  for (const e of entries) {
    if (samePath(e, legacyDir, win)) { if (!migrated.includes('plugin dir')) migrated.push('plugin dir'); continue; }
    if (!samePath(e, modDir, win) && !others.some((o) => samePath(o, e, win))) others.push(e);
  }
  const dirs = installedId ? others : [...others, modDir];
  if (dirs.length) env.CLAUDE_CODE_PLUGIN_DIRS = dirs.join(sep); else delete env.CLAUDE_CODE_PLUGIN_DIRS;
  if (!Object.keys(env).length && before.env === undefined) delete s.env;

  // Old `office` plugin: disable it wherever Claude Code knows it, so only the deck mod reports.
  const legacyIds = new Set([findInstalledId(installed, LEGACY_ID), ...Object.keys(isObj(s.enabledPlugins) ? s.enabledPlugins : {}).filter((k) => k === LEGACY_ID)].filter(Boolean));
  if (legacyIds.size) {
    const ep = isObj(s.enabledPlugins) ? s.enabledPlugins : (s.enabledPlugins = {});
    for (const id of legacyIds) if (ep[id] !== false) { ep[id] = false; migrated.push(`disabled ${id}`); }
  }
  if (isObj(s.extraKnownMarketplaces) && LEGACY_MARKETPLACE in s.extraKnownMarketplaces) {
    delete s.extraKnownMarketplaces[LEGACY_MARKETPLACE]; migrated.push(`marketplace ${LEGACY_MARKETPLACE}`);
    if (!Object.keys(s.extraKnownMarketplaces).length) delete s.extraKnownMarketplaces;
  }

  const pc = isObj(s.pluginConfigs) ? s.pluginConfigs : (s.pluginConfigs = {});
  for (const k of Object.keys(pc)) {
    if (k !== LEGACY_PLUGIN && k !== LEGACY_ID) continue; // bare `office` only here (pluginConfigs is keyed by plugin name)
    if (k === LEGACY_PLUGIN && isObj(pc[k]) && pc[PLUGIN] === undefined) pc[PLUGIN] = pc[k]; // keep the user's other options
    delete pc[k]; migrated.push(`pluginConfigs.${k}`);
  }
  for (const key of new Set([PLUGIN, ...(installedId ? [installedId] : [])])) {
    const c = isObj(pc[key]) ? pc[key] : (pc[key] = {});
    const o = isObj(c.options) ? c.options : (c.options = {});
    o.endpoint = endpoint;
  }

  const changed = JSON.stringify(s) !== JSON.stringify(before) || !existsSync(settingsFile);
  let backup;
  if (changed) {
    mkdirSync(configDir, { recursive: true });
    if (existsSync(settingsFile)) { backup = `${settingsFile}.bak-${stamp(now)}`; copyFileSync(settingsFile, backup); }
    writeFileSync(settingsFile, JSON.stringify(s, null, 2) + '\n', { encoding: 'utf8' });
  }
  return { changed, backup, settingsFile, endpoint, installedId, modDir, viaPluginDirs: !installedId, legacyIds: [...legacyIds], migrated, warnings: writableWarnings(modDir, platform) };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const i = process.argv.indexOf('--port'); const port = i > 0 ? Number(process.argv[i + 1]) : 7777;
  const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  const modDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'mod', PLUGIN);
  try {
    const r = install({ configDir, modDir, port });
    console.log(`[deck] mod: ${r.installedId ? `installed plugin ${r.installedId}` : r.modDir} | endpoint: ${r.endpoint} | settings ${r.changed ? 'updated' : 'unchanged'}${r.backup ? ' (backup saved)' : ''}`);
    if (r.migrated.length) console.log(`[deck] migrated from the old "office" mod: ${r.migrated.join(', ')}`);
    for (const w of r.warnings) console.warn(`[deck] WARNING: ${w}`);
    if (r.warnings.length) console.warn('[deck] WARNING: the deck mod runs inside every Claude Code session; only you should be able to change it.');
    if (r.legacyIds.length) console.log(`[deck] the old plugin is disabled; to remove it for good run in Claude Code: ${r.legacyIds.map((id) => `/plugin uninstall ${id}`).join(' ; ')} ; /plugin marketplace remove ${LEGACY_MARKETPLACE}`);
    console.log('Restart any open Claude Code sessions to load the mod.');
  } catch (e) { console.warn(`[deck] WARNING: could not install the mod (${e.message}); continuing.`); }
}
