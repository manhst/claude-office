import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { OfficeEvent } from './types.js';
export class JsonlLog {
  constructor(readonly path: string) { mkdirSync(dirname(path), { recursive: true }); }
  write(e: OfficeEvent) { appendFileSync(this.path, JSON.stringify(e) + '\n', { mode: 0o600 }); }
}
/** Log filter: a `session.turn` is logged at its first start and once it ended; live progress in between goes to the UI only (keeps the log O(n) per turn). */
export function turnLogGate() {
  const open = new Set<string>();
  return (e: OfficeEvent) => {
    if (e.t !== 'session.turn') return true;
    const k = `${e.turn.sid}|${e.turn.turnId}|${e.turn.agentRunId ?? ''}`;
    if (e.turn.status !== 'running') { open.delete(k); return true; }
    if (open.has(k)) return false;
    open.add(k); return true;
  };
}
