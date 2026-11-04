import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { OfficeEvent } from './types.js';
export class JsonlLog {
  constructor(readonly path: string) { mkdirSync(dirname(path), { recursive: true }); }
  write(e: OfficeEvent) { appendFileSync(this.path, JSON.stringify(e) + '\n', { mode: 0o600 }); }
}
