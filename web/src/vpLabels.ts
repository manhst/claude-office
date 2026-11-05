/** Vanphong building/structure label visibility. Client-only (localStorage), like vp-debug. */
export const VP_LABELS_KEY = 'vp-labels';
export const VP_LABELS_EVENT = 'vp-labels-changed';

/** Stable keys for every structure label in the town / office. */
export type LabelKey =
  | 'cafe' | 'massage' | 'bbq' | 'trada' | 'pond' | 'bia'
  | 'garden' | 'smoke' | 'gym' | 'atm' | 'gate' | 'pod' | 'print'
  | 'pantry' | 'game' | 'workroom'
  | 'monitor';

/** Monitor label: off always, only on Prometheus error/alert, or always on. */
export type MonitorLabelMode = 'off' | 'alert' | 'always';

export type LabelPrefs = { [K in Exclude<LabelKey, 'monitor'>]: boolean } & { monitor: MonitorLabelMode };

/** UI rows: keep first five (defaults ON) then the rest (defaults OFF), monitor last. */
export const LABEL_ROWS: { key: LabelKey; title: string }[] = [
  { key: 'cafe', title: 'Crossian Cafe' },
  { key: 'massage', title: 'Xuka Mát xa' },
  { key: 'bbq', title: 'Xém Nướng' },
  { key: 'trada', title: 'Trà đá vỉa hè' },
  { key: 'pond', title: 'Hồ cá sấu' },
  { key: 'bia', title: 'Bia Hải Xồm' },
  { key: 'garden', title: 'Vườn hoa' },
  { key: 'smoke', title: 'Góc hút thuốc' },
  { key: 'gym', title: 'Gym / bóng bàn' },
  { key: 'atm', title: 'ATM · Snack' },
  { key: 'gate', title: 'Cổng bảo vệ' },
  { key: 'pod', title: 'Pod họp ngoài' },
  { key: 'print', title: 'Máy in · photocopy' },
  { key: 'pantry', title: 'Pantry' },
  { key: 'game', title: 'Game room' },
  { key: 'workroom', title: 'Work room' },
  { key: 'monitor', title: 'Monitor / IT Ops' },
];

export const DEFAULT_LABELS: LabelPrefs = {
  cafe: true, massage: true, bbq: true, trada: true, pond: true, bia: true,
  garden: false, smoke: false, gym: false, atm: false, gate: false, pod: false, print: false,
  pantry: false, game: false, workroom: false,
  monitor: 'alert',
};

function storage(): Storage | undefined {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage; } catch { return undefined; }
}

export function loadLabels(): LabelPrefs {
  const out: LabelPrefs = { ...DEFAULT_LABELS };
  try {
    const raw = storage()?.getItem(VP_LABELS_KEY);
    if (!raw) return out;
    const j = JSON.parse(raw) as Partial<Record<LabelKey, unknown>>;
    for (const { key } of LABEL_ROWS) {
      if (key === 'monitor') {
        const m = j.monitor;
        if (m === 'off' || m === 'alert' || m === 'always') out.monitor = m;
        else if (m === true) out.monitor = 'always';
        else if (m === false) out.monitor = 'off';
      } else if (typeof j[key] === 'boolean') out[key] = j[key] as boolean;
    }
  } catch { /* keep defaults */ }
  return out;
}

export function saveLabels(prefs: LabelPrefs): void {
  const s = storage();
  if (!s) return;
  s.setItem(VP_LABELS_KEY, JSON.stringify(prefs));
  try { window.dispatchEvent(new CustomEvent(VP_LABELS_EVENT)); } catch { /* no window */ }
}

export function isLabelOn(key: Exclude<LabelKey, 'monitor'>, prefs: LabelPrefs = loadLabels()): boolean {
  return !!prefs[key];
}

/** Whether the Monitor / IT Ops floating label should be visible for this status. */
export function monitorLabelVisible(
  status: { state?: string } | undefined | null,
  prefs: LabelPrefs = loadLabels(),
): boolean {
  if (prefs.monitor === 'always') return true;
  if (prefs.monitor === 'off') return false;
  const st = status?.state;
  return st === 'alert' || st === 'error';
}

/** Hide/show a DOM label. Uses class + !important so CSS2DRenderer (which clears inline display each frame) cannot re-show it. Element stays in the DOM for testids. */
export function applyLabelVisibility(el: HTMLElement | null | undefined, on: boolean): void {
  if (!el) return;
  el.classList.toggle('nhan-an', !on);
  el.setAttribute('aria-hidden', on ? 'false' : 'true');
}
