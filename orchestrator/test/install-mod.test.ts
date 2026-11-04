import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-ignore plain .mjs script without type declarations
import { install, findInstalledId } from '../../scripts/install-mod.mjs';
const cfg = () => mkdtempSync(join(tmpdir(), 'office-cfg-'));
const read = (d: string) => { const t = readFileSync(join(d, 'settings.json'), 'utf8'); expect(t.charCodeAt(0)).not.toBe(0xfeff); return JSON.parse(t); };
const baks = (d: string) => readdirSync(d).filter((f) => f.startsWith('settings.json.bak-'));
const now = new Date(2026, 10, 5, 0, 13, 7);
describe('install-mod', () => {
  it('fresh config: creates settings with plugin dir + endpoint, no backup', () => {
    const d = join(cfg(), 'nested'); const r = install({ configDir: d, modDir: 'C:\\repo\\mod\\office', port: 7777, platform: 'win32', now });
    expect(r.changed).toBe(true); expect(r.backup).toBeUndefined();
    expect(read(d)).toEqual({ env: { CLAUDE_CODE_PLUGIN_DIRS: 'C:\\repo\\mod\\office' }, pluginConfigs: { office: { options: { endpoint: 'http://127.0.0.1:7777/event' } } } });
    expect(readFileSync(join(d, 'settings.json'), 'utf8')).toContain('\n  "env"');
  });
  it('second run changes nothing and makes no backup', () => {
    const d = cfg(); install({ configDir: d, modDir: '/repo/mod/office', platform: 'linux', now });
    const before = readFileSync(join(d, 'settings.json'), 'utf8');
    const r = install({ configDir: d, modDir: '/repo/mod/office', platform: 'linux', now });
    expect(r.changed).toBe(false); expect(baks(d)).toEqual([]); expect(readFileSync(join(d, 'settings.json'), 'utf8')).toBe(before);
  });
  it('preserves other keys and existing PLUGIN_DIRS entries, dedupes, backs up once', () => {
    const d = cfg();
    writeFileSync(join(d, 'settings.json'), '\uFEFF' + JSON.stringify({ model: 'opus', env: { FOO: '1', CLAUDE_CODE_PLUGIN_DIRS: 'C:\\esp\\usage-esp;c:\\repo\\mod\\office\\;C:\\esp\\usage-esp' },
      pluginConfigs: { office: { options: { endpoint: 'old', other: 2 }, x: 1 }, 'usage-esp': { options: { endpoint: 'http://127.0.0.1:8266/usage' } } } }));
    const r = install({ configDir: d, modDir: 'C:\\repo\\mod\\office', port: 7788, platform: 'win32', now });
    expect(r.backup).toMatch(/settings\.json\.bak-20261105-001307$/); expect(baks(d)).toHaveLength(1);
    const s = read(d);
    expect(s.model).toBe('opus'); expect(s.env.FOO).toBe('1');
    expect(s.env.CLAUDE_CODE_PLUGIN_DIRS).toBe('C:\\esp\\usage-esp;C:\\repo\\mod\\office');
    expect(s.pluginConfigs.office).toEqual({ options: { endpoint: 'http://127.0.0.1:7788/event', other: 2 }, x: 1 });
    expect(s.pluginConfigs['usage-esp'].options.endpoint).toBe('http://127.0.0.1:8266/usage');
    expect(install({ configDir: d, modDir: 'C:\\repo\\mod\\office', port: 7788, platform: 'win32', now }).changed).toBe(false);
    expect(baks(d)).toHaveLength(1);
  });
  it('uses ":" on mac/linux', () => {
    const d = cfg(); writeFileSync(join(d, 'settings.json'), JSON.stringify({ env: { CLAUDE_CODE_PLUGIN_DIRS: '/esp/usage-esp' } }));
    install({ configDir: d, modDir: '/repo/mod/office', platform: 'darwin', now });
    expect(read(d).env.CLAUDE_CODE_PLUGIN_DIRS).toBe('/esp/usage-esp:/repo/mod/office');
  });
  it('installed as plugin: removes our dir from PLUGIN_DIRS, sets endpoint under both keys', () => {
    const d = cfg(); mkdirSync(join(d, 'plugins'));
    writeFileSync(join(d, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'office@office-mods': [{ scope: 'user' }], 'usage-esp@esp-mods': [] } }));
    writeFileSync(join(d, 'settings.json'), JSON.stringify({ env: { CLAUDE_CODE_PLUGIN_DIRS: '/esp/usage-esp:/repo/mod/office' } }));
    const r = install({ configDir: d, modDir: '/repo/mod/office', platform: 'linux', now });
    expect(r.installedId).toBe('office@office-mods');
    const s = read(d);
    expect(s.env.CLAUDE_CODE_PLUGIN_DIRS).toBe('/esp/usage-esp');
    expect(s.pluginConfigs['office@office-mods'].options.endpoint).toBe('http://127.0.0.1:7777/event');
    expect(s.pluginConfigs.office.options.endpoint).toBe('http://127.0.0.1:7777/event');
    expect(findInstalledId({ plugins: { 'x@y': {} } })).toBeUndefined();
  });
});
