import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyLegacyEnv, migrateLegacySettings } from '../src/env.js';
import { saveSettings } from '../src/settings.js';
const mode = (p: string) => statSync(p).mode & 0o777;
describe('legacy OFFICE_* env + settings file', () => {
  it('copies OFFICE_X into DECK_X only when DECK_X is unset', () => {
    const env: NodeJS.ProcessEnv = { OFFICE_DEMO: '1', OFFICE_RUN_DIR: '/old', DECK_RUN_DIR: '/new', PATH: '/bin' };
    expect(applyLegacyEnv(env)).toEqual(['DECK_DEMO']);
    expect(env).toMatchObject({ DECK_DEMO: '1', DECK_RUN_DIR: '/new', OFFICE_RUN_DIR: '/old' });
    expect(applyLegacyEnv(env)).toEqual([]);
  });
  it('renames office-settings.json to deck-settings.json once, never over an existing deck file', () => {
    const d = mkdtempSync(join(tmpdir(), 'deck-envmig-'));
    expect(migrateLegacySettings(d)).toBe(false);
    writeFileSync(join(d, 'office-settings.json'), '{"a":1}');
    expect(migrateLegacySettings(d)).toBe(true);
    expect(readFileSync(join(d, 'deck-settings.json'), 'utf8')).toBe('{"a":1}'); expect(existsSync(join(d, 'office-settings.json'))).toBe(false);
    writeFileSync(join(d, 'office-settings.json'), '{"a":2}');
    expect(migrateLegacySettings(d)).toBe(false); expect(readFileSync(join(d, 'deck-settings.json'), 'utf8')).toBe('{"a":1}');
  });
  it.skipIf(process.platform === 'win32')('the renamed file is 0600, and saveSettings tightens an existing looser file to 0600', () => {
    const d = mkdtempSync(join(tmpdir(), 'deck-envmig-'));
    writeFileSync(join(d, 'office-settings.json'), '{}', { mode: 0o644 }); expect(mode(join(d, 'office-settings.json'))).toBe(0o644);
    expect(migrateLegacySettings(d)).toBe(true); expect(mode(join(d, 'deck-settings.json'))).toBe(0o600);
    const f = join(d, 'other.json'); writeFileSync(f, '{}', { mode: 0o644 });
    saveSettings(f, { prometheusQuery: 'up' }); expect(mode(f)).toBe(0o600); expect(JSON.parse(readFileSync(f, 'utf8'))).toMatchObject({ prometheusQuery: 'up' });
  });
});
