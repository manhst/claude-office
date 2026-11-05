import { useEffect, useState } from 'react';
import { IconCross, IconGear } from './icons';
import { fetchSettings, saveSettings, type SettingsView } from './settingsApi';
import { DEFAULT_LABELS, LABEL_ROWS, loadLabels, saveLabels, type LabelPrefs, type MonitorLabelMode } from './vpLabels';

const MODE_VI: Record<string, string> = {
  prometheus: 'Prometheus',
  demo: 'Demo (giả lập)',
  unconfigured: 'Chưa cấu hình',
};

export function SettingsButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="icon-btn settings-btn" onClick={onClick} title="Cài đặt" aria-label="Cài đặt" data-testid="settings-open">
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
  const [vpDebug, setVpDebug] = useState(() => localStorage.getItem('vp-debug') === '1');
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
    const next = !vpDebug;
    setVpDebug(next);
    if (next) localStorage.setItem('vp-debug', '1');
    else localStorage.removeItem('vp-debug');
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
          <h3 id="settings-title"><IconGear size={16} /> Cài đặt</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Đóng"><IconCross size={14} /></button>
        </div>

        {err && <p className="settings-err" role="alert">{err}</p>}
        {!view && !err && <p className="muted">Đang tải…</p>}

        {view && (
          <>
            <section className="settings-sec">
              <h4>IT Ops · Prometheus</h4>
              <p className="muted">Trạng thái: <b>{MODE_VI[view.itops.mode] ?? view.itops.mode}</b>
                {view.itops.state ? ` · ${view.itops.state}` : ''}
                {view.itops.endpoint ? ` · ${view.itops.endpoint}` : ''}
              </p>
              {view.demo && <p className="settings-badge" data-testid="settings-demo">Chế độ demo đang bật (--demo). Không có URL thì IT Ops dùng cảnh báo giả lập.</p>}
              <label>URL Prometheus
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
              <p className="muted">Mật khẩu trong URL được che trên UI; lưu server tại <code>orchestrator/.run/office-settings.json</code> (mode 600).</p>
              <label>Query
                <input data-testid="settings-prom-query" spellCheck={false} value={query} onChange={(e) => setQuery(e.target.value)} />
              </label>
              <label>Chu kỳ poll (giây)
                <input data-testid="settings-prom-interval" type="number" min={2} step={1} value={intervalSec} onChange={(e) => setIntervalSec(e.target.value)} />
              </label>
              <div className="editor-foot">
                <button type="button" disabled={busy || !view.prometheus.urlSet} onClick={onClearUrl}>Xóa URL</button>
                <button type="button" className="primary" disabled={busy} data-testid="settings-save" onClick={onSave}>Lưu</button>
              </div>
            </section>

            <section className="settings-sec" data-testid="settings-labels">
              <h4>Nhãn công trình</h4>
              <p className="muted">Bật/tắt label trên bản đồ (lưu localStorage). Mặc định chỉ quán + hồ; Monitor chỉ hiện khi lỗi/cảnh báo.</p>
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
                  <option value="alert">Chỉ khi lỗi / cảnh báo</option>
                  <option value="off">Luôn ẩn</option>
                  <option value="always">Luôn hiện</option>
                </select>
              </label>
              <div className="editor-foot">
                <button type="button" data-testid="settings-labels-reset" onClick={resetLabels}>Mặc định</button>
              </div>
            </section>

            <section className="settings-sec">
              <h4>Phiên &amp; bàn</h4>
              <p className="muted">Mỗi lần chạy: <b>{view.desks.total}</b> bàn · tối đa <b>{view.desks.perSession}</b> agent / phiên · lưới {view.desks.cols} cột (cố định trong layout).</p>
              <p className="muted">{view.notes.avatar}</p>
            </section>

            <section className="settings-sec">
              <button type="button" className="settings-adv-toggle" aria-expanded={advanced} onClick={() => setAdvanced((a) => !a)}>
                Nâng cao ({advanced ? 'ẩn' : 'hiện'})
              </button>
              {advanced && (
                <div className="settings-adv">
                  <label className="settings-check">
                    <input type="checkbox" checked={vpDebug} onChange={toggleDebug} data-testid="settings-vp-debug" />
                    Bật vp-debug (tai nạn / ngoại tình qua console)
                  </label>
                  <p className="muted">{view.notes.vpDebug} Sau khi bật, tải lại trang rồi dùng <code>__vpTraffic</code> / <code>__vpTown</code>.</p>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
