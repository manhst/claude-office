/** Agent↔agent routing (ARCHITECTURE §4). Agents never talk directly; they emit `@@ASK <role>: <question>`. */
export interface Ask { to: string; text: string }
export interface RoutedMessage { from: string; to: string; text: string; hops: number; chain: string[]; kind: 'ask' | 'reply'; qid: string }
export type RouteReject = 'unknown_role' | 'self' | 'hop_limit' | 'loop' | 'duplicate' | 'budget';
export type RouteResult = { ok: true; msg: RoutedMessage } | { ok: false; reason: RouteReject; to: string; text: string };
const ASK_RE = /^\s*@@ASK\s+([A-Za-z][\w-]*)\s*:\s*(.+?)\s*$/gm;
export function extractAsks(text: string): Ask[] {
  const out: Ask[] = [];
  for (const m of text.matchAll(ASK_RE)) out.push({ to: m[1].toLowerCase(), text: m[2].slice(0, 1000) });
  return out;
}
export function stripAsks(text: string) { return text.replace(ASK_RE, '').trim(); }
export interface RouterLimits { maxHops: number; maxMessages: number }
export class Router {
  private sent = 0; private seen = new Set<string>(); private q = 0;
  constructor(private roles: Set<string>, readonly limits: RouterLimits = { maxHops: 3, maxMessages: 20 }) {}
  get messageCount() { return this.sent; }
  /** `chain` = roles already on the path of the question that triggered `from`'s current turn (empty for the root task). */
  ask(from: string, ask: Ask, chain: string[] = []): RouteResult {
    const rej = (reason: RouteReject): RouteResult => ({ ok: false, reason, to: ask.to, text: ask.text });
    if (!this.roles.has(ask.to)) return rej('unknown_role');
    if (ask.to === from) return rej('self');
    const path = [...chain.filter((r) => r !== from), from];
    if (path.includes(ask.to)) return rej('loop');
    if (path.length > this.limits.maxHops) return rej('hop_limit');
    const key = `${from}>${ask.to}:${ask.text.trim().toLowerCase()}`;
    if (this.seen.has(key)) return rej('duplicate');
    if (this.sent >= this.limits.maxMessages) return rej('budget');
    this.seen.add(key); this.sent++;
    return { ok: true, msg: { from, to: ask.to, text: ask.text, hops: path.length, chain: path, kind: 'ask', qid: `q${++this.q}` } };
  }
  /** Replies travel back along the path; they count toward the message budget but not hops. */
  reply(question: RoutedMessage, text: string): RoutedMessage | null {
    if (this.sent >= this.limits.maxMessages) return null;
    this.sent++;
    return { from: question.to, to: question.from, text, hops: question.hops, chain: question.chain, kind: 'reply', qid: question.qid };
  }
}
