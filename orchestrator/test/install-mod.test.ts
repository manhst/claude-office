import { describe, it, expect } from 'vitest';
import { chmodSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-ignore plain .mjs script without type declarations
import { install, findInstalledId, writableWarnings } from '../../scripts/install-mod.mjs';
const cfg = () => mkdtempSync(join(tmpdir(), 'deck-cfg-'));
const read = (d: string) => { const t = readFileSync(join(d, 'settings.json'), 'utf8'); expect(t.charCodeAt(0)).not.toBe(0xfeff); return JSON.parse(t); };
const baks = (d: string) => readdirSync(d).filter((f) => f.startsWith('settings.json.bak-'));
const now = new Date(2026, 10, 5, 0, 13, 7);
describe('install-mod', () => {
  it('fresh config: creates settings with plugin dir + endpoint, no backup', () => {
    const d = join(cfg(), 'nested'); const r = install({ configDir: d, modDir: 'C:\\repo\\mod\\deck', port: 7777, platform: 'win32', now });
    expect(r.changed).toBe(true); expect(r.backup).toBeUndefined();
    expect(read(d)).toEqual({ env: { CLAUDE_CODE_PLUGIN_DIRS: 'C:\\repo\\mod\\deck' }, pluginConfigs: { deck: { options: { endpoint: 'http://127.0.0.1:7777/event' } } } });
    expect(readFileSync(join(d, 'settings.json'), 'utf8')).toContain('\n  "env"');
  });
  it('second run changes nothing and makes no backup', () => {
    const d = cfg(); install({ configDir: d, modDir: '/repo/mod/deck', platform: 'linux', now });
    const before = readFileSync(join(d, 'settings.json'), 'utf8');
    const r = install({ configDir: d, modDir: '/repo/mod/deck', platform: 'linux', now });
    expect(r.changed).toBe(false); expect(baks(d)).toEqual([]); expect(readFileSync(join(d, 'settings.json'), 'utf8')).toBe(before);
  });
  it('preserves other keys and existing PLUGIN_DIRS entries, dedupes, backs up once', () => {
    const d = cfg();
    writeFileSync(join(d, 'settings.json'), '\uFEFF' + JSON.stringify({ model: 'opus', env: { FOO: '1', CLAUDE_CODE_PLUGIN_DIRS: 'C:\\esp\\usage-esp;c:\\repo\\mod\\deck\\;C:\\esp\\usage-esp' },
      pluginConfigs: { deck: { options: { endpoint: 'old', other: 2 }, x: 1 }, 'usage-esp': { options: { endpoint: 'http://127.0.0.1:8266/usage' } } } }));
    const r = install({ configDir: d, modDir: 'C:\\repo\\mod\\deck', port: 7788, platform: 'win32', now });
    expect(r.backup).toMatch(/settings\.json\.bak-20261105-001307$/); expect(baks(d)).toHaveLength(1);
    const s = read(d);
    expect(s.model).toBe('opus'); expect(s.env.FOO).toBe('1');
    expect(s.env.CLAUDE_CODE_PLUGIN_DIRS).toBe('C:\\esp\\usage-esp;C:\\repo\\mod\\deck');
    expect(s.pluginConfigs.deck).toEqual({ options: { endpoint: 'http://127.0.0.1:7788/event', other: 2 }, x: 1 });
    expect(s.pluginConfigs['usage-esp'].options.endpoint).toBe('http://127.0.0.1:8266/usage');
    expect(install({ configDir: d, modDir: 'C:\\repo\\mod\\deck', port: 7788, platform: 'win32', now }).changed).toBe(false);
    expect(baks(d)).toHaveLength(1);
  });
  it('uses ":" on mac/linux', () => {
    const d = cfg(); writeFileSync(join(d, 'settings.json'), JSON.stringify({ env: { CLAUDE_CODE_PLUGIN_DIRS: '/esp/usage-esp' } }));
    install({ configDir: d, modDir: '/repo/mod/deck', platform: 'darwin', now });
    expect(read(d).env.CLAUDE_CODE_PLUGIN_DIRS).toBe('/esp/usage-esp:/repo/mod/deck');
  });
  it('installed as plugin: removes our dir from PLUGIN_DIRS, sets endpoint under both keys', () => {
    const d = cfg(); mkdirSync(join(d, 'plugins'));
    writeFileSync(join(d, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'deck@claude-deck-mods': [{ scope: 'user' }], 'usage-esp@esp-mods': [] } }));
    writeFileSync(join(d, 'settings.json'), JSON.stringify({ env: { CLAUDE_CODE_PLUGIN_DIRS: '/esp/usage-esp:/repo/mod/deck' } }));
    const r = install({ configDir: d, modDir: '/repo/mod/deck', platform: 'linux', now });
    expect(r.installedId).toBe('deck@claude-deck-mods');
    const s = read(d);
    expect(s.env.CLAUDE_CODE_PLUGIN_DIRS).toBe('/esp/usage-esp');
    expect(s.pluginConfigs['deck@claude-deck-mods'].options.endpoint).toBe('http://127.0.0.1:7777/event');
    expect(s.pluginConfigs.deck.options.endpoint).toBe('http://127.0.0.1:7777/event');
    expect(findInstalledId({ plugins: { 'x@y': {} } })).toBeUndefined();
  });
  it('migrates a dir-installed old "office" mod: swaps mod/office for mod/deck, moves pluginConfigs.office (other options kept)', () => {
    const d = cfg();
    writeFileSync(join(d, 'settings.json'), JSON.stringify({ env: { CLAUDE_CODE_PLUGIN_DIRS: '/esp/usage-esp:/repo/mod/office/' }, pluginConfigs: { office: { options: { endpoint: 'http://127.0.0.1:7777/event', extra: 1 } } } }));
    const r = install({ configDir: d, modDir: '/repo/mod/deck', platform: 'darwin', now });
    const s = read(d);
    expect(s.env.CLAUDE_CODE_PLUGIN_DIRS).toBe('/esp/usage-esp:/repo/mod/deck');
    expect(s.pluginConfigs).toEqual({ deck: { options: { endpoint: 'http://127.0.0.1:7777/event', extra: 1 } } });
    expect(s.enabledPlugins).toBeUndefined();
    expect(r.migrated).toEqual(['plugin dir', 'pluginConfigs.office']); expect(r.legacyIds).toEqual([]);
    expect(install({ configDir: d, modDir: '/repo/mod/deck', platform: 'darwin', now }).changed).toBe(false);
  });
  it('migrates a marketplace-installed old plugin: disables office@office-mods, drops its marketplace + configs, loads mod/deck via PLUGIN_DIRS', () => {
    const d = cfg(); mkdirSync(join(d, 'plugins'));
    writeFileSync(join(d, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'office@office-mods': [{ scope: 'user' }], 'usage-esp@esp-mods': [] } }));
    writeFileSync(join(d, 'settings.json'), JSON.stringify({ enabledPlugins: { 'office@office-mods': true, 'usage-esp@esp-mods': true },
      extraKnownMarketplaces: { 'office-mods': { source: { source: 'directory', path: 'C:\\repo\\mod' } }, 'esp-mods': { source: { source: 'github', repo: 'x/y' } } },
      pluginConfigs: { office: { options: { endpoint: 'old' } }, 'office@office-mods': { options: { endpoint: 'old' } } } }));
    const r = install({ configDir: d, modDir: 'C:\\repo\\mod\\deck', platform: 'win32', now });
    expect(r.installedId).toBeUndefined(); expect(r.viaPluginDirs).toBe(true); expect(r.legacyIds).toEqual(['office@office-mods']);
    const s = read(d);
    expect(s.enabledPlugins).toEqual({ 'office@office-mods': false, 'usage-esp@esp-mods': true });
    expect(Object.keys(s.extraKnownMarketplaces)).toEqual(['esp-mods']);
    expect(s.pluginConfigs).toEqual({ deck: { options: { endpoint: 'http://127.0.0.1:7777/event' } } });
    expect(s.env.CLAUDE_CODE_PLUGIN_DIRS).toBe('C:\\repo\\mod\\deck');
    expect(install({ configDir: d, modDir: 'C:\\repo\\mod\\deck', platform: 'win32', now }).changed).toBe(false);
  });
  it('old and new both installed as plugins: keeps deck@… (no PLUGIN_DIRS), the old one stays disabled', () => {
    const d = cfg(); mkdirSync(join(d, 'plugins'));
    writeFileSync(join(d, 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: { 'office@office-mods': [], 'deck@claude-deck-mods': [] } }));
    writeFileSync(join(d, 'settings.json'), JSON.stringify({ enabledPlugins: { 'office@office-mods': false, 'deck@claude-deck-mods': true }, env: { CLAUDE_CODE_PLUGIN_DIRS: '/repo/mod/office' } }));
    const r = install({ configDir: d, modDir: '/repo/mod/deck', platform: 'linux', now });
    expect(r.installedId).toBe('deck@claude-deck-mods'); expect(r.migrated).toEqual(['plugin dir']);
    const s = read(d);
    expect(s.env).toEqual({}); expect(s.enabledPlugins).toEqual({ 'office@office-mods': false, 'deck@claude-deck-mods': true });
    expect(Object.keys(s.pluginConfigs).sort()).toEqual(['deck', 'deck@claude-deck-mods']);
    expect(findInstalledId({ plugins: { 'office@office-mods': {} } })).toBeUndefined();
    expect(findInstalledId({ plugins: { 'office@office-mods': {} } }, 'office@office-mods')).toBe('office@office-mods');
  });
  it('matches ids exactly: deck@other and office@other are left untouched', () => {
    const d = cfg(); mkdirSync(join(d, 'plugins'));
    writeFileSync(join(d, 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: { 'deck@other': [], 'office@other': [], 'deck@claude-deck-mods-fork': [] } }));
    const before = { enabledPlugins: { 'deck@other': true, 'office@other': true }, pluginConfigs: { 'deck@other': { options: { endpoint: 'x' } }, 'office@other': { options: { a: 1 } } } };
    writeFileSync(join(d, 'settings.json'), JSON.stringify(before));
    const r = install({ configDir: d, modDir: '/repo/mod/deck', platform: 'linux', now });
    expect(r.installedId).toBeUndefined(); expect(r.viaPluginDirs).toBe(true); expect(r.legacyIds).toEqual([]); expect(r.migrated).toEqual([]);
    const s = read(d);
    expect(s.enabledPlugins).toEqual(before.enabledPlugins);
    expect(s.pluginConfigs['deck@other']).toEqual(before.pluginConfigs['deck@other']); expect(s.pluginConfigs['office@other']).toEqual(before.pluginConfigs['office@other']);
    expect(Object.keys(s.pluginConfigs).sort()).toEqual(['deck', 'deck@other', 'office@other']);
    expect(s.env.CLAUDE_CODE_PLUGIN_DIRS).toBe('/repo/mod/deck');
    expect(findInstalledId({ plugins: { 'deck@other': {} } })).toBeUndefined(); expect(findInstalledId(['deck@claude-deck-mods'])).toBe('deck@claude-deck-mods');
  });
  it.skipIf(process.platform === 'win32')('warns (does not refuse) when the mod dir, its parent or hooks/register.ts is group/other-writable', () => {
    const root = cfg(), mod = join(root, 'mod', 'deck'); mkdirSync(join(mod, 'hooks'), { recursive: true }); writeFileSync(join(mod, 'hooks', 'register.ts'), '');
    chmodSync(root, 0o700); chmodSync(join(root, 'mod'), 0o755); chmodSync(mod, 0o755); chmodSync(join(mod, 'hooks', 'register.ts'), 0o644);
    const d = cfg();
    expect(install({ configDir: d, modDir: mod, platform: 'darwin', now }).warnings).toEqual([]);
    chmodSync(join(root, 'mod'), 0o775); chmodSync(join(mod, 'hooks', 'register.ts'), 0o666);
    const r = install({ configDir: d, modDir: mod, platform: 'darwin', now });
    expect(r.warnings).toHaveLength(2);
    expect(r.warnings[0]).toMatch(/^parent of the mod dir .* is group-writable \(mode 775\)/); expect(r.warnings[1]).toMatch(/^hooks\/register\.ts .* is world-writable/);
    expect(read(d).pluginConfigs.deck.options.endpoint).toBe('http://127.0.0.1:7777/event');
    expect(writableWarnings(mod, 'win32')).toEqual([]);
  });
});
