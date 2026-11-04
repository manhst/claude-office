const MAX = 500;
const SECRET_KEY = /(token|secret|password|passwd|api[_-]?key|authorization|cookie|credential|private[_-]?key|^env$)/i;
const SECRET_VAL: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{10,}/g, /\bgh[pousr]_[A-Za-z0-9]{20,}/g, /\bxox[abpr]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g, /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g,
  /(Bearer\s+)[A-Za-z0-9._~+\/-]{8,}/gi,
  /\b([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|KEY|PASSWORD)[A-Z0-9_]*)=\S+/g,
  /([?&]token=)[^&\s"]+/gi,
];
export function redactText(s: string, max = MAX): string {
  let out = s;
  for (const re of SECRET_VAL) out = out.replace(re, (m, g1) => (typeof g1 === 'string' && m.startsWith(g1) ? g1 : '') + '[REDACTED]');
  return out.length > max ? out.slice(0, max) + `…(+${out.length - max})` : out;
}
export function redactValue(v: unknown, depth = 0): unknown {
  if (typeof v === 'string') return redactText(v, 200);
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => redactValue(x, depth + 1));
  if (v && typeof v === 'object') {
    if (depth > 4) return '[…]';
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) o[k] = SECRET_KEY.test(k) ? '[REDACTED]' : redactValue(x, depth + 1);
    return o;
  }
  return v;
}
export function summarizeInput(input: unknown): string { return redactText(JSON.stringify(redactValue(input ?? {})), 300); }
