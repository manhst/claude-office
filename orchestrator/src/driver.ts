import { spawn, type ChildProcess } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import type { RoleDef } from './types.js';
export interface DriverHandlers { onLine(line: string): void; onExit(code: number | null, stderrTail: string): void }
export interface AgentHandle { cancel(): void }
export interface AgentDriver { readonly name: string; start(opts: StartOptions, h: DriverHandlers): AgentHandle }
export interface StartOptions { task: string; role: RoleDef; cwd: string; timeoutMs: number; resumeSessionId?: string; turn?: number }

/** Build argv for `claude -p`. Exported for tests. Never includes --dangerously-skip-permissions. */
export function buildClaudeArgs(task: string, role: RoleDef, maxTurns = 20, resumeSessionId?: string): string[] {
  const resume = resumeSessionId && /^[\w-]{8,64}$/.test(resumeSessionId) ? ['--resume', resumeSessionId] : [];
  return [...resume, '-p', task, '--output-format', 'stream-json', '--verbose', '--allowedTools', role.tools.join(','),
    '--permission-mode', 'default', '--append-system-prompt', role.systemPrompt, '--max-turns', String(maxTurns)];
}
export class CliDriver implements AgentDriver {
  readonly name = 'cli';
  constructor(private bin = 'claude') {}
  start(o: StartOptions, h: DriverHandlers): AgentHandle {
    const args = buildClaudeArgs(o.task, o.role, 20, o.resumeSessionId);
    if (args.includes('--dangerously-skip-permissions')) throw new Error('forbidden flag');
    const child: ChildProcess = spawn(this.bin, args, { cwd: o.cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let stderr = '', finished = false;
    const kill = () => { try { if (child.pid) process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); } };
    const timer = setTimeout(() => { stderr += '\n[timeout]'; kill(); }, o.timeoutMs);
    createInterface({ input: child.stdout! }).on('line', h.onLine);
    child.stderr!.on('data', (d) => { stderr = (stderr + d).slice(-2000); });
    const done = (code: number | null) => { if (finished) return; finished = true; clearTimeout(timer); h.onExit(code, stderr); };
    child.on('error', (e) => { stderr += `\n${e.message}`; done(-1); });
    child.on('close', (code) => done(code));
    return { cancel: kill };
  }
}
/** Replays recorded stream-json fixtures line by line. `fixture` is one path, or a resolver (role, turn) → path. */
export class MockDriver implements AgentDriver {
  readonly name = 'mock';
  constructor(private fixture: string | ((role: string, turn: number) => string), private delayMs = 150) {}
  start(o: StartOptions, h: DriverHandlers): AgentHandle {
    let cancelled = false;
    const path = typeof this.fixture === 'string' ? this.fixture : this.fixture(o.role.role, o.turn ?? 1);
    (async () => {
      const lines: string[] = [];
      if (existsSync(path)) for await (const l of createInterface({ input: createReadStream(path) })) lines.push(l);
      else lines.push(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: `(${o.role.name}: no fixture for turn ${o.turn}; acknowledging)` }] } }),
        JSON.stringify({ type: 'result', subtype: 'success', is_error: false, duration_ms: 500, result: 'Acknowledged.' }));
      for (const l of lines) { if (cancelled) break; await new Promise((r) => setTimeout(r, this.delayMs)); h.onLine(l); }
      h.onExit(cancelled ? 143 : 0, '');
    })().catch((e) => h.onExit(-1, String(e?.message ?? e)));
    return { cancel: () => { cancelled = true; } };
  }
}
