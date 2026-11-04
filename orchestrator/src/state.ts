import type { AgentState } from './types.js';
export type StateInput = 'task' | 'tool_use' | 'tool_result' | 'text' | 'quiet' | 'ask' | 'reply' | 'result' | 'fail';
/** Pure transition function for the per-agent state machine (ARCHITECTURE §3). Returns same state if input is ignored. */
export function transition(s: AgentState, i: StateInput): AgentState {
  if (s === 'done' || s === 'error') return s; // terminal
  if (i === 'result') return 'done';
  if (i === 'fail') return 'error';
  switch (s) {
    case 'idle': return i === 'task' ? 'thinking' : s;
    case 'thinking':
      if (i === 'tool_use') return 'working';
      if (i === 'text' || i === 'ask') return 'talking';
      return s;
    case 'working':
      if (i === 'tool_result') return 'thinking';
      if (i === 'tool_use') return 'working';
      return s;
    case 'talking':
      if (i === 'quiet' || i === 'reply') return 'thinking';
      if (i === 'tool_use') return 'working';
      if (i === 'text' || i === 'ask') return 'talking';
      return s;
  }
}
export class AgentStateMachine {
  state: AgentState = 'idle';
  constructor(private onChange: (s: AgentState) => void) {}
  feed(i: StateInput): AgentState {
    const n = transition(this.state, i);
    if (n !== this.state) { this.state = n; this.onChange(n); }
    return n;
  }
}
