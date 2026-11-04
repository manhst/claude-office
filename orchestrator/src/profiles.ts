import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { AgentProfile, ProfileSource } from './types.js';
const MAX_FILE = 64 * 1024, MAX_AGENTS = 12;

/** Minimal YAML frontmatter: `key: value` scalars, `key: [a, b]`, `a, b` lists and `- item` lists. Enough for Claude Code agent files. */
export function parseFrontmatter(md: string): { meta: Record<string, string | string[]>; body: string } {
  const m = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(md);
  if (!m) return { meta: {}, body: md };
  const meta: Record<string, string | string[]> = {}; let last = '';
  for (const raw of m[1].split(/\r?\n/)) {
    const item = /^\s+-\s+(.*)$/.exec(raw);
    if (item && last) { const cur = meta[last]; meta[last] = [...(Array.isArray(cur) ? cur : cur ? [cur] : []), unq(item[1])]; continue; }
    const kv = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(raw); if (!kv) continue;
    last = kv[1]; const v = kv[2].trim();
    meta[last] = v.startsWith('[') && v.endsWith(']') ? v.slice(1, -1).split(',').map(unq).filter(Boolean) : unq(v);
  }
  return { meta, body: m[2] };
}
const unq = (s: string) => s.trim().replace(/^(['"])(.*)\1$/, '$2');
const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? v.split(',') : []).map((x) => x.trim()).filter(Boolean);
function readSmall(file: string): string | null {
  try { const st = statSync(file); if (!st.isFile() || st.size > MAX_FILE) return null; return readFileSync(file, 'utf8'); } catch { return null; }
}
export function loadAgentDir(dir: string, scope: 'project' | 'user'): AgentProfile[] {
  let names: string[] = []; try { names = readdirSync(dir).filter((n) => n.endsWith('.md')).sort(); } catch { return []; }
  const out: AgentProfile[] = [];
  for (const n of names.slice(0, MAX_AGENTS)) {
    const md = readSmall(join(dir, n)); if (md == null) continue;
    const { meta, body } = parseFrontmatter(md);
    const name = String(meta.name || basename(n, '.md'));
    out.push({ name, description: String(meta.description ?? ''), tools: list(meta.tools), model: meta.model ? String(meta.model) : undefined, body: body.trim(), file: join(dir, n), scope });
  }
  return out;
}
export const DEFAULT_DEVS: AgentProfile[] = [
  { name: 'Dev 1', description: 'Placeholder developer (no .claude/agents or CLAUDE.md found for this project).', tools: [], body: '' },
  { name: 'Dev 2', description: 'Placeholder developer (no .claude/agents or CLAUDE.md found for this project).', tools: [], body: '' },
];
/** Priority A > B > C: (A) <root>/.claude/agents/*.md + <userAgentsDir>/*.md, (B) <root>/CLAUDE.md, (C) default devs. */
export function loadProfiles(root: string, userAgentsDir?: string): { source: ProfileSource; profiles: AgentProfile[] } {
  const project = root ? loadAgentDir(join(root, '.claude', 'agents'), 'project') : [];
  const seen = new Set(project.map((p) => p.name));
  const user = userAgentsDir ? loadAgentDir(userAgentsDir, 'user').filter((p) => !seen.has(p.name)) : [];
  if (project.length || user.length) return { source: 'agents', profiles: [...project, ...user].slice(0, MAX_AGENTS) };
  const claudeMd = root ? readSmall(join(root, 'CLAUDE.md')) : null;
  if (claudeMd != null) {
    const h1 = /^#\s+(.+)$/m.exec(claudeMd)?.[1]?.trim();
    return { source: 'claude-md', profiles: [{ name: h1 || basename(root) || 'Project', description: `Project instructions from CLAUDE.md`, tools: [], body: claudeMd.trim(), file: join(root, 'CLAUDE.md'), scope: 'project' }] };
  }
  return { source: 'default', profiles: DEFAULT_DEVS.map((p) => ({ ...p })) };
}
