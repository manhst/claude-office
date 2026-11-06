/** Persist left-sidebar section collapse (Session / Responses / Agents). Client-only localStorage. */
export const VP_COLLAPSE_KEY = 'vp-collapse';

export type CollapsePrefs = { session: boolean; responses: boolean; agents: boolean };

export const DEFAULT_COLLAPSE: CollapsePrefs = { session: false, responses: false, agents: false }; // false = expanded

function storage(): Storage | undefined {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage; } catch { return undefined; }
}

export function loadCollapse(): CollapsePrefs {
  const out: CollapsePrefs = { ...DEFAULT_COLLAPSE };
  try {
    const raw = storage()?.getItem(VP_COLLAPSE_KEY);
    if (!raw) return out;
    const j = JSON.parse(raw) as Partial<CollapsePrefs> & { events?: boolean };
    if (typeof j.session === 'boolean') out.session = j.session;
    if (typeof j.responses === 'boolean') out.responses = j.responses;
    if (typeof j.agents === 'boolean') out.agents = j.agents;
  } catch { /* keep defaults */ }
  return out;
}

export function saveCollapse(prefs: CollapsePrefs): void {
  const s = storage();
  if (!s) return;
  s.setItem(VP_COLLAPSE_KEY, JSON.stringify(prefs));
}

export function setCollapse(key: keyof CollapsePrefs, collapsed: boolean): CollapsePrefs {
  const next = { ...loadCollapse(), [key]: collapsed };
  saveCollapse(next);
  return next;
}
