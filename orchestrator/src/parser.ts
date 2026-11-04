import type { OfficeEvent } from './types.js';
import { redactText, summarizeInput } from './redact.js';
/** Parser outputs content events; state transitions are derived by the orchestrator from `inputs`. */
export interface ParsedLine { events: OfficeEvent[]; inputs: Array<'text' | 'tool_use' | 'tool_result' | 'result' | 'fail'>; sessionId?: string; init?: { model?: string; tools?: string[] } }
type Json = any;
export class StreamParser {
  private toolNames = new Map<string, string>();
  constructor(private agentId: string, private now: () => number = Date.now) {}
  parseLine(line: string): ParsedLine {
    const out: ParsedLine = { events: [], inputs: [] };
    const trimmed = line.trim();
    if (!trimmed) return out;
    let msg: Json;
    try { msg = JSON.parse(trimmed); } catch { return out; } // non-JSON noise is ignored
    const id = this.agentId, ts = this.now();
    if (msg.session_id) out.sessionId = msg.session_id;
    switch (msg.type) {
      case 'system':
        if (msg.subtype === 'init') out.init = { model: msg.model, tools: Array.isArray(msg.tools) ? msg.tools : undefined };
        break;
      case 'assistant':
        for (const c of msg.message?.content ?? []) {
          if (c.type === 'text' && typeof c.text === 'string' && c.text.trim()) {
            out.events.push({ t: 'agent.text', id, text: redactText(c.text, 2000), ts }); out.inputs.push('text');
          } else if (c.type === 'tool_use') {
            this.toolNames.set(c.id, c.name);
            out.events.push({ t: 'tool.call', id, callId: String(c.id), tool: String(c.name), inputSummary: summarizeInput(c.input), ts }); out.inputs.push('tool_use');
          }
        }
        break;
      case 'user': {
        const content = msg.message?.content;
        if (Array.isArray(content)) for (const c of content) {
          if (c.type !== 'tool_result') continue;
          const raw = typeof c.content === 'string' ? c.content : Array.isArray(c.content) ? c.content.map((x: Json) => x?.text ?? '').join('') : '';
          out.events.push({ t: 'tool.result', id, callId: String(c.tool_use_id), ok: !c.is_error, summary: redactText(raw, 300), ts }); out.inputs.push('tool_result');
        }
        break;
      }
      case 'result':
        if (msg.subtype === 'success' && !msg.is_error) {
          out.events.push({ t: 'agent.done', id, result: redactText(String(msg.result ?? ''), 2000), costUsd: msg.total_cost_usd, durationMs: Number(msg.duration_ms ?? 0), ts }); out.inputs.push('result');
        } else {
          out.events.push({ t: 'agent.error', id, error: redactText(String(msg.result ?? msg.subtype ?? 'unknown error'), 500), ts }); out.inputs.push('fail');
        }
        break;
    }
    return out;
  }
}
