// IT Ops side character: polls a Prometheus-compatible HTTP API (instant query) and reports firing alerts to the UI.
// Not configured → status 'unconfigured' (UI shows "chưa cấu hình"). Demo alerts only when explicitly in demo mode, and labelled demo.
import type { ItOpsAlert, ItOpsStatus } from './types.js';
export interface ItOpsConfig { url?: string; query: string; intervalMs: number; demo: boolean }
export const DEFAULT_QUERY = 'ALERTS{alertstate="firing"}';
export function itopsConfigFromEnv(env: NodeJS.ProcessEnv, demo: boolean, urlArg?: string): ItOpsConfig {
  const url = (urlArg ?? env.OFFICE_PROMETHEUS_URL ?? '').trim().replace(/\/+$/, '') || undefined;
  const iv = Number(env.OFFICE_PROMETHEUS_INTERVAL_MS);
  return { url, query: env.OFFICE_PROMETHEUS_QUERY?.trim() || DEFAULT_QUERY, intervalMs: Number.isFinite(iv) && iv >= 2000 ? iv : 30_000, demo: demo && !url };
}
/** Prometheus /api/v1/query vector result → alerts. Every returned series counts as a problem. */
export function parsePrometheus(body: unknown): ItOpsAlert[] {
  const b = body as any;
  if (b?.status !== 'success' || !Array.isArray(b?.data?.result)) throw new Error(`bad response${b?.error ? `: ${String(b.error).slice(0, 120)}` : ''}`);
  return b.data.result.slice(0, 20).map((r: any) => {
    const m = r?.metric ?? {};
    const name = String(m.alertname ?? m.__name__ ?? 'series');
    const where = m.instance ?? m.job ?? m.service ?? m.pod;
    return { name: name.slice(0, 60), detail: [where, m.severity].filter(Boolean).join(' · ').slice(0, 100) || undefined, value: Array.isArray(r?.value) ? String(r.value[1]).slice(0, 20) : undefined };
  });
}
const safeUrl = (u: string) => { try { const x = new URL(u); x.username = ''; x.password = ''; x.search = ''; return x.toString().replace(/\/$/, ''); } catch { return 'invalid url'; } };
export class ItOpsMonitor {
  status: ItOpsStatus; private timer?: NodeJS.Timeout; private n = 0;
  constructor(private cfg: ItOpsConfig, private emit: (s: ItOpsStatus) => void, private fetchFn: typeof fetch = fetch, private now = () => Date.now()) {
    this.status = cfg.url ? { mode: 'prometheus', state: 'checking', endpoint: safeUrl(cfg.url), query: cfg.query, alerts: [] }
      : cfg.demo ? { mode: 'demo', state: 'ok', query: 'demo', alerts: [] } : { mode: 'unconfigured', state: 'unconfigured', alerts: [] };
  }
  start() { if (this.status.mode === 'unconfigured') return; void this.check(); this.timer = setInterval(() => void this.check(), this.cfg.demo ? 15_000 : this.cfg.intervalMs); this.timer.unref?.(); }
  stop() { clearInterval(this.timer); }
  private set(p: Partial<ItOpsStatus>) { this.status = { ...this.status, ...p, checkedAt: this.now() }; this.emit(this.status); }
  async check() {
    if (this.status.mode === 'demo') { // alternates: ok, alert, ok, ... clearly labelled demo
      const firing = this.n++ % 2 === 1;
      return this.set(firing ? { state: 'alert', alerts: [{ name: 'DEMO HighLatency', detail: 'api-gateway · p99 > 2s (demo)' }] } : { state: 'ok', alerts: [] });
    }
    if (!this.cfg.url) return;
    try {
      const r = await this.fetchFn(`${this.cfg.url}/api/v1/query?query=${encodeURIComponent(this.cfg.query)}`, { signal: AbortSignal.timeout(10_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const alerts = parsePrometheus(await r.json());
      this.set({ state: alerts.length ? 'alert' : 'ok', alerts, error: undefined });
    } catch (e) { this.set({ state: 'error', error: String((e as Error).message ?? e).slice(0, 160), alerts: [] }); }
  }
}
