import { mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// Every server a test starts (demo or not) indexes an empty history dir, never this machine's ~/.claude/projects transcripts.
process.env.OFFICE_HISTORY_DIR = mkdtempSync(join(tmpdir(), 'office-hist-empty-'));
// Bookmarks and the run dir (ui-url.txt, default settings) go to temp paths too, never the live server's orchestrator/.run/.
process.env.OFFICE_HISTORY_BOOKMARKS = join(mkdtempSync(join(tmpdir(), 'office-bm-')), 'history-bookmarks.json');
process.env.OFFICE_RUN_DIR = mkdtempSync(join(tmpdir(), 'office-run-'));
// Claude config tab: temp ~/.claude.json + settings.json and a fake `claude` CLI; the real config and CLI are never touched.
const cc = mkdtempSync(join(tmpdir(), 'office-cc-'));
process.env.OFFICE_CLAUDE_JSON = join(cc, '.claude.json'); process.env.OFFICE_CLAUDE_SETTINGS = join(cc, 'settings.json');
writeFileSync(process.env.OFFICE_CLAUDE_JSON, '{}\n'); writeFileSync(process.env.OFFICE_CLAUDE_SETTINGS, '{}\n');
process.env.OFFICE_CLAUDE_BIN = fileURLToPath(new URL('./fake/claude.mjs', import.meta.url));
// Same results whether vitest runs in a terminal or inside a Claude Code session: the session markers are cleared here (only the fake CLI ever runs);
// the session read-only path is tested by passing them explicitly.
delete process.env.CLAUDE_CODE_CHILD_SESSION; delete process.env.CLAUDECODE; delete process.env.CLAUDE_CODE_SESSION_ID;
for (const real of [join(homedir(), '.claude.json'), join(homedir(), '.claude', 'settings.json')])
  if ([process.env.OFFICE_CLAUDE_JSON, process.env.OFFICE_CLAUDE_SETTINGS].some((p) => resolve(p!) === resolve(real))) throw new Error(`test setup would use the real ${real}`);
