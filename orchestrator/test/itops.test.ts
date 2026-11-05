import { describe, it, expect } from 'vitest';
import { ItOpsMonitor, itopsConfigFromEnv, parsePrometheus, DEFAULT_QUERY } from '../src/itops.js';
describe('IT Ops monitor', () => {
  it('config: env, --prometheus wins, demo only without endpoint', () => {
    expect(itopsConfigFromEnv({}, false)).toMatchObject({ url: undefined, query: DEFAULT_QUERY, intervalMs: 30000, demo: false });
    expect(itopsConfigFromEnv({ OFFICE_PROMETHEUS_URL: 'http://p:9090/', OFFICE_PROMETHEUS_QUERY: 'up == 0', OFFICE_PROMETHEUS_INTERVAL_MS: '5000' }, true))
      .toMatchObject({ url: 'http://p:9090', query: 'up == 0', intervalMs: 5000, demo: false });
    expect(itopsConfigFromEnv({ OFFICE_PROMETHEUS_URL: 'http://a' }, false, 'http://b').url).toBe('http://b');
  });
  it('unconfigured: no alerts, never polls', async () => {
    let calls = 0; const m = new ItOpsMonitor(itopsConfigFromEnv({}, false), () => {}, (async () => { calls++; }) as any);
    m.start(); await m.check(); m.stop();
    expect(m.status).toMatchObject({ mode: 'unconfigured', state: 'unconfigured', alerts: [] }); expect(calls).toBe(0);
  });
  it('parses firing alerts, ok when empty, error on failure; endpoint shown without credentials', async () => {
    let body: any = { status: 'success', data: { resultType: 'vector', result: [{ metric: { alertname: 'DiskFull', instance: 'db1:9100', severity: 'critical' }, value: [1, '1'] }] } };
    const urls: string[] = []; const seen: any[] = [];
    const f = (async (u: string) => { urls.push(u); if (body === 'down') throw new Error('ECONNREFUSED'); return { ok: true, json: async () => body }; }) as any;
    const m = new ItOpsMonitor(itopsConfigFromEnv({ OFFICE_PROMETHEUS_URL: 'http://u:secret@prom:9090' }, false), (s) => seen.push(s), f);
    expect(m.status.endpoint).toBe('http://prom:9090');
    await m.check(); expect(m.status).toMatchObject({ state: 'alert', alerts: [{ name: 'DiskFull', detail: 'db1:9100 · critical' }] });
    expect(urls[0]).toBe('http://u:secret@prom:9090/api/v1/query?query=' + encodeURIComponent(DEFAULT_QUERY));
    body = { status: 'success', data: { result: [] } }; await m.check(); expect(m.status.state).toBe('ok');
    body = 'down'; await m.check(); expect(m.status).toMatchObject({ state: 'error', error: 'ECONNREFUSED' });
    expect(JSON.stringify(seen)).not.toContain('secret');
    expect(() => parsePrometheus({ status: 'error', error: 'parse error' })).toThrow('parse error');
  });
  it('demo mode alternates ok/alert and labels it demo', async () => {
    const m = new ItOpsMonitor(itopsConfigFromEnv({}, true), () => {});
    await m.check(); expect(m.status).toMatchObject({ mode: 'demo', state: 'ok' });
    await m.check(); expect(m.status.state).toBe('alert'); expect(m.status.alerts[0].name).toContain('DEMO');
  });
});
