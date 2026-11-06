/** Authenticated HTTP helpers for GET/PUT /settings (same run token as the WebSocket). */
export type SettingsView = {
  prometheus: { url: string; urlSet: boolean; hasCredentials: boolean; query: string; intervalMs: number };
  itops: { mode: string; state: string; endpoint?: string; query?: string; error?: string };
  demo: boolean;
  desks: { total: number; perSession: number; cols: number };
  notes: { avatar: string; vpDebug: string };
};
export type SettingsPatch = {
  prometheusUrl?: string | null;
  prometheusQuery?: string | null;
  prometheusIntervalMs?: number | null;
};
export function officeHttpBase(store: Storage = sessionStorage, loc: Location = location): string {
  const hostPort = store.getItem('office.ws') ?? (loc.port === '5173' || loc.port === '4173' ? '127.0.0.1:7777' : loc.host);
  return `http://${hostPort}`;
}
export async function fetchSettings(token: string): Promise<SettingsView> {
  const r = await fetch(`${officeHttpBase()}/settings`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, cache: 'no-store' });
  if (!r.ok) throw new Error(`settings ${r.status}`);
  return r.json();
}
export async function saveSettings(token: string, patch: SettingsPatch): Promise<SettingsView> {
  const r = await fetch(`${officeHttpBase()}/settings`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(patch),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `settings ${r.status}`);
  return j as SettingsView;
}
