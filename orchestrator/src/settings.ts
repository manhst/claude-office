// Persisted office settings (Prometheus IT Ops, etc.). File lives under orchestrator/.run/ (mode 600), never committed.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_QUERY, type ItOpsConfig } from './itops.js';
import type { ItOpsStatus } from './types.js';

export interface OfficeSettingsFile {
  prometheusUrl?: string;
  prometheusQuery?: string;
  prometheusIntervalMs?: number;
}
export interface SettingsPatch {
  prometheusUrl?: string | null;
  prometheusQuery?: string | null;
  prometheusIntervalMs?: number | null;
}
/** Safe view for the UI: credentials in the URL are masked; raw secrets never leave the server. */
export interface SettingsView {
  prometheus: { url: string; urlSet: boolean; hasCredentials: boolean; query: string; intervalMs: number };
  itops: Pick<ItOpsStatus, 'mode' | 'state' | 'endpoint' | 'query' | 'error'>;
  demo: boolean;
  desks: { total: number; perSession: number; cols: number };
  notes: { avatar: string; vpDebug: string };
}

/** Mask userinfo password in a URL for display (http://user:***@host). */
export function maskUrl(raw: string): string {
  const s = raw.trim(); if (!s) return '';
  try {
    const u = new URL(s);
    if (u.password) u.password = '***';
    return u.toString().replace(/\/$/, '');
  } catch { return s.replace(/\/\/([^/@:]+):([^/@]+)@/, '//$1:***@'); }
}
export function urlHasCredentials(raw: string): boolean {
  try { const u = new URL(raw.trim()); return !!(u.username || u.password); } catch { return /\/\/[^/@]+:[^/@]+@/.test(raw); }
}
export function loadSettings(path: string): OfficeSettingsFile {
  try {
    if (!existsSync(path)) return {};
    const j = JSON.parse(readFileSync(path, 'utf8')) as OfficeSettingsFile;
    return sanitizeFile(j);
  } catch { return {}; }
}
export function saveSettings(path: string, s: OfficeSettingsFile): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(sanitizeFile(s), null, 2) + '\n', { mode: 0o600 });
}
function sanitizeFile(j: OfficeSettingsFile): OfficeSettingsFile {
  const out: OfficeSettingsFile = {};
  if (typeof j.prometheusUrl === 'string' && j.prometheusUrl.trim()) out.prometheusUrl = j.prometheusUrl.trim().replace(/\/+$/, '');
  if (typeof j.prometheusQuery === 'string' && j.prometheusQuery.trim()) out.prometheusQuery = j.prometheusQuery.trim();
  const iv = Number(j.prometheusIntervalMs);
  if (Number.isFinite(iv) && iv >= 2000) out.prometheusIntervalMs = Math.floor(iv);
  return out;
}
/** Resolve IT Ops config: CLI --prometheus > settings file > env. Demo only when no URL and --demo. */
export function resolveItopsConfig(env: NodeJS.ProcessEnv, demo: boolean, cliUrl: string | undefined, file: OfficeSettingsFile): ItOpsConfig {
  const url = (cliUrl ?? file.prometheusUrl ?? env.OFFICE_PROMETHEUS_URL ?? '').trim().replace(/\/+$/, '') || undefined;
  const envIv = Number(env.OFFICE_PROMETHEUS_INTERVAL_MS);
  const intervalMs = file.prometheusIntervalMs
    ?? (Number.isFinite(envIv) && envIv >= 2000 ? envIv : 30_000);
  const query = file.prometheusQuery || env.OFFICE_PROMETHEUS_QUERY?.trim() || DEFAULT_QUERY;
  return { url, query, intervalMs, demo: demo && !url };
}
export function applyPatch(file: OfficeSettingsFile, patch: SettingsPatch): OfficeSettingsFile {
  const next = { ...file };
  if ('prometheusUrl' in patch) {
    const v = patch.prometheusUrl;
    if (v == null || String(v).trim() === '') delete next.prometheusUrl;
    else next.prometheusUrl = String(v).trim().replace(/\/+$/, '');
  }
  if ('prometheusQuery' in patch) {
    const v = patch.prometheusQuery;
    if (v == null || String(v).trim() === '') delete next.prometheusQuery;
    else next.prometheusQuery = String(v).trim();
  }
  if ('prometheusIntervalMs' in patch) {
    const v = patch.prometheusIntervalMs;
    if (v == null) delete next.prometheusIntervalMs;
    else {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 2000) throw new Error('intervalMs must be >= 2000');
      next.prometheusIntervalMs = Math.floor(n);
    }
  }
  return sanitizeFile(next);
}
export function toView(file: OfficeSettingsFile, cfg: ItOpsConfig, status: ItOpsStatus, demo: boolean): SettingsView {
  const raw = file.prometheusUrl ?? cfg.url ?? '';
  return {
    prometheus: {
      url: maskUrl(raw),
      urlSet: !!raw,
      hasCredentials: raw ? urlHasCredentials(raw) : false,
      query: cfg.query,
      intervalMs: cfg.intervalMs,
    },
    itops: { mode: status.mode, state: status.state, endpoint: status.endpoint, query: status.query, error: status.error },
    demo,
    desks: { total: 6, perSession: 6, cols: 3 },
    notes: {
      avatar: 'Chuột phải tên nhân vật → Đặt tên & avatar (lưu localStorage).',
      vpDebug: 'localStorage vp-debug=1 bật debug tai nạn / ngoại tình / Layoff (nâng cao).',
    },
  };
}
