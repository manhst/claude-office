// Blocky characters, ported from VanphongAI (Phuc) van_phong_3d.js "dungNguoi" (buildPerson) + nhan_vat.js "chuanHoa" (normalizeLook). See ./NOTICE.
// Recipes (sizes, offsets, colours) are kept verbatim; identifiers were translated to English, and the module shape and types are ours.
import * as THREE from 'three';

export const SKIN = '#ffe4d4';
export const CUBE = new THREE.BoxGeometry(1, 1, 1);
const cache = new Map<string, THREE.Material>();
export const mix = (a: string, b: string, t: number) => `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`;
const validHex = (hex: string | undefined, fallback: string) => (/^#[0-9a-f]{6}$/i.test(hex || '') ? hex! : fallback);

export function material(color: string, extra?: THREE.MeshLambertMaterialParameters) {
  const k = color + (extra ? JSON.stringify(extra) : '');
  if (!cache.has(k)) cache.set(k, new THREE.MeshLambertMaterial({ color, ...extra }));
  return cache.get(k)!;
}
export function glowMaterial(color: string) {
  const k = `glow${color}`;
  if (!cache.has(k)) cache.set(k, new THREE.MeshBasicMaterial({ color }));
  return cache.get(k)!;
}
export let SHADOWS = true; // cast shadows (turned off on software GL)
export const setShadows = (on: boolean) => { SHADOWS = on; };
export function block(parent: THREE.Object3D, w: number, h: number, d: number, color: string | THREE.Material, x: number, y: number, z: number, shadow = true) {
  const m = new THREE.Mesh(CUBE, typeof color === 'string' ? material(color) : color);
  m.scale.set(w, h, d); m.position.set(x, y, z);
  m.castShadow = shadow && SHADOWS; m.receiveShadow = SHADOWS;
  parent.add(m);
  return m;
}

export interface Appearance { gender?: 'male' | 'female'; hairStyle?: string; hair?: string; hair2?: string; eyes?: string; shirt?: string; accent?: string; accessories?: string[] }
const MALE_HAIR = ['spiky', 'neat', 'messy', 'slicked'];
const HAIR_STYLES = ['short', 'long', 'pigtails', 'ponytail', 'bun', 'curly', 'bangs', ...MALE_HAIR];
export function normalizeLook(g?: Appearance): Required<Appearance> {
  const look: any = { ...(g || {}) };
  look.hairStyle = HAIR_STYLES.includes(look.hairStyle) ? look.hairStyle : 'short';
  look.gender = look.gender === 'male' || look.gender === 'female' ? look.gender : (MALE_HAIR.includes(look.hairStyle) ? 'male' : 'female');
  look.hair = validHex(look.hair, '#6b5b95');
  look.hair2 = validHex(look.hair2, mix(look.hair, '#ffffff', 0.25));
  look.eyes = validHex(look.eyes, '#5b6cff');
  look.shirt = validHex(look.shirt, '#f0ebe4');
  look.accent = validHex(look.accent, look.eyes);
  look.accessories = Array.isArray(look.accessories) ? look.accessories : [];
  return look;
}
// A few of the reference's 20 presets (nhan_vat.js MAU_SAN, here avatars.ts PRESETS), verbatim.
const m = (gender: 'male' | 'female', hairStyle: string, hair: string, hair2: string, eyes: string, shirt: string, accent: string, accessories: string[]): Appearance => ({ gender, hairStyle, hair, hair2, eyes, shirt, accent, accessories });
export const PRESET_LOOKS: Record<string, Appearance> = {
  male_01: m('male', 'neat', '#2b2b33', '#4a4a58', '#5a4632', '#e9eef5', '#3b6fd1', ['glasses']),
  male_02: m('male', 'spiky', '#4f6bff', '#a07bff', '#3d5afe', '#ebe8ff', '#4f6bff', ['headphones']),
  male_04: m('male', 'messy', '#c8643f', '#e9925f', '#b4532a', '#fff4e6', '#e67e22', []),
  male_07: m('male', 'neat', '#6b4423', '#9a6a3f', '#6b4423', '#f5efe6', '#8e5a2b', ['glasses']),
  female_01: m('female', 'long', '#86a8ff', '#c39bff', '#5b6cff', '#33406f', '#c39bff', ['star']),
  female_03: m('female', 'pigtails', '#2d2d34', '#169c7c', '#10a37f', '#e6f6f0', '#10a37f', ['flower']),
  female_04: m('female', 'ponytail', '#ff8fb1', '#ffc2d4', '#e0558a', '#fff0f5', '#e0558a', ['bow']),
  female_05: m('female', 'bun', '#23232b', '#45455a', '#5a3e2b', '#f2efe9', '#b23a48', ['earrings']),
};

function buildHair(head: THREE.Group, look: Required<Appearance>) {
  const t1 = look.hair, t2 = look.hair2, accent = look.accent;
  const k = (w: number, h: number, d: number, x: number, y: number, z: number, color = t1, rot?: number[]) => {
    const mm = block(head, w, h, d, color, x, y, z);
    if (rot) mm.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
    return mm;
  };
  k(0.62, 0.14, 0.56, 0, 0.59, -0.01);
  k(0.62, 0.42, 0.08, 0, 0.37, -0.285);
  for (const b of [-1, 1]) k(0.06, 0.26, 0.48, b * 0.31, 0.44, -0.03);
  k(0.2, 0.02, 0.1, -0.1, 0.665, 0.12, mix(t1, '#ffffff', 0.16));
  const fringe = () => { k(0.2, 0.13, 0.06, -0.19, 0.47, 0.27); k(0.24, 0.17, 0.06, 0.02, 0.45, 0.27); k(0.16, 0.11, 0.06, 0.21, 0.48, 0.27); };
  const sideLocks = () => { for (const b of [-1, 1]) k(0.07, 0.3, 0.08, b * 0.3, 0.3, 0.17, t2); };
  const longBack = () => { k(0.64, 0.75, 0.1, 0, -0.2, -0.3, t2); };
  switch (look.hairStyle) {
    case 'spiky':
      [[-0.18, 0.7, 0.08, 0.35], [0, 0.74, 0.02, 0], [0.18, 0.7, 0.06, -0.35], [-0.1, 0.71, -0.17, 0.2], [0.12, 0.7, -0.16, -0.2]]
        .forEach(([x, y, z, r]) => k(0.16, 0.16, 0.16, x, y, z, t1, [0, 0, r]));
      [-0.17, 0, 0.17].forEach((x) => k(0.15, 0.15, 0.06, x, 0.49, 0.27, x ? t1 : t2, [0, 0, 0.78]));
      break;
    case 'neat': k(0.42, 0.11, 0.06, -0.09, 0.49, 0.27); k(0.14, 0.07, 0.06, 0.21, 0.52, 0.27); break;
    case 'messy':
      fringe();
      [[0.31, 0.55, 0.14, 0.4], [-0.32, 0.5, 0.08, -0.3], [0.1, 0.69, -0.06, 0.5], [-0.16, 0.68, 0.12, -0.4], [0.22, 0.66, -0.2, 0.2]]
        .forEach(([x, y, z, r], i) => k(0.14, 0.14, 0.14, x, y, z, i % 2 ? t2 : t1, [r, 0, r]));
      break;
    case 'slicked': k(0.62, 0.16, 0.22, 0, 0.6, -0.21); k(0.36, 0.1, 0.12, 0.02, 0.61, 0.22, t1, [-0.35, 0, 0]); break;
    case 'long':
      fringe(); sideLocks(); longBack();
      for (const b of [-1, 1]) { k(0.08, 0.4, 0.4, b * 0.32, 0.35, -0.05); k(0.08, 0.45, 0.36, b * 0.32, -0.05, -0.08, t2); }
      break;
    case 'pigtails':
      fringe();
      for (const b of [-1, 1]) {
        k(0.1, 0.1, 0.1, b * 0.35, 0.3, -0.06, accent);
        [0.17, 0.03, -0.11, -0.25].forEach((y, i) => k(0.13, 0.15, 0.13, b * (0.37 + (i % 2) * 0.02), y, -0.06, i < 2 ? t1 : t2));
        k(0.08, 0.06, 0.08, b * 0.37, -0.35, -0.06, accent);
      }
      break;
    case 'ponytail': fringe(); sideLocks(); k(0.12, 0.12, 0.1, 0, 0.5, -0.34, accent); k(0.17, 0.36, 0.15, 0, 0.3, -0.39); k(0.14, 0.24, 0.13, 0, 0.02, -0.41, t2); break;
    case 'bun': fringe(); sideLocks(); k(0.28, 0.26, 0.28, 0, 0.75, -0.18); k(0.3, 0.05, 0.3, 0, 0.64, -0.18, accent); break;
    case 'curly':
      fringe();
      for (const b of [-1, 1]) [0.42, 0.26, 0.1].forEach((y, i) => [0.1, -0.1, -0.25].forEach((z, j) => k(0.13, 0.13, 0.13, b * 0.34, y, z, (i + j) % 2 ? t2 : t1)));
      [-0.2, 0, 0.2].forEach((x, i) => { k(0.14, 0.14, 0.14, x, 0.3, -0.33, i % 2 ? t1 : t2); k(0.14, 0.14, 0.14, x, 0.12, -0.33, i % 2 ? t2 : t1); k(0.15, 0.12, 0.15, x, 0.68, -0.02 - i * 0.05); });
      break;
    case 'bangs':
      k(0.6, 0.13, 0.06, 0, 0.47, 0.27); longBack();
      for (const b of [-1, 1]) { k(0.1, 0.4, 0.1, b * 0.3, 0.2, 0.18); k(0.08, 0.5, 0.36, b * 0.32, 0.25, -0.1); }
      break;
    default:
      fringe(); sideLocks();
      for (const b of [-1, 1]) { k(0.08, 0.24, 0.42, b * 0.32, 0.4, -0.04); k(0.08, 0.24, 0.42, b * 0.32, 0.16, -0.04, t2); }
      k(0.62, 0.3, 0.09, 0, 0.15, -0.29, t2);
      break;
  }
}

function buildAccessories(head: THREE.Group, look: Required<Appearance>) {
  const k = (w: number, h: number, d: number, color: string, x: number, y: number, z: number, rz?: number) => { const mm = block(head, w, h, d, color, x, y, z, false); if (rz) mm.rotation.z = rz; return mm; };
  for (const item of look.accessories) {
    switch (item) {
      case 'glasses':
        for (const b of [-1, 1]) {
          const x = b * 0.12;
          k(0.17, 0.024, 0.02, '#2b2b36', x, 0.29, 0.268); k(0.17, 0.024, 0.02, '#2b2b36', x, 0.14, 0.268);
          k(0.024, 0.15, 0.02, '#2b2b36', x - 0.073, 0.215, 0.268); k(0.024, 0.15, 0.02, '#2b2b36', x + 0.073, 0.215, 0.268);
        }
        k(0.07, 0.02, 0.02, '#2b2b36', 0, 0.26, 0.268);
        break;
      case 'headphones':
        k(0.7, 0.06, 0.1, '#2d2f3a', 0, 0.7, 0);
        for (const b of [-1, 1]) { k(0.06, 0.4, 0.1, '#2d2f3a', b * 0.35, 0.5, 0); k(0.1, 0.2, 0.2, look.accent, b * 0.36, 0.25, 0); }
        break;
      case 'star': k(0.11, 0.11, 0.04, '#ffd45c', 0.22, 0.52, 0.29, 0.785); k(0.06, 0.06, 0.05, '#fff1b8', 0.22, 0.52, 0.29, 0.785); break;
      case 'flower':
        for (const [x, y] of [[0, 0.06], [0, -0.06], [0.06, 0], [-0.06, 0]]) k(0.07, 0.07, 0.05, '#ff9ec4', -0.27 + x, 0.52 + y, 0.2);
        k(0.05, 0.05, 0.06, '#ffd45c', -0.27, 0.52, 0.21);
        break;
      case 'bow':
        k(0.13, 0.11, 0.05, look.accent, 0.1, 0.67, 0.08, 0.3); k(0.13, 0.11, 0.05, look.accent, 0.24, 0.67, 0.08, -0.3);
        k(0.05, 0.06, 0.06, mix(look.accent, '#000000', 0.25), 0.17, 0.67, 0.09);
        break;
      case 'clip': k(0.14, 0.035, 0.03, look.accent, 0.2, 0.5, 0.3, -0.3); break;
      case 'earrings': for (const b of [-1, 1]) k(0.04, 0.06, 0.04, '#ffd45c', b * 0.31, 0.1, 0.02); break;
      default: break;
    }
  }
}

export interface Body { root: THREE.Group; torso: THREE.Group; head: THREE.Group; arms: THREE.Group[]; legs: THREE.Group[]; eyes: THREE.Group[]; mouth: THREE.Group; sweat: THREE.Mesh }
/** Character faces +z, origin on the floor. seated: on a chair, otherwise standing (legs on hip joints for walking). */
export function buildPerson(appearance: Appearance | undefined, seated: boolean): Body {
  const look = normalizeLook(appearance);
  const male = look.gender === 'male';
  const root = new THREE.Group();
  const pants = male ? '#3b4052' : mix(look.accent, '#1d1b26', 0.55);
  const legs: THREE.Group[] = [];
  for (const x of [-0.11, 0.11]) {
    if (seated) {
      block(root, 0.17, 0.16, 0.44, pants, x, 0.5, 0.2);
      block(root, 0.16, 0.44, 0.16, pants, x, 0.27, 0.38);
      block(root, 0.17, 0.08, 0.24, '#4a3a33', x, 0.04, 0.42);
    } else {
      const p = new THREE.Group(); p.position.set(x, 0.62, 0); root.add(p);
      block(p, 0.17, 0.58, 0.17, pants, 0, -0.29, 0);
      block(p, 0.18, 0.08, 0.26, '#4a3a33', 0, -0.58, 0.04);
      legs.push(p);
    }
  }
  if (!male) { if (seated) block(root, 0.5, 0.1, 0.46, pants, 0, 0.58, 0.16); else block(root, 0.52, 0.24, 0.36, pants, 0, 0.6, 0); }
  const hips = new THREE.Group(); hips.position.y = seated ? 0.52 : 0.64; root.add(hips);
  const torso = new THREE.Group(); hips.add(torso);
  block(torso, 0.46, 0.5, 0.3, look.shirt, 0, 0.25, 0);
  block(torso, 0.47, 0.05, 0.31, mix(look.shirt, '#000000', 0.18), 0, 0.03, 0, false);
  block(torso, 0.22, 0.05, 0.02, mix(look.shirt, '#ffffff', 0.5), 0, 0.475, 0.155, false);
  if (male) block(torso, 0.07, 0.3, 0.02, look.accent, 0, 0.3, 0.158, false);
  else {
    for (const b of [-1, 1]) block(torso, 0.08, 0.07, 0.03, look.accent, b * 0.055, 0.43, 0.16, false);
    block(torso, 0.04, 0.05, 0.035, mix(look.accent, '#000000', 0.25), 0, 0.43, 0.165, false);
  }
  const arms = [-1, 1].map((b) => {
    const p = new THREE.Group(); p.position.set(b * 0.3, 0.45, 0); torso.add(p);
    block(p, 0.13, 0.36, 0.14, look.shirt, 0, -0.16, 0);
    block(p, 0.12, 0.1, 0.12, SKIN, 0, -0.38, 0);
    return p;
  });
  const head = new THREE.Group(); head.position.y = 0.5; torso.add(head);
  block(head, 0.56, 0.52, 0.5, SKIN, 0, 0.27, 0);
  const eyes = [-1, 1].map((b) => {
    const g = new THREE.Group(); g.position.set(b * 0.12, 0.21, 0.252); head.add(g);
    block(g, 0.1, 0.14, 0.01, look.eyes, 0, 0, 0, false);
    block(g, 0.1, 0.05, 0.016, mix(look.eyes, '#140f2a', 0.55), 0, 0.045, 0, false);
    block(g, 0.035, 0.035, 0.022, '#ffffff', -0.022, 0.025, 0, false);
    return g;
  });
  const brow = mix(look.hair, '#1a1018', 0.5);
  for (const b of [-1, 1]) {
    block(head, male ? 0.11 : 0.1, 0.022, 0.012, brow, b * 0.12, 0.33, 0.252, false);
    block(head, 0.08, 0.035, 0.01, '#ffb3c0', b * 0.19, 0.12, 0.252, false);
    block(head, 0.04, 0.1, 0.08, '#ffd9c6', b * 0.29, 0.22, 0, false);
  }
  const mouth = new THREE.Group(); mouth.position.set(0, 0.085, 0.252); head.add(mouth);
  block(mouth, 0.07, 0.022, 0.012, '#9c3d44', 0, 0, 0, false);
  buildHair(head, look);
  buildAccessories(head, look);
  const sweat = block(head, 0.06, 0.1, 0.06, '#9ad8ff', 0.34, 0.5, 0.16, false);
  sweat.visible = false;
  return { root, torso, head, arms, legs, eyes, mouth, sweat };
}
