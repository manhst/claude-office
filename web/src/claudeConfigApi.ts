/** Authenticated GET /claude-config and POST /claude-config/mcp/* (Bearer run token in the Authorization header only, never in a URL). */
import { officeHttpBase } from './settingsApi';
import type { ClaudeConfigView, McpDeleteRequest, McpErrorResponse, McpRevealRequest, McpRevealResponse, McpSaveRequest, McpTestRequest, McpTestResult, McpWriteResponse } from './types';

/** HTTP failure with the server's McpErrorResponse (`error`, `reason`, `backup`); status 0 = network error, -1 = response was not JSON. */
export class ConfigHttpError extends Error {
  status: number; error?: string; reason?: string; backup?: string;
  constructor(status: number, body: Partial<McpErrorResponse> = {}) {
    super(`claude-config ${status}${body.error ? `: ${body.error}` : ''}`); this.name = 'ConfigHttpError'; this.status = status; this.error = body.error; this.reason = body.reason; this.backup = body.backup;
  }
}
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
async function call<T>(token: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = { authorization: `Bearer ${token}`, accept: 'application/json' };
  const init: RequestInit = body === undefined ? { headers, cache: 'no-store', signal } : { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body), signal };
  let r: Response;
  try { r = await fetch(`${officeHttpBase()}${path}`, init); } catch (e) { if (signal?.aborted) throw e; throw new ConfigHttpError(0); }
  if (!r.ok) { const j = await r.json().catch(() => null) as Record<string, unknown> | null; throw new ConfigHttpError(r.status, { error: str(j?.error), reason: str(j?.reason), backup: str(j?.backup) }); }
  try { return (await r.json()) as T; } catch (e) { if (signal?.aborted) throw e; throw new ConfigHttpError(-1); }
}
export const fetchClaudeConfig = (token: string, signal?: AbortSignal) => call<ClaudeConfigView>(token, '/claude-config', undefined, signal);
export const mcpSave = (token: string, req: McpSaveRequest, signal?: AbortSignal) => call<McpWriteResponse>(token, '/claude-config/mcp/save', req, signal);
export const mcpDelete = (token: string, req: McpDeleteRequest, signal?: AbortSignal) => call<McpWriteResponse>(token, '/claude-config/mcp/delete', req, signal);
export const mcpReveal = (token: string, req: McpRevealRequest, signal?: AbortSignal) => call<McpRevealResponse>(token, '/claude-config/mcp/reveal', req, signal);
export const mcpTest = (token: string, req: McpTestRequest, signal?: AbortSignal) => call<McpTestResult>(token, '/claude-config/mcp/test', req, signal);
export type ErrInfo = { status: number; error?: string; reason?: string; backup?: string };
/** status + server error body of any failure (non-HTTP errors count as network). */
export const errInfo = (e: unknown): ErrInfo => e instanceof ConfigHttpError ? { status: e.status, ...(e.error !== undefined ? { error: e.error } : {}), ...(e.reason !== undefined ? { reason: e.reason } : {}), ...(e.backup !== undefined ? { backup: e.backup } : {}) } : { status: 0 };
export const isConfirmRequired = (i: ErrInfo) => i.status === 400 && i.error === 'confirm-required';
