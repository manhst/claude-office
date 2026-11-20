import { chmodSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
/** Before the Claude Deck rename the env vars were `OFFICE_*`: copies each into its `DECK_*` name when that is unset (old shells/launchers keep working). Returns the copied names. */
export function applyLegacyEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const done: string[] = [];
  for (const [k, v] of Object.entries(env)) if (k.startsWith('OFFICE_') && v !== undefined) { const n = `DECK_${k.slice(7)}`; if (env[n] === undefined) { env[n] = v; done.push(n); } }
  return done;
}
/** Renames `<runDir>/office-settings.json` (pre-rename name) to `deck-settings.json` once, when only the old file exists, then makes it 0600 (it can hold a Prometheus URL with credentials). True when it moved. */
export function migrateLegacySettings(runDir: string): boolean {
  const old = join(runDir, 'office-settings.json'), now = join(runDir, 'deck-settings.json');
  if (existsSync(now) || !existsSync(old)) return false;
  try { renameSync(old, now); } catch { return false; }
  try { chmodSync(now, 0o600); } catch { /* best effort (e.g. Windows) */ }
  return true;
}
