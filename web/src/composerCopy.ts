import type { PromptAck, SessionView } from './types';

const STATUS: Record<PromptAck['state'], string> = {
  queued: 'Queued for this session — waiting for the office mod to claim it.',
  claimed: 'Claimed by the live session — submitting into Claude Code.',
  delivered: 'Handed to Claude Code (the turn has not finished).',
  rejected: 'Rejected by Claude Code. Type in that session (needed after Esc), then Send again.',
  expired: 'Expired before delivery. Send again if you still want it.',
  unsupported: 'This Claude Code build has no $.prompt.submit. Reload the office mod / update Claude Code.',
  'session-ended': 'Session ended. The queued prompt was dropped.',
  dropped: 'Dropped by Claude Code. Send again only if you still want it.',
};

/** Truthful capability copy. No fake model/mode controls. */
export function capabilityNote(s?: SessionView): string {
  if (!s) return 'Select a live session. Demo and sessions without the office mod cannot submit.';
  if (!s.canSubmit) return 'This session cannot submit to the live prompt (no $.prompt.submit). Reload the office plugin in Claude Code, then reopen the session. Change model in Claude Code — the office has no documented live model/mode setter.';
  return 'Sends into the selected live Claude Code session as you. Pending permission prompts stay in Claude Code.';
}
export function statusNote(a?: PromptAck): string | undefined {
  if (!a) return;
  const base = STATUS[a.state] ?? a.state;
  return a.reason ? `${base} (${a.reason})` : base;
}
export function composerBusy(a?: PromptAck): boolean { return a?.state === 'queued' || a?.state === 'claimed'; }
