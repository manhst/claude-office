import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Every server a test starts (demo or not) indexes an empty history dir, never this machine's ~/.claude/projects transcripts.
process.env.OFFICE_HISTORY_DIR = mkdtempSync(join(tmpdir(), 'office-hist-empty-'));
// Bookmarks and the run dir (ui-url.txt, default settings) go to temp paths too, never the live server's orchestrator/.run/.
process.env.OFFICE_HISTORY_BOOKMARKS = join(mkdtempSync(join(tmpdir(), 'office-bm-')), 'history-bookmarks.json');
process.env.OFFICE_RUN_DIR = mkdtempSync(join(tmpdir(), 'office-run-'));
