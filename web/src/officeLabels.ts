/** Office building/structure label visibility. Client-only (localStorage), like deck.debug. */
export const LABELS_KEY = 'deck.labels';
export const LABELS_EVENT = 'deck-labels-changed';

/** Stable keys for every structure label in the town / office. */
export type LabelKey =
  | 'cafe' | 'massage' | 'bbq' | 'iced-tea' | 'pond' | 'beer-stall'
  | 'garden' | 'smoke' | 'gym' | 'atm' | 'gate' | 'pod' | 'print'
  | 'pantry' | 'game' | 'workroom'
  | 'monitor';

/** Monitor label: off always, only on Prometheus error/alert, or always on. */
export type MonitorLabelMode = 'off' | 'alert' | 'always';

export type LabelPrefs = { [K in Exclude<LabelKey, 'monitor'>]: boolean } & { monitor: MonitorLabelMode };

/** UI rows: keep first five (defaults ON) then the rest (defaults OFF), monitor last. */
export const LABEL_ROWS: { key: LabelKey; title: string }[] = [
  { key: 'cafe', title: 'Crossian Cafe' },
  { key: 'massage', title: 'Xuka Massage' },
  { key: 'bbq', title: 'BBQ Grill' },
  { key: 'iced-tea', title: 'Iced Tea Stall' },
  { key: 'pond', title: 'Crocodile Pond' },
  { key: 'beer-stall', title: 'Beer Stall' },
  { key: 'garden', title: 'Flower Garden' },
  { key: 'smoke', title: 'Smoking Corner' },
  { key: 'gym', title: 'Gym / ping pong' },
  { key: 'atm', title: 'ATM · Snack' },
  { key: 'gate', title: 'Security Gate' },
  { key: 'pod', title: 'Meeting Pod' },
  { key: 'print', title: 'Printer · Copier' },
  { key: 'pantry', title: 'Pantry' },
  { key: 'game', title: 'Game room' },
  { key: 'workroom', title: 'Work room' },
  { key: 'monitor', title: 'Monitor / IT Ops' },
];

export const DEFAULT_LABELS: LabelPrefs = {
  cafe: true, massage: true, bbq: true, 'iced-tea': true, pond: true, 'beer-stall': true,
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
    const raw = storage()?.getItem(LABELS_KEY);
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
  s.setItem(LABELS_KEY, JSON.stringify(prefs));
  try { window.dispatchEvent(new CustomEvent(LABELS_EVENT)); } catch { /* no window */ }
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
  el.classList.toggle('label-hidden', !on);
  el.setAttribute('aria-hidden', on ? 'false' : 'true');
}
