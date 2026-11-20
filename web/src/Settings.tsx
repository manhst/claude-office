import { useEffect, useState } from 'react';
import { IconCross, IconGear } from './icons';
import { fetchSettings, saveSettings, type SettingsView } from './settingsApi';
import { DEFAULT_LABELS, LABEL_ROWS, loadLabels, saveLabels, type LabelPrefs, type MonitorLabelMode } from './officeLabels';
import { RUN_SPEED_DEFAULT, RUN_SPEED_MAX, RUN_SPEED_MIN, loadRunSpeed, saveRunSpeed } from './officeRunSpeed';

const MODE_LABEL: Record<string, string> = {
  prometheus: 'Prometheus',
  demo: 'Demo (simulated)',
  unconfigured: 'Not configured',
};

export function SettingsButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="icon-btn settings-btn" onClick={onClick} title="Settings" aria-label="Settings" data-testid="settings-open">
      <IconGear size={16} />
    </button>
  );
}

export function SettingsPanel({ token, onClose }: { token: string; onClose: () => void }) {
  const [view, setView] = useState<SettingsView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState('');
  const [query, setQuery] = useState('');
  const [intervalSec, setIntervalSec] = useState('30');
  const [urlDirty, setUrlDirty] = useState(false);
  const [debugHooks, setDebugHooks] = useState(() => localStorage.getItem('deck.debug') === '1');
  const [runSpeed, setRunSpeed] = useState(() => loadRunSpeed());
  const [advanced, setAdvanced] = useState(false);
  const [labels, setLabels] = useState<LabelPrefs>(() => loadLabels());

  useEffect(() => {
    let cancelled = false;
    setErr(null);
    fetchSettings(token).then((v) => {
      if (cancelled) return;
      setView(v);
      setUrl(v.prometheus.url);
      setQuery(v.prometheus.query);
      setIntervalSec(String(Math.round(v.prometheus.intervalMs / 1000)));
      setUrlDirty(false);
    }).catch((e) => { if (!cancelled) setErr(String(e.message ?? e)); });
    return () => { cancelled = true; };
  }, [token]);

  const apply = async (patch: Parameters<typeof saveSettings>[1]) => {
    setBusy(true); setErr(null);
    try {
      const v = await saveSettings(token, patch);
      setView(v);
      setUrl(v.prometheus.url);
      setQuery(v.prometheus.query);
      setIntervalSec(String(Math.round(v.prometheus.intervalMs / 1000)));
      setUrlDirty(false);
    } catch (e) { setErr(String((e as Error).message ?? e)); }
    finally { setBusy(false); }
  };

  const onSave = () => {
    const iv = Math.round(Number(intervalSec) * 1000);
    const patch: Parameters<typeof saveSettings>[1] = {
      prometheusQuery: query.trim() || null,
      prometheusIntervalMs: Number.isFinite(iv) ? iv : null,
    };
    if (urlDirty) patch.prometheusUrl = url.trim() || null;
    void apply(patch);
  };

  const onClearUrl = () => void apply({ prometheusUrl: null });

  const toggleDebug = () => {
    const next = !debugHooks;
    setDebugHooks(next);
    if (next) localStorage.setItem('deck.debug', '1');
    else localStorage.removeItem('deck.debug');
  };

  const setLabelBool = (key: Exclude<keyof LabelPrefs, 'monitor'>, on: boolean) => {
    const next = { ...labels, [key]: on };
    setLabels(next);
    saveLabels(next);
  };
  const setMonitorMode = (mode: MonitorLabelMode) => {
    const next = { ...labels, monitor: mode };
    setLabels(next);
    saveLabels(next);
  };
  const resetLabels = () => {
    const next = { ...DEFAULT_LABELS };
    setLabels(next);
    saveLabels(next);
  };

  return (
    <div className="editor-back" role="dialog" aria-modal="true" aria-labelledby="settings-title" data-testid="settings-panel" onClick={onClose}>
      <div className="editor settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="editor-head">
          <h3 id="settings-title"><IconGear size={16} /> Settings</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><IconCross size={14} /></button>
        </div>

        {err && <p className="settings-err" role="alert">{err}</p>}
        {!view && !err && <p className="muted">Loading…</p>}

        {view && (
          <>
            <section className="settings-sec">
              <h4>IT Ops · Prometheus</h4>
              <p className="muted">Status: <b>{MODE_LABEL[view.itops.mode] ?? view.itops.mode}</b>
                {view.itops.state ? ` · ${view.itops.state}` : ''}
                {view.itops.endpoint ? ` · ${view.itops.endpoint}` : ''}
              </p>
              {view.demo && <p className="settings-badge" data-testid="settings-demo">Demo mode is on (--demo). Without a URL, IT Ops shows simulated alerts.</p>}
              <label>Prometheus URL
                <input
                  data-testid="settings-prom-url"
                  type={view.prometheus.hasCredentials && !urlDirty ? 'password' : 'url'}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="http://user:pass@host:9090"
                  value={url}
                  onChange={(e) => { setUrl(e.target.value); setUrlDirty(true); }}
                  onFocus={() => { if (!urlDirty && view.prometheus.hasCredentials) { setUrl(''); setUrlDirty(true); } }}
                />
              </label>
              <p className="muted">A password in the URL is masked in the UI; the server stores it in <code>orchestrator/.run/deck-settings.json</code> (mode 600).</p>
              <label>Query
                <input data-testid="settings-prom-query" spellCheck={false} value={query} onChange={(e) => setQuery(e.target.value)} />
              </label>
              <label>Poll interval (seconds)
                <input data-testid="settings-prom-interval" type="number" min={2} step={1} value={intervalSec} onChange={(e) => setIntervalSec(e.target.value)} />
              </label>
              <div className="editor-foot">
                <button type="button" disabled={busy || !view.prometheus.urlSet} onClick={onClearUrl}>Clear URL</button>
                <button type="button" className="primary" disabled={busy} data-testid="settings-save" onClick={onSave}>Save</button>
              </div>
            </section>

            <section className="settings-sec" data-testid="settings-labels">
              <h4>Map labels</h4>
              <p className="muted">Show or hide labels on the map (saved in localStorage). By default only the shops and the pond; Monitor shows only on errors or alerts.</p>
              <div className="settings-label-grid">
                {LABEL_ROWS.filter((r) => r.key !== 'monitor').map(({ key, title }) => (
                  <label key={key} className="settings-check settings-label-item">
                    <input
                      type="checkbox"
                      checked={labels[key as Exclude<keyof LabelPrefs, 'monitor'>]}
                      onChange={(e) => setLabelBool(key as Exclude<keyof LabelPrefs, 'monitor'>, e.target.checked)}
                      data-testid={`settings-label-${key}`}
                    />
                    {title}
                  </label>
                ))}
              </div>
              <label className="settings-monitor-mode">Monitor / IT Ops
                <select
                  value={labels.monitor}
                  onChange={(e) => setMonitorMode(e.target.value as MonitorLabelMode)}
                  data-testid="settings-label-monitor"
                >
                  <option value="alert">Only on errors / alerts</option>
                  <option value="off">Always hidden</option>
                  <option value="always">Always shown</option>
                </select>
              </label>
              <div className="editor-foot">
                <button type="button" data-testid="settings-labels-reset" onClick={resetLabels}>Defaults</button>
              </div>
            </section>

            <section className="settings-sec" data-testid="settings-run-speed">
              <h4>Run speed</h4>
              <p className="muted">Only the <b>running</b> speed (walking is unchanged). Ambient moves, NPCs and trips to the shops use it; a working agent heading back to its desk always runs at max.</p>
              <label className="settings-run-speed">Run speed
                <input
                  type="range"
                  min={RUN_SPEED_MIN}
                  max={RUN_SPEED_MAX}
                  step={0.1}
                  value={runSpeed}
                  data-testid="settings-run-speed-input"
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setRunSpeed(v);
                    saveRunSpeed(v);
                  }}
                />
                <span className="mono" data-testid="settings-run-speed-value">{runSpeed.toFixed(1)} m/s</span>
              </label>
              <div className="editor-foot">
                <button type="button" data-testid="settings-run-speed-reset" onClick={() => { setRunSpeed(RUN_SPEED_DEFAULT); saveRunSpeed(RUN_SPEED_DEFAULT); }}>Default</button>
              </div>
            </section>

            <section className="settings-sec">
              <h4>Sessions &amp; desks</h4>
              <p className="muted">Per run: <b>{view.desks.total}</b> desks · up to <b>{view.desks.perSession}</b> agents / session · {view.desks.cols}-column grid (fixed in the layout).</p>
              <p className="muted">{view.notes.avatar}</p>
            </section>

            <section className="settings-sec">
              <button type="button" className="settings-adv-toggle" aria-expanded={advanced} onClick={() => setAdvanced((a) => !a)}>
                Advanced ({advanced ? 'hide' : 'show'})
              </button>
              {advanced && (
                <div className="settings-adv">
                  <label className="settings-check">
                    <input type="checkbox" checked={debugHooks} onChange={toggleDebug} data-testid="settings-debug" />
                    Enable deck.debug (crashes / affairs from the console)
                  </label>
                  <p className="muted">{view.notes.debugHooks} After enabling it, reload the page and use <code>__deckTraffic</code> / <code>__deckTown</code>.</p>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
