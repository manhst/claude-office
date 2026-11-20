// Names and avatars chosen by the user, kept in localStorage. Same idea as Phúc's VanphongAI settings: a name field plus an
// avatar picker over the 20 presets (avatars.ts PRESETS ids, male_01…female_10). Keys: `agent:<profile name>` or `npc:<id>`.
// Ids saved before the English rename (nam_01, nu_01) are rewritten by storageMigrate.ts.
export interface Ident { name?: string; look?: string }
export type Looks = Record<string, Ident>;
export const LOOKS_KEY = 'deck.looks';
const ID = /^(male|female)_\d{2}$/;
export function loadLooks(store: Pick<Storage, 'getItem'> | undefined): Looks {
  try {
    const raw = JSON.parse(store?.getItem(LOOKS_KEY) ?? '{}'); const out: Looks = {};
    for (const [k, v] of Object.entries(raw ?? {})) {
      const i = v as Ident; const name = typeof i?.name === 'string' ? i.name.trim().slice(0, 40) : undefined; const look = typeof i?.look === 'string' && ID.test(i.look) ? i.look : undefined;
      if (name || look) out[k.slice(0, 120)] = { name: name || undefined, look };
    }
    return out;
  } catch { return {}; }
}
export function saveLooks(store: Pick<Storage, 'setItem'> | undefined, l: Looks) { try { store?.setItem(LOOKS_KEY, JSON.stringify(l)); } catch { /* private mode */ } }
export const agentKey = (a: { name: string }) => `agent:${a.name}`;
export function setIdent(l: Looks, key: string, i: Ident): Looks {
  const name = i.name?.trim().slice(0, 40) || undefined, look = i.look && ID.test(i.look) ? i.look : undefined;
  const { [key]: _old, ...rest } = l; return name || look ? { ...rest, [key]: { name, look } } : rest;
}
/** Shared with the Office scene (it reads the chosen preset and name). */
let current: Looks = {};
export const setCurrentLooks = (l: Looks) => { current = l; };
export const currentLook = (key: string) => current[key]?.look;
export const currentName = (key: string) => current[key]?.name;
