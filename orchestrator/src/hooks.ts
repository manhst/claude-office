import type { OfficeEvent } from './types.js';
import { redactText, summarizeInput } from './redact.js';
import type { StateInput } from './state.js';
/** Claude Code hook payload → office events (fallback source when agents aren't spawned by us). */
export interface HookPayload { hook_event_name?: string; session_id?: string; tool_name?: string; tool_input?: unknown; tool_response?: unknown; tool_use_id?: string; last_assistant_message?: string }
export function mapHook(p: HookPayload, id: string, ts = Date.now()): { event?: OfficeEvent; input?: StateInput } {
  const callId = String(p.tool_use_id ?? `${p.session_id ?? 's'}:${p.tool_name ?? 'tool'}`);
  switch (p.hook_event_name) {
    case 'UserPromptSubmit': return { input: 'resume' };
    case 'PreToolUse': return { input: 'tool_use', event: { t: 'tool.call', id, callId, tool: String(p.tool_name ?? '?'), inputSummary: summarizeInput(p.tool_input), ts } };
    case 'PostToolUse': {
      const r: any = p.tool_response; const ok = !(r && typeof r === 'object' && (r.is_error || r.success === false || r.error));
      return { input: 'tool_result', event: { t: 'tool.result', id, callId, ok, summary: redactText(typeof r === 'string' ? r : JSON.stringify(r ?? ''), 300), ts } };
    }
    case 'Stop': case 'SubagentStop':
      return { input: 'result', event: { t: 'agent.done', id, result: redactText(String(p.last_assistant_message ?? ''), 500), durationMs: 0, ts } };
    default: return {};
  }
}
