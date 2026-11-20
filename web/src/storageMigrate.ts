/** Browser storage keys before the Claude Deck rename (`office.*`, `vp-*`) → their `deck.*` names. */
export const LEGACY_LOCAL_KEYS: Readonly<Record<string, string>> = {
  'office.tab': 'deck.tab', 'office.opener': 'deck.opener', 'office.looks': 'deck.looks', 'office.vp.night': 'deck.night',
  'vp-debug': 'deck.debug', 'vp-collapse': 'deck.collapse', 'vp-split': 'deck.split', 'vp-labels': 'deck.labels', 'vp-run-speed': 'deck.runSpeed', 'vp-prompt-pick': 'deck.promptPick',
};
export const LEGACY_SESSION_KEYS: Readonly<Record<string, string>> = { 'office.token': 'deck.token', 'office.ws': 'deck.ws' };
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
/** One-time copy of old keys whose new key is absent; the old key is removed either way. Returns the new keys written. Never throws. */
export function migrateKeys(store: Store | undefined, map: Readonly<Record<string, string>>): string[] {
  const done: string[] = [];
  if (!store) return done;
  for (const [old, now] of Object.entries(map)) {
    try {
      const v = store.getItem(old);
      if (v === null) continue;
      if (store.getItem(now) === null) { store.setItem(now, v); done.push(now); }
      store.removeItem(old);
    } catch { /* private mode / quota: keep going */ }
  }
  return done;
}
/** Town structure keys in `deck.labels` before the English rename → their new keys. `xem-nuong` → `bbq` is a no-op safety net: the BBQ label key was already `bbq` before the rename, so no saved value should use it. */
export const LEGACY_LABEL_KEYS: Readonly<Record<string, string>> = { trada: 'iced-tea', bia: 'beer-stall', 'xem-nuong': 'bbq' };
const OLD_LOOK = /^(nam|nu)_(\d{2})$/;
/** Avatar preset id before the English rename (`nam_03`, `nu_10`) → `male_03`, `female_10`; anything else unchanged. */
export const lookId = (id: string) => id.replace(OLD_LOOK, (_, g: string, n: string) => `${g === 'nam' ? 'male' : 'female'}_${n}`);
const obj = (raw: string): Record<string, unknown> | undefined => { const j: unknown = JSON.parse(raw); return j && typeof j === 'object' && !Array.isArray(j) ? j as Record<string, unknown> : undefined; };
/** `deck.labels`: old structure keys move to the new ones (a value already under the new key wins). Undefined = nothing to change. */
export function migrateLabelsValue(raw: string): string | undefined {
  const j = obj(raw); if (!j) return undefined;
  let hit = false;
  for (const [old, now] of Object.entries(LEGACY_LABEL_KEYS)) if (Object.hasOwn(j, old)) { if (!Object.hasOwn(j, now)) j[now] = j[old]; delete j[old]; hit = true; }
  return hit ? JSON.stringify(j) : undefined;
}
/** `deck.looks`: every `{ look: 'nam_04' }` becomes `{ look: 'male_04' }`. Undefined = nothing to change. */
export function migrateLooksValue(raw: string): string | undefined {
  const j = obj(raw); if (!j) return undefined;
  let hit = false;
  for (const v of Object.values(j)) if (v && typeof v === 'object' && typeof (v as { look?: unknown }).look === 'string') {
    const i = v as { look: string }, n = lookId(i.look); if (n !== i.look) { i.look = n; hit = true; }
  }
  return hit ? JSON.stringify(j) : undefined;
}
export const VALUE_MIGRATIONS: Readonly<Record<string, (raw: string) => string | undefined>> = { 'deck.labels': migrateLabelsValue, 'deck.looks': migrateLooksValue };
/** Rewrites renamed values inside stored JSON (idempotent: a second run changes nothing). Returns the keys rewritten. Never throws; bad JSON is left alone. */
export function migrateValues(store: Store | undefined, map: Readonly<Record<string, (raw: string) => string | undefined>> = VALUE_MIGRATIONS): string[] {
  const done: string[] = [];
  if (!store) return done;
  for (const [key, fn] of Object.entries(map)) {
    try {
      const v = store.getItem(key); if (v === null) continue;
      const n = fn(v); if (n !== undefined && n !== v) { store.setItem(key, n); done.push(key); }
    } catch { /* not JSON / private mode / quota: keep going */ }
  }
  return done;
}
const get = (k: 'localStorage' | 'sessionStorage'): Store | undefined => { try { return typeof globalThis[k] === 'undefined' ? undefined : globalThis[k]; } catch { return undefined; } };
/** Runs the key migrations, then the value migration, against the page's storage (no-op outside a browser). */
export function migrateStorage(local: Store | undefined = get('localStorage'), session: Store | undefined = get('sessionStorage')): string[] {
  return [...migrateKeys(local, LEGACY_LOCAL_KEYS), ...migrateKeys(session, LEGACY_SESSION_KEYS), ...migrateValues(local)];
}
migrateStorage();
