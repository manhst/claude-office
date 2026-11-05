import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { applyPatch, loadSettings, maskUrl, resolveItopsConfig, saveSettings, toView, urlHasCredentials } from '../src/settings.js';
import { ItOpsMonitor, DEFAULT_QUERY } from '../src/itops.js';
import { start, parseArgs } from '../src/cli.js';

describe('settings helpers', () => {
  it('masks password in prometheus URL', () => {
    expect(maskUrl('http://user:s3cret@prom:9090')).toBe('http://user:***@prom:9090');
    expect(maskUrl('http://prom:9090')).toBe('http://prom:9090');
    expect(urlHasCredentials('http://a:b@h/')).toBe(true);
    expect(urlHasCredentials('http://h/')).toBe(false);
  });
  it('load/save office-settings.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'office-set-'));
    const path = join(dir, 'office-settings.json');
    expect(loadSettings(path)).toEqual({});
    saveSettings(path, { prometheusUrl: 'http://user:pw@localhost:9090/', prometheusQuery: 'up', prometheusIntervalMs: 5000 });
    expect(existsSync(path)).toBe(true);
    const got = loadSettings(path);
    expect(got.prometheusUrl).toBe('http://user:pw@localhost:9090');
    expect(got.prometheusQuery).toBe('up');
    expect(got.prometheusIntervalMs).toBe(5000);
    const raw = readFileSync(path, 'utf8');
    expect(raw).toContain('user:pw'); // file keeps credentials; UI masks
  });
  it('applyPatch clears and validates interval', () => {
    let f = applyPatch({}, { prometheusUrl: 'http://p:9090', prometheusIntervalMs: 4000 });
    expect(f.prometheusUrl).toBe('http://p:9090');
    f = applyPatch(f, { prometheusUrl: null, prometheusQuery: 'ALERTS' });
    expect(f.prometheusUrl).toBeUndefined();
    expect(f.prometheusQuery).toBe('ALERTS');
    expect(() => applyPatch({}, { prometheusIntervalMs: 500 })).toThrow(/intervalMs/);
  });
  it('resolveItopsConfig: CLI > file > env; demo only without url', () => {
    const env = { OFFICE_PROMETHEUS_URL: 'http://env:9090', OFFICE_PROMETHEUS_QUERY: 'envq', OFFICE_PROMETHEUS_INTERVAL_MS: '8000' } as NodeJS.ProcessEnv;
    expect(resolveItopsConfig(env, true, 'http://cli:9090', {}).url).toBe('http://cli:9090');
    expect(resolveItopsConfig(env, true, undefined, { prometheusUrl: 'http://file:9090' }).url).toBe('http://file:9090');
    expect(resolveItopsConfig(env, true, undefined, {}).url).toBe('http://env:9090');
    expect(resolveItopsConfig({}, true, undefined, {}).demo).toBe(true);
    expect(resolveItopsConfig({}, true, undefined, { prometheusUrl: 'http://x' }).demo).toBe(false);
    expect(resolveItopsConfig({}, false, undefined, {}).query).toBe(DEFAULT_QUERY);
  });
  it('toView never leaks password', () => {
    const file = { prometheusUrl: 'http://u:secret@h:9090' };
    const cfg = resolveItopsConfig({}, false, undefined, file);
    const mon = new ItOpsMonitor(cfg, () => {});
    const v = toView(file, cfg, mon.status, false);
    expect(v.prometheus.url).toContain('***');
    expect(v.prometheus.url).not.toContain('secret');
    expect(v.prometheus.hasCredentials).toBe(true);
    expect(v.desks.total).toBe(6);
  });
  it('ItOpsMonitor.reconfigure switches mode live', async () => {
    const statuses: string[] = [];
    const mon = new ItOpsMonitor({ demo: true, query: 'demo', intervalMs: 30_000 }, (s) => statuses.push(s.mode));
    expect(mon.status.mode).toBe('demo');
    mon.reconfigure({ url: 'http://127.0.0.1:9', query: 'up', intervalMs: 30_000, demo: false });
    expect(mon.status.mode).toBe('prometheus');
    expect(mon.status.endpoint).toBe('http://127.0.0.1:9');
    mon.reconfigure({ demo: false, query: 'up', intervalMs: 30_000 });
    expect(mon.status.mode).toBe('unconfigured');
    mon.stop();
  });
});

const httpJson = (port: number, method: string, path: string, body?: unknown, token?: string) => new Promise<{ status: number; json: any }>((res, rej) => {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const headers: Record<string, string> = { accept: 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (payload) { headers['content-type'] = 'application/json'; headers['content-length'] = String(Buffer.byteLength(payload)); }
  const q = request({ host: '127.0.0.1', port, path, method, headers }, (r) => {
    let b = ''; r.on('data', (c) => b += c); r.on('end', () => {
      let json: any = null; try { json = b ? JSON.parse(b) : null; } catch { json = b; }
      res({ status: r.statusCode!, json });
    });
  });
  q.on('error', rej); q.end(payload);
});

describe('settings HTTP API', () => {
  it('GET/PUT /settings with token; persists prometheus and applies', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'office-setapi-'));
    const settingsPath = join(dir, 'office-settings.json');
    const r = await start({ ...parseArgs(['--port', '0', '--log-dir', dir]), settingsPath });
    try {
      expect((await httpJson(r.port, 'GET', '/settings')).status).toBe(401);
      const g = await httpJson(r.port, 'GET', '/settings', undefined, r.token);
      expect(g.status).toBe(200);
      expect(g.json.prometheus.urlSet).toBe(false);
      expect(g.json.itops.mode).toBe('unconfigured');
      expect(g.json.desks.total).toBe(6);

      const put = await httpJson(r.port, 'PUT', '/settings', {
        prometheusUrl: 'http://mon:sekrit@127.0.0.1:9090',
        prometheusQuery: 'ALERTS{alertstate="firing"}',
        prometheusIntervalMs: 12000,
      }, r.token);
      expect(put.status).toBe(200);
      expect(put.json.prometheus.url).toContain('***');
      expect(put.json.prometheus.url).not.toContain('sekrit');
      expect(put.json.prometheus.urlSet).toBe(true);
      expect(put.json.prometheus.intervalMs).toBe(12000);
      expect(put.json.itops.mode).toBe('prometheus');
      expect(r.itops.status.mode).toBe('prometheus');

      const disk = loadSettings(settingsPath);
      expect(disk.prometheusUrl).toBe('http://mon:sekrit@127.0.0.1:9090');
      expect(disk.prometheusIntervalMs).toBe(12000);

      const clear = await httpJson(r.port, 'PUT', '/settings', { prometheusUrl: null }, r.token);
      expect(clear.status).toBe(200);
      expect(clear.json.prometheus.urlSet).toBe(false);
      expect(r.itops.status.mode).toBe('unconfigured');
    } finally { await r.close(); }
  });

  it('demo mode reflected in settings view', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'office-setdemo-'));
    const r = await start({ ...parseArgs(['--port', '0', '--log-dir', dir, '--demo']), settingsPath: join(dir, 's.json') });
    try {
      const g = await httpJson(r.port, 'GET', '/settings', undefined, r.token);
      expect(g.json.demo).toBe(true);
      expect(g.json.itops.mode).toBe('demo');
    } finally { await r.close(); }
  });
});
